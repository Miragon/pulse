/**
 * The instance view of inspect, wait, advance, retry and deploy (design §17.4), assembled from
 * what `inspect` loaded. Pure and deterministic: the view does not depend on the order of the
 * engine's lists (except the timeline, which keeps the history order).
 */

import { compact } from '../util.js';
import { nextCommands } from './next.js';
import {
  compareText,
  compareTime,
  definitionKeyOf,
  field,
  num,
  type Rec,
  str,
  yes,
} from './records.js';
import { timelineOf } from './timeline.js';
import type {
  ChildView,
  DefinitionView,
  IncidentView,
  InstanceData,
  InstanceState,
  InstanceView,
} from './types.js';
import { plainVariables } from './variables.js';
import { waitStates } from './waits.js';

function definitionView(dto: Rec | undefined, id: string): DefinitionView {
  return {
    key: str(dto, 'key') ?? definitionKeyOf(id) ?? '',
    ...compact({ version: num(dto, 'version'), name: str(dto, 'name') }),
    id,
  };
}

/** From the history record, else from the definition list, else from the definition id. */
function definitionOf(data: InstanceData): DefinitionView {
  const { history, runtime } = data;
  const historyId = str(history, 'processDefinitionId');
  if (historyId !== undefined) {
    return {
      key: str(history, 'processDefinitionKey') ?? definitionKeyOf(historyId) ?? '',
      ...compact({
        version: num(history, 'processDefinitionVersion'),
        name: str(history, 'processDefinitionName'),
      }),
      id: historyId,
    };
  }
  const id = field(runtime, 'definitionId');
  return definitionView(
    data.definitions.find((definition) => str(definition, 'id') === id),
    id,
  );
}

function stateOf(data: InstanceData): InstanceState {
  if (data.runtime !== undefined) return yes(data.runtime, 'suspended') ? 'SUSPENDED' : 'ACTIVE';
  return (str(data.history, 'state') ?? 'COMPLETED') as InstanceState;
}

function header(data: InstanceData) {
  const { history, runtime } = data;
  const root = str(history, 'rootProcessInstanceId');
  return {
    id: data.id,
    ...compact({ businessKey: str(history, 'businessKey') ?? str(runtime, 'businessKey') }),
    definition: definitionOf(data),
    state: stateOf(data),
    ...compact({
      startTime: str(history, 'startTime'),
      endTime: str(history, 'endTime'),
      durationMs: num(history, 'durationInMillis'),
      deleteReason: str(history, 'deleteReason'),
      parentId: str(history, 'superProcessInstanceId') ?? data.parentId,
      rootId: root === data.id ? undefined : root,
    }),
  };
}

function isRoot(incident: Rec): boolean {
  return str(incident, 'id') === str(incident, 'rootCauseIncidentId');
}

function incidentView(data: InstanceData, incident: Rec): IncidentView {
  const id = field(incident, 'id');
  const type = field(incident, 'incidentType');
  const pid = str(incident, 'processInstanceId');
  const configuration = str(incident, 'configuration');
  const cause = data.causes.get(id);
  const message = str(incident, 'incidentMessage');
  return {
    id,
    type,
    activityId: field(incident, 'activityId'),
    ...compact({
      processInstanceId: pid === data.id ? undefined : pid,
      message,
      // left out when it says the same as the message
      rootCause: cause?.rootCause === message ? undefined : cause?.rootCause,
      jobId: type === 'failedJob' ? configuration : undefined,
      externalTaskId: type === 'failedExternalTask' ? configuration : undefined,
    }),
    since: field(incident, 'incidentTimestamp'),
    ...compact({ annotation: str(incident, 'annotation'), stacktrace: cause?.stacktrace }),
  };
}

/** The open root cause incidents of the tree, by time and id. */
export function rootIncidents(incidents: readonly Rec[]): Rec[] {
  return incidents
    .filter(isRoot)
    .toSorted(
      (left, right) =>
        compareTime(str(left, 'incidentTimestamp'), str(right, 'incidentTimestamp')) ||
        compareText(field(left, 'id'), field(right, 'id')),
    );
}

function children(data: InstanceData): ChildView[] {
  const versions = new Map(
    data.definitions.map((definition) => [str(definition, 'id'), definition]),
  );
  return data.tree
    .filter((node) => node.depth > 0)
    .toSorted(
      (left, right) =>
        left.depth - right.depth ||
        compareText(left.definitionKey ?? '', right.definitionKey ?? '') ||
        compareText(left.id, right.id),
    )
    .map((node): ChildView => {
      const definition = versions.get(node.definitionId);
      return {
        id: node.id,
        parentId: node.parentId ?? data.id,
        key: node.definitionKey ?? field(definition, 'key'),
        ...compact({ version: num(definition, 'version'), businessKey: node.businessKey }),
        state: node.suspended ? 'SUSPENDED' : 'ACTIVE',
      };
    });
}

/** The instance view of the loaded data. */
export function instanceView(data: InstanceData): InstanceView {
  const active = data.runtime !== undefined;
  const propagated = data.incidents.filter((incident) => !isRoot(incident)).length;
  const view = {
    ...header(data),
    waitingAt: active ? waitStates(data) : [],
    incidents: rootIncidents(data.incidents).map((incident) => incidentView(data, incident)),
    ...compact({ propagatedIncidents: propagated > 0 ? propagated : undefined }),
    children: children(data),
    ...compact({
      variables: data.variables === undefined ? undefined : plainVariables(data.variables),
      timeline:
        data.timeline === undefined
          ? undefined
          : timelineOf(data.timeline, data.historicIncidents ?? []),
      truncated: data.truncated ? (true as const) : undefined,
    }),
  };
  return { ...view, next: nextCommands(view, data.historyRequested) };
}
