/**
 * Table format of the views of advance, retry, deploy, status and `wait --batch` (design §17.2.3),
 * built from the helpers of text.ts. Pure.
 */

import type { AdvanceView } from './advance.js';
import type { BatchView } from './batch.js';
import type { DeployView } from './deploy.js';
import type { RetryView } from './retry.js';
import type { StatusView } from './status-command.js';
import type { EndedInstance, InstanceView } from './types.js';
import {
  formatElapsed,
  headerBlock,
  instanceLines,
  nextBlock,
  section,
  type SectionTable,
  waitedText,
} from './text.js';

function text(lines: readonly string[]): string {
  return `${lines.join('\n')}\n`;
}

/** The instance view below a blank line, when there is one. */
function instanceBlock(
  instance: InstanceView | EndedInstance | undefined,
  maxWidth: number,
): string[] {
  return instance === undefined ? [] : ['', ...instanceLines(instance, maxWidth)];
}

export function advanceText(view: AdvanceView, maxWidth: number): string {
  const { advanced } = view;
  const via =
    advanced.via === undefined || advanced.via.length === 0
      ? ''
      : ` via ${advanced.via.join(', ')}`;
  const by = advanced.executedBy === undefined ? '' : ' (executed by the job executor)';
  const header = headerBlock([
    ['Advanced', `${advanced.activityId} (${advanced.kind})${via}${by}`],
  ]);
  return text([...header, ...instanceBlock(view.instance, maxWidth)]);
}

export function retryText(view: RetryView, maxWidth: number): string {
  const table = section(
    {
      title: 'Incidents:',
      columns: ['INCIDENT', 'TYPE', 'ACTIVITY', 'RESULT', 'ROOT CAUSE'],
      rows: view.incidents.map((entry) => ({
        INCIDENT: entry.incidentId,
        TYPE: entry.type,
        ACTIVITY: entry.activityId,
        RESULT: entry.result,
        'ROOT CAUSE': entry.rootCause ?? entry.error ?? '',
      })),
      fixed: ['INCIDENT'],
    },
    maxWidth,
  );
  const errors = view.errors === undefined ? '' : `, errors ${view.errors}`;
  const totals = `Retried ${view.retried}, succeeded ${view.succeeded}, failed ${view.failed}, skipped ${view.skipped}, gone ${view.gone}${errors}`;
  const lines =
    table.length === 0 ? ['No open incidents to retry.', totals] : [...table.slice(2), '', totals];
  const next = [...new Set(view.incidents.flatMap((entry) => entry.next ?? []))];
  return text([...lines, ...nextBlock(next), ...instanceBlock(view.instance, maxWidth)]);
}

export function deployText(view: DeployView, maxWidth: number): string {
  const header = headerBlock([
    [
      'Deployment',
      `${view.deploymentId} (${view.name}, ${view.changed ? 'changed' : 'unchanged'})`,
    ],
    ['Time', view.deploymentTime],
  ]);
  const rows = view.resources.flatMap((resource): Record<string, unknown>[] => {
    const base = { RESOURCE: resource.resource, STATUS: resource.status };
    if (resource.definitions.length === 0) return [{ ...base, TYPE: '', KEY: '', VERSION: '' }];
    return resource.definitions.map((definition) => ({
      ...base,
      TYPE: definition.type,
      KEY: definition.key,
      VERSION: definition.version,
    }));
  });
  const table = section(
    { title: 'Resources:', columns: ['RESOURCE', 'STATUS', 'TYPE', 'KEY', 'VERSION'], rows },
    maxWidth,
  );
  return text([...header, ...table, ...instanceBlock(view.instance, maxWidth)]);
}

function statusLines(view: StatusView): string[] {
  const { jobs, tasks, batches } = view;
  const overdue =
    jobs.overdue === 0
      ? ''
      : `, ${jobs.overdue} overdue${jobs.oldestReadySince === undefined ? '' : ` (oldest since ${jobs.oldestReadySince})`}`;
  return headerBlock([
    ['Jobs', `${jobs.executable} executable${overdue}`],
    ['Tasks', `${tasks.open} open`],
    [
      'Batches',
      batches === undefined
        ? undefined
        : `${batches.running} running, ${batches.withFailures} with failures`,
    ],
    ['Incidents', `${view.incidentsTotal} open, ${view.propagated} propagated`],
    ['Truncated', view.truncated?.join('; ')],
  ]);
}

/** Findings as a list: the next command on its own line, never truncated. */
function findingLines(view: StatusView): string[] {
  if (view.findings.length === 0) return [];
  const width = Math.max(...view.findings.map((finding) => finding.severity.length));
  const lines = view.findings.flatMap((finding) => [
    `  ${finding.severity.padEnd(width)}  ${finding.message}`,
    ...(finding.next === undefined ? [] : [`  ${' '.repeat(width)}  next: ${finding.next}`]),
  ]);
  return ['', 'Findings:', ...lines];
}

function statusSections(view: StatusView): SectionTable[] {
  return [
    {
      title: 'Definitions:',
      columns: ['KEY', 'VERSIONS', 'INSTANCES', 'INCIDENTS', 'FAILED JOBS'],
      rows: view.definitions.map((definition) => ({
        KEY: definition.key,
        VERSIONS: definition.versions,
        INSTANCES: definition.instances,
        INCIDENTS: definition.incidents,
        'FAILED JOBS': definition.failedJobs,
      })),
    },
    {
      title: 'Incidents:',
      columns: ['COUNT', 'KEY', 'ACTIVITY', 'TYPE', 'LAST', 'ROOT CAUSE'],
      rows: view.incidents.map((group) => ({
        COUNT: group.count,
        KEY: group.processDefinitionKey,
        ACTIVITY: group.activityId,
        TYPE: group.type,
        LAST: group.lastAt,
        'ROOT CAUSE': group.rootCause ?? group.message,
      })),
    },
    {
      title: 'External tasks:',
      columns: ['TOPIC', 'WAITING', 'LOCKED', 'EXPIRED', 'FAILED', 'OLDEST', 'WORKERS'],
      rows: view.externalTasks.map((topic) => ({
        TOPIC: topic.topic,
        WAITING: topic.waiting,
        LOCKED: topic.locked,
        EXPIRED: topic.lockExpired,
        FAILED: topic.failed,
        OLDEST: topic.oldestWaitingSince ?? '',
        WORKERS: topic.workers.join(', '),
      })),
    },
  ];
}

export function statusText(view: StatusView, maxWidth: number): string {
  const { engine } = view;
  const facts = [
    ...(engine.engine === undefined ? [] : [`engine ${engine.engine}`]),
    `version ${engine.version ?? 'unknown'}`,
    formatElapsed(engine.latencyMs),
  ];
  const header = headerBlock([
    ['Engine', `${engine.url} (${facts.join(', ')})`],
    ['Status', view.status],
  ]);
  const sections = statusSections(view).flatMap((table) => section(table, maxWidth));
  return text([...header, ...findingLines(view), ...sections, '', ...statusLines(view)]);
}

export function batchText(view: BatchView): string {
  const { batch } = view;
  return text(
    headerBlock([
      ['Batch', `${batch.id} (${batch.type})`],
      ['Total jobs', batch.totalJobs],
      ['Failed jobs', batch.failedJobs],
      ['Started', batch.startTime],
      ['Ended', batch.endTime],
      ['Waited', waitedText(view.waited)],
    ]),
  );
}
