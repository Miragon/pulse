/**
 * Turns operation results and plain values into stdout/stderr content. Pure: the CLI decides the
 * format, pretty printing, unwrapping, binary handling and `--out-file`, and does the I/O.
 */

import type { OutputFormat } from '../config/types.js';
import type { OperationResult, RequestPreview } from '../operation/result.js';
import { isRecord, stringifyJson } from '../util.js';
import { missingFields, project } from './fields.js';
import { curlCommand, maskHeaders, maskUrl } from './secrets.js';
import { renderTable } from './table.js';

export interface RenderOptions {
  readonly format: OutputFormat;
  /** Indent JSON with 2 spaces. */
  readonly pretty: boolean;
  /** `--fields` projection; also the table columns. */
  readonly fields?: readonly string[] | undefined;
  /** Maximum table line width. */
  readonly maxWidth: number;
  /** Property holding an XML document to print raw (set by the CLI only when unwrapping applies). */
  readonly unwrap?: string | undefined;
  /** Do not mask secret headers and URL passwords in dry-run previews. */
  readonly showSecrets: boolean;
  /** REST API root; the `Done:` line shows request paths relative to it, like `operate api`. */
  readonly baseUrl?: string | undefined;
}

export interface Rendered {
  readonly stdout?: string | Uint8Array;
  readonly stderr?: string;
}

type ValueOptions = Pick<RenderOptions, 'format' | 'pretty' | 'fields' | 'maxWidth'>;

function toJson(value: unknown, pretty: boolean): string {
  return `${stringifyJson(value ?? null, pretty ? 2 : undefined) ?? 'null'}\n`;
}

/** Appends a newline to non-empty text that does not end with one. */
function withNewline(text: string): string {
  return text === '' || text.endsWith('\n') ? text : `${text}\n`;
}

/** The number of a `{ count: n }` response, which tables print bare. */
function countOf(value: unknown): number | undefined {
  if (!isRecord(value)) return undefined;
  const { count, ...rest } = value;
  return typeof count === 'number' && Object.keys(rest).length === 0 ? count : undefined;
}

/** Renders a JSON value as JSON or table after the `--fields` projection; ends with a newline. */
export function renderValue(value: unknown, options: ValueOptions): string {
  const projected = project(value, options.fields);
  if (options.format === 'json') return toJson(projected, options.pretty);
  const count = countOf(projected);
  if (count !== undefined) return `${count}\n`;
  return `${renderTable(projected, { columns: options.fields, maxWidth: options.maxWidth })}\n`;
}

/** The XML document of an unwrap operation (`bpmn20Xml`, ...), if the value has one. */
export function unwrapXml(value: unknown, property: string | undefined): string | undefined {
  if (property === undefined || !isRecord(value) || !Object.hasOwn(value, property)) {
    return undefined;
  }
  const xml = value[property];
  return typeof xml === 'string' ? xml : undefined;
}

/** Most keys a `--fields` warning lists. */
const MAX_LISTED_KEYS = 30;

/** `Warning: field "nme" not found in the response (fields: id, name, ...)` per missing field. */
export function fieldWarnings(value: unknown, fields: readonly string[] | undefined): string {
  if (fields === undefined) return '';
  const { missing, available } = missingFields(value, fields);
  const listed = available.slice(0, MAX_LISTED_KEYS).join(', ');
  const more = available.length > MAX_LISTED_KEYS ? ', ...' : '';
  return missing
    .map(
      (field) => `Warning: field "${field}" not found in the response (fields: ${listed}${more})\n`,
    )
    .join('');
}

function renderJsonResult(value: unknown, options: RenderOptions): Rendered {
  const xml = unwrapXml(value, options.unwrap);
  if (xml !== undefined) return { stdout: withNewline(xml) };
  const warnings = fieldWarnings(value, options.fields);
  return {
    stdout: renderValue(value, options),
    ...(warnings === '' ? {} : { stderr: warnings }),
  };
}

function maskedPreview(request: RequestPreview, show: boolean): RequestPreview {
  return {
    method: request.method,
    url: maskUrl(request.url, show),
    headers: maskHeaders(request.headers, show),
    body: request.body,
  };
}

function renderDryRun(request: RequestPreview, options: RenderOptions): string {
  const preview = maskedPreview(request, options.showSecrets);
  const curl = curlCommand(preview);
  return options.format === 'json' ? toJson({ ...preview, curl }, options.pretty) : `${curl}\n`;
}

/** The path below the path of the REST root (`/engine-rest/task` → `/task`), else as is. */
function relativePath(path: string, baseUrl: string | undefined): string {
  if (baseUrl === undefined || !URL.canParse(baseUrl)) return path;
  const root = new URL(baseUrl).pathname.replace(/\/+$/, '');
  return path.startsWith(`${root}/`) ? path.slice(root.length) : path;
}

/**
 * Path (relative to the REST root, what `operate api` takes) and query of a URL, for the `Done:`
 * line; an unparseable URL as is, but masked.
 */
function requestPath(url: string, baseUrl: string | undefined): string {
  if (!URL.canParse(url)) return maskUrl(url, false);
  const parsed = new URL(url);
  return `${relativePath(parsed.pathname, baseUrl)}${parsed.search}`;
}

function doneLine(result: Extract<OperationResult, { kind: 'none' }>, baseUrl?: string): string {
  const { request, status, statusText } = result;
  const text = statusText === '' ? '' : ` ${statusText}`;
  return `Done: ${request.method} ${requestPath(request.url, baseUrl)} → ${status}${text}\n`;
}

/** Renders the outcome of an operation: response body on stdout, `Done:` for empty responses. */
export function renderResult(result: OperationResult, options: RenderOptions): Rendered {
  switch (result.kind) {
    case 'dry-run':
      return {
        stdout: renderDryRun(result.request, options),
        ...(result.note === undefined ? {} : { stderr: `Note: ${result.note}\n` }),
      };
    case 'json':
      return renderJsonResult(result.value, options);
    case 'text':
      return { stdout: withNewline(result.text) };
    case 'binary':
      return { stdout: result.data };
    case 'none':
      return { stderr: doneLine(result, options.baseUrl) };
  }
}
