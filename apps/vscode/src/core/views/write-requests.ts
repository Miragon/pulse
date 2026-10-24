import { ValueKinds, type ValueKind } from '../../contract/index.js';
import type { WriteRequest } from '../panels/panel-context.js';
import type {
  IncidentRow,
  InstanceView,
  LiveUpdates,
  MoveOption,
  MoveTarget,
  VariableRow,
} from '../protocol/index.js';
import { InstanceViewElements } from './instance-view-elements.js';
import { Labels } from './labels.js';

export interface ChosenMove {
  readonly before: InstanceView;
  readonly option: MoveOption;
  readonly target: MoveTarget;
  readonly reason: string;
}

export interface DataFreshness {
  readonly ageMs: number;
  readonly live?: LiveUpdates | undefined;
}

const MAX_FACT_LENGTH = 160;
const KIND_WORDS: Readonly<Record<ValueKind, string>> = {
  string: 'text',
  integer: 'whole number',
  decimal: 'number',
  boolean: 'true or false',
  date: 'date',
  json: 'JSON',
  null: 'null',
  opaque: 'value',
};
const MAX_VALUE_LENGTH = 60;
const JUST_NOW_MS = 5000;
const LIVE_NOTES: Partial<Record<LiveUpdates['status'], string>> = {
  paused: ' · live updates are paused',
  reconnecting: ' · the last live update failed',
  stopped: ' · live updates stopped',
  off: ' · live updates are off',
};

export class WriteRequests {
  static retry(view: InstanceView, row: IncidentRow, freshness: DataFreshness): WriteRequest {
    const where = row.inCalledInstance;
    return {
      action: 'retryIncident',
      title: `Retry the incident at ${InstanceViewElements.nameOf(view, row.elementId)}?`,
      facts: [
        WriteRequests.instanceFact(view),
        ...(where === undefined
          ? []
          : [`In called instance ${where.bpmnProcessId} ${where.shortId}`]),
        WriteRequests.shortened(
          `${row.typeLabel}: ${row.rootCause ?? row.message}`,
          MAX_FACT_LENGTH,
        ),
        `Retries ${row.retriesLeft ?? 0} → 1`,
        WriteRequests.freshnessFact(freshness),
      ],
      confirmLabel: 'Retry',
    };
  }

  static variableChange(
    view: InstanceView,
    row: VariableRow,
    valueJson: string,
    freshness: DataFreshness,
  ): WriteRequest {
    const before = WriteRequests.shortened(row.valueJson, MAX_VALUE_LENGTH);
    const after = WriteRequests.shortened(valueJson.trim(), MAX_VALUE_LENGTH);
    const type = row.type ?? 'Value';
    const label =
      row.editor === 'any' ? `${type} → ${KIND_WORDS[ValueKinds.ofJson(valueJson)]}` : type;
    return {
      action: 'setVariable',
      title: `Change ${row.name}?`,
      facts: [
        WriteRequests.instanceFact(view),
        `${label}: ${before} → ${after}`,
        ...WriteRequests.shadowNote(view, row),
        WriteRequests.freshnessFact(freshness),
      ],
      confirmLabel: 'Change',
    };
  }

  static move(chosen: ChosenMove, freshness: DataFreshness): WriteRequest {
    const { before: view, option, target, reason } = chosen;
    const rerun = option.fromElementId === target.elementId;
    return {
      action: 'moveToken',
      title: rerun
        ? `Run ${option.fromLabel} again?`
        : `Move the token from ${option.fromLabel} to ${target.label}?`,
      facts: [
        WriteRequests.instanceFact(view),
        ...target.effects,
        ...target.warnings.map((warning) => `Warning: ${warning}`),
        WriteRequests.shortened(`Reason: ${reason.trim()}`, MAX_FACT_LENGTH),
        WriteRequests.freshnessFact(freshness),
        "This can't be undone.",
      ],
      confirmLabel: rerun ? 'Run again' : 'Move',
    };
  }

  private static instanceFact(view: InstanceView): string {
    const { instance } = view;
    const which =
      instance.businessKey === undefined
        ? instance.shortId
        : `${instance.businessKey} (${instance.shortId})`;
    return `Instance ${which} · ${instance.processName} v${instance.version}`;
  }

  private static freshnessFact(freshness: DataFreshness): string {
    const age =
      freshness.ageMs < JUST_NOW_MS
        ? 'Data read just now'
        : `Data read ${Labels.duration(freshness.ageMs)} ago`;
    const status = freshness.live?.status;
    return `${age}${status === undefined ? '' : (LIVE_NOTES[status] ?? '')}`;
  }

  private static shadowNote(view: InstanceView, row: VariableRow): string[] {
    const shadows = row.shadowedAt ?? [];
    if (shadows.length === 0) {
      return [];
    }
    const elements = shadows
      .map((elementId) => InstanceViewElements.nameOf(view, elementId))
      .join(', ');
    return [`${elements} keeps its own ${row.name}; this change does not reach it.`];
  }

  private static shortened(text: string, limit: number): string {
    return text.length <= limit ? text : `${text.slice(0, limit - 1)}…`;
  }
}
