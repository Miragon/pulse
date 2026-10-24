/**
 * Plain text tables for humans. Pure functions, no terminal access. Widths are measured in
 * graphemes; lines of arrays and objects never exceed `maxWidth` (for maxWidth ≥ 20).
 */

import { isRecord, stringifyJson } from '../util.js';
import { getPath } from './fields.js';

export interface TableOptions {
  /** Explicit columns (from --fields); dot paths into nested objects. */
  readonly columns?: readonly string[] | undefined;
  /** Maximum line width; columns are dropped or truncated to fit. */
  readonly maxWidth: number;
  /** Columns that are never truncated (names to copy); the others shrink or are dropped. */
  readonly fixed?: readonly string[] | undefined;
}

const GAP = '  ';
const MIN_COLUMN = 6;
const MIN_KEPT = 3;
const ELLIPSIS = '…';
const HIDDEN_COLUMNS = new Set(['links']);

/** Line breaks, tabs and other non-space whitespace (with surrounding blanks) and control chars. */
const UNPRINTABLE = /\s*[^\S ]\s*|\p{Cc}/gu;

type Row = Record<string, unknown>;
type Lookup = (row: Row, column: string) => unknown;

/** Values that make an implicit column worth showing: non-empty strings, numbers and booleans. */
function isShown(value: unknown): boolean {
  if (typeof value === 'string') return value !== '';
  return typeof value === 'number' || typeof value === 'bigint' || typeof value === 'boolean';
}

/** Implicit columns are plain keys, which may contain dots (`order.id` variables). */
function ownValue(row: Row, column: string): unknown {
  return Object.hasOwn(row, column) ? row[column] : undefined;
}

/**
 * One line of printable text for a cell. JSON text is cleaned, too: JSON.stringify leaves C1
 * controls (`\x9b` starts an ANSI sequence) and U+2028/U+2029 line separators raw.
 */
export function formatCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const text = typeof value === 'string' ? value : (stringifyJson(value) ?? '');
  return text.replace(UNPRINTABLE, ' ');
}

/**
 * Columns that identify and describe engine resources, in this order. They come first in automatic
 * tables, so that they survive when columns are dropped to fit the width (the engine's own key
 * order puts long values such as `category` URLs or definition ids early).
 */
const PREFERRED_COLUMNS: readonly string[] = [
  'id',
  'key',
  'name',
  'version',
  'type',
  'value',
  'businessKey',
  'processDefinitionKey',
  'activityId',
  'incidentType',
  'incidentMessage',
  'exceptionMessage',
  'errorMessage',
  'topicName',
  'assignee',
  'state',
  'suspended',
  'ended',
  'retries',
  'created',
  'startTime',
  'endTime',
  'processInstanceId',
];

const PREFERRED_RANK: ReadonlyMap<string, number> = new Map(
  PREFERRED_COLUMNS.map((column, index) => [column, index]),
);

/**
 * Keys with a non-empty scalar value in at least one row: the preferred columns first (in their
 * order), then the others in first-seen order; `links` hidden.
 */
export function defaultColumns(rows: readonly Row[]): string[] {
  const keys = new Set(rows.flatMap((row) => Object.keys(row)));
  const shown = [...keys].filter(
    (key) => !HIDDEN_COLUMNS.has(key) && rows.some((row) => isShown(ownValue(row, key))),
  );
  const rank = (key: string) => PREFERRED_RANK.get(key) ?? PREFERRED_COLUMNS.length;
  // a stable sort keeps the first-seen order among the other keys
  return shown.toSorted((left, right) => rank(left) - rank(right));
}

const segmenter = new Intl.Segmenter();

function graphemes(text: string): string[] {
  return Array.from(segmenter.segment(text), (part) => part.segment);
}

function length(text: string): number {
  return graphemes(text).length;
}

export function truncate(text: string, width: number): string {
  const chars = graphemes(text);
  if (chars.length <= width) return text;
  return width < 1 ? '' : `${chars.slice(0, width - 1).join('')}${ELLIPSIS}`;
}

/** Pads with spaces to `width` graphemes (String#padEnd counts UTF-16 code units). */
function pad(text: string, width: number): string {
  return `${text}${' '.repeat(width - length(text))}`;
}

/**
 * Fits column widths into maxWidth. Without explicit columns, trailing columns are dropped first
 * (down to MIN_KEPT) so identifiers stay copyable; then the widest columns are truncated, except
 * the `fixed` ones (true at their index), and when nothing can shrink, trailing columns are dropped.
 */
export function fitWidths(
  natural: readonly number[],
  maxWidth: number,
  explicit = false,
  fixed: readonly boolean[] = [],
): number[] {
  const widths = [...natural];
  const total = () =>
    widths.reduce((sum, width) => sum + width, 0) + GAP.length * (widths.length - 1);
  while (total() > maxWidth) {
    const shrinkable = widths.map((width, index) => (fixed[index] === true ? 0 : width));
    const widest = Math.max(...shrinkable);
    if (!explicit && widths.length > MIN_KEPT) {
      widths.pop();
    } else if (widest > MIN_COLUMN) {
      widths[shrinkable.indexOf(widest)] = Math.max(MIN_COLUMN, widest - (total() - maxWidth));
    } else if (widths.length > 1) {
      widths.pop();
    } else {
      break;
    }
  }
  return widths;
}

/** Widest cell per column over all lines (reduce, not Math.max(...), for very long tables). */
function naturalWidths(lines: readonly (readonly string[])[]): number[] {
  return lines.reduce<number[]>(
    (widths, cells) => cells.map((cell, index) => Math.max(widths[index] ?? 0, length(cell))),
    [],
  );
}

/** One table line; cells of dropped columns (no width) are left out. */
function renderCells(cells: readonly string[], widths: readonly number[]): string {
  return cells
    .flatMap((cell, index) => {
      const width = widths[index];
      return width === undefined ? [] : [pad(truncate(cell, width), width)];
    })
    .join(GAP)
    .trimEnd();
}

function renderLines(
  header: readonly string[],
  body: readonly string[][],
  options: TableOptions,
): string {
  const lines = [header.map(formatCell), ...body];
  const explicit = options.columns !== undefined;
  const fixed = header.map((column) => options.fixed?.includes(column) === true);
  const widths = fitWidths(naturalWidths(lines), options.maxWidth, explicit, fixed);
  return lines.map((cells) => renderCells(cells, widths)).join('\n');
}

/** Lines without columns (scalars, objects without scalar fields), truncated to maxWidth. */
function plainLines(lines: readonly string[], maxWidth: number): string {
  return lines.map((text) => truncate(text, maxWidth)).join('\n');
}

export function renderRows(rows: readonly unknown[], options: TableOptions): string {
  const objects = rows.filter(isRecord);
  if (objects.length !== rows.length) return plainLines(rows.map(formatCell), options.maxWidth);
  const columns = options.columns ?? defaultColumns(objects);
  if (columns.length === 0) return plainLines(objects.map(formatCell), options.maxWidth);
  const lookup: Lookup = options.columns === undefined ? ownValue : getPath;
  const body = objects.map((row) => columns.map((column) => formatCell(lookup(row, column))));
  return renderLines(columns, body, options);
}

export function renderObject(value: Row, options: TableOptions): string {
  const keys = options.columns ?? Object.keys(value).filter((key) => !HIDDEN_COLUMNS.has(key));
  const lookup: Lookup = options.columns === undefined ? ownValue : getPath;
  const body = keys.map((key) => [formatCell(key), formatCell(lookup(value, key))]);
  return renderLines(['FIELD', 'VALUE'], body, { ...options, columns: keys });
}

/** Renders any JSON value as a table: arrays as rows, objects as key/value pairs. */
export function renderTable(value: unknown, options: TableOptions): string {
  if (Array.isArray(value)) return value.length === 0 ? 'No results.' : renderRows(value, options);
  if (isRecord(value)) return renderObject(value, options);
  return formatCell(value);
}
