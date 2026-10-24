/**
 * Table format of the workflow views (design §17.2.3): a header block of `Label  value` lines,
 * titled sections as tables (empty ones left out) and a final `Next:` block. Pure.
 */

import { formatCell, renderTable } from '../output/table.js';
import { isRecord } from '../util.js';
import type { EndedInstance, InstanceView, TimelineEntry, Waited, WaitState } from './types.js';
import { waitId } from './waits.js';

export type HeaderRow = readonly [label: string, value: string | number | undefined];

/** `Label  value` lines with aligned values; rows without a value are left out. */
export function headerBlock(rows: readonly HeaderRow[]): string[] {
  const shown = rows.filter(
    (row): row is readonly [string, string | number] => row[1] !== undefined && row[1] !== '',
  );
  const width = Math.max(0, ...shown.map(([label]) => label.length));
  return shown.map(([label, value]) => `${label.padEnd(width)}  ${formatCell(value)}`);
}

export interface SectionTable {
  readonly title: string;
  readonly columns: readonly string[];
  readonly rows: readonly Record<string, unknown>[];
  /** Columns that are never truncated (ids to copy). */
  readonly fixed?: readonly string[];
}

/** A blank line, the title and the table; nothing for an empty section. */
export function section(table: SectionTable, maxWidth: number): string[] {
  if (table.rows.length === 0) return [];
  const rendered = renderTable(table.rows, {
    columns: table.columns,
    maxWidth,
    fixed: table.fixed,
  });
  return ['', table.title, ...rendered.split('\n')];
}

export function nextBlock(next: readonly string[]): string[] {
  return next.length === 0 ? [] : ['', 'Next:', ...next.map((command) => `  ${command}`)];
}

/** `1.2s`, `350ms`, `2m 5s`. */
export function formatElapsed(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}

export function waitedText(waited: Waited | undefined): string | undefined {
  if (waited === undefined) return undefined;
  const polls = `${waited.polls} poll${waited.polls === 1 ? '' : 's'}`;
  return `${waited.until} after ${formatElapsed(waited.elapsedMs)} (${polls})`;
}

function userTaskDetail(wait: Extract<WaitState, { kind: 'userTask' }>): string {
  return wait.assignee === undefined
    ? (wait.name ?? wait.activityName ?? '')
    : `assignee ${wait.assignee}`;
}

function externalTaskDetail(wait: Extract<WaitState, { kind: 'externalTask' }>): string {
  const worker = wait.workerId === undefined ? '' : `, worker ${wait.workerId}`;
  const retries = wait.retries === undefined ? '' : `, retries ${wait.retries}`;
  const error = wait.errorMessage === undefined ? '' : `: ${wait.errorMessage}`;
  return `topic ${wait.topic}${worker}${retries}${error}`;
}

function suspendedText(wait: { readonly suspended?: true }): string {
  return wait.suspended === true ? ', suspended' : '';
}

function detail(wait: WaitState): string {
  switch (wait.kind) {
    case 'userTask':
      return userTaskDetail(wait);
    case 'externalTask':
      return externalTaskDetail(wait);
    case 'timer':
      return `due ${wait.dueDate}${suspendedText(wait)}`;
    case 'asyncContinuation': {
      const error = wait.exceptionMessage === undefined ? '' : `: ${wait.exceptionMessage}`;
      return `retries ${wait.retries}${suspendedText(wait)}${error}`;
    }
    case 'other':
      return wait.activityType ?? '';
    default:
      return wait.eventName ?? '';
  }
}

function waitRows(view: InstanceView) {
  return view.waitingAt.map((wait) => ({
    ACTIVITY:
      wait.attachedTo === undefined
        ? wait.activityId
        : `${wait.activityId} (on ${wait.attachedTo})`,
    KIND: wait.kind,
    ID: waitId(wait),
    DETAIL: detail(wait),
    INSTANCE: wait.processInstanceId ?? '',
  }));
}

function variableRows(variables: Readonly<Record<string, unknown>>) {
  return Object.entries(variables).map(([name, value]) => {
    const typed = isRecord(value) && typeof value.type === 'string' ? value : undefined;
    return {
      NAME: name,
      VALUE: typed === undefined ? value : typed.value,
      TYPE: typed?.type ?? '',
    };
  });
}

function timelineNote(entry: TimelineEntry): string {
  const notes = [
    ...(entry.canceled === true ? ['canceled'] : []),
    ...(entry.incidents ?? []).map(
      (incident) =>
        `${incident.type} (${incident.state})${incident.message === undefined ? '' : `: ${incident.message}`}`,
    ),
  ];
  return notes.join('; ');
}

function timelineRows(timeline: readonly TimelineEntry[]) {
  return timeline.map((entry, index) => ({
    '#': index + 1,
    ACTIVITY: entry.activityId,
    TYPE: entry.activityType,
    START: entry.startTime,
    DURATION: entry.durationMs === undefined ? '' : formatElapsed(entry.durationMs),
    NOTE: timelineNote(entry),
  }));
}

/** `--stacktrace`: the lines of each incident below a title (tabs and control characters cleaned). */
function stacktraceLines(view: InstanceView): string[] {
  return view.incidents.flatMap((incident) =>
    incident.stacktrace === undefined || incident.stacktrace.length === 0
      ? []
      : [
          '',
          `Stacktrace (${incident.type} at ${incident.activityId}, incident ${incident.id}):`,
          ...incident.stacktrace.map((line) => `  ${formatCell(line)}`),
        ],
  );
}

function definitionText(view: InstanceView): string {
  const { key, version, name } = view.definition;
  return `${key}${version === undefined ? '' : ` v${version}`}${name === undefined ? '' : ` (${name})`}`;
}

function sections(view: InstanceView, maxWidth: number): string[] {
  const tables: SectionTable[] = [
    {
      title: 'Waiting at:',
      columns: ['ACTIVITY', 'KIND', 'ID', 'DETAIL', 'INSTANCE'],
      rows: waitRows(view),
      fixed: ['ID'],
    },
    {
      title: 'Incidents:',
      columns: ['TYPE', 'ACTIVITY', 'ROOT CAUSE', 'INSTANCE'],
      rows: view.incidents.map((incident) => ({
        TYPE: incident.type,
        ACTIVITY: incident.activityId,
        'ROOT CAUSE': incident.rootCause ?? incident.message ?? '',
        INSTANCE: incident.processInstanceId ?? '',
      })),
    },
    {
      title: 'Called instances:',
      columns: ['ID', 'KEY', 'VERSION', 'STATE', 'PARENT'],
      rows: view.children.map((child) => ({
        ID: child.id,
        KEY: child.key,
        VERSION: child.version ?? '',
        STATE: child.state,
        PARENT: child.parentId,
      })),
      fixed: ['ID'],
    },
    {
      title: 'Variables:',
      columns: ['NAME', 'VALUE', 'TYPE'],
      rows: variableRows(view.variables ?? {}),
    },
    {
      title: 'Timeline:',
      columns: ['#', 'ACTIVITY', 'TYPE', 'START', 'DURATION', 'NOTE'],
      rows: timelineRows(view.timeline ?? []),
    },
  ];
  const [waits, incidents, ...rest] = tables.map((table) => section(table, maxWidth));
  return [...(waits ?? []), ...(incidents ?? []), ...stacktraceLines(view), ...rest.flat()];
}

/** The instance view as text (lines without a final newline). */
export function instanceLines(view: InstanceView | EndedInstance, maxWidth: number): string[] {
  if (view.state === 'ENDED') {
    return headerBlock([
      ['Process instance', view.id],
      ['State', 'ENDED (no history)'],
      ['Waited', waitedText(view.waited)],
    ]);
  }
  const header = headerBlock([
    ['Process instance', view.id],
    ['State', view.state],
    ['Definition', definitionText(view)],
    ['Business key', view.businessKey],
    ['Started', view.startTime],
    ['Ended', view.endTime],
    ['Parent', view.parentId],
    ['Root', view.rootId],
    ['Propagated incidents', view.propagatedIncidents],
    [
      'Truncated',
      view.truncated === true
        ? 'the instance tree was cut at depth 10 or 100 instances'
        : undefined,
    ],
    ['Waited', waitedText(view.waited)],
  ]);
  return [...header, ...sections(view, maxWidth), ...nextBlock(view.next)];
}

export function instanceText(view: InstanceView | EndedInstance, maxWidth: number): string {
  return `${instanceLines(view, maxWidth).join('\n')}\n`;
}
