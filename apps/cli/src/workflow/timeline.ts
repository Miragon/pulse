/**
 * The `--history` timeline of an instance (design §17.4): its historic activity instances in the
 * order of the history (BPMN order), each with the historic incidents of its activity. Pure.
 */

import { compact } from '../util.js';
import { compareText, compareTime, engineTime, field, num, type Rec, str, yes } from './records.js';
import type { TimelineEntry, TimelineIncident } from './types.js';

function entryOf(activity: Rec): TimelineEntry {
  return {
    activityId: field(activity, 'activityId'),
    ...compact({ activityName: str(activity, 'activityName') }),
    activityType: field(activity, 'activityType'),
    startTime: field(activity, 'startTime'),
    ...compact({
      endTime: str(activity, 'endTime'),
      durationMs: num(activity, 'durationInMillis'),
      canceled: yes(activity, 'canceled') ? (true as const) : undefined,
      assignee: str(activity, 'assignee'),
      calledProcessInstanceId: str(activity, 'calledProcessInstanceId'),
    }),
  };
}

function incidentOf(incident: Rec): TimelineIncident {
  let state: TimelineIncident['state'] = 'resolved';
  if (yes(incident, 'open')) state = 'open';
  else if (yes(incident, 'deleted')) state = 'deleted';
  return {
    type: field(incident, 'incidentType'),
    ...compact({ message: str(incident, 'incidentMessage') }),
    state,
  };
}

/**
 * The entry an incident belongs to: the last entry of its activity that started before it, else
 * the first one of its activity (an async continuation starts its activity only after the job
 * succeeded); incidents of activities without an entry are left out.
 */
function entryIndex(entries: readonly TimelineEntry[], incident: Rec): number | undefined {
  const activityId = str(incident, 'activityId');
  const created = engineTime(str(incident, 'createTime')) ?? Number.POSITIVE_INFINITY;
  const candidates = entries.flatMap((entry, index) =>
    entry.activityId === activityId ? [index] : [],
  );
  const before = candidates.filter(
    (index) => (engineTime(entries[index]?.startTime) ?? 0) <= created,
  );
  return before.at(-1) ?? candidates[0];
}

/** Timeline entries in the given (history) order with their incidents attached. */
export function timelineOf(activities: readonly Rec[], incidents: readonly Rec[]): TimelineEntry[] {
  const entries = activities.map(entryOf);
  const attached = new Map<number, TimelineIncident[]>();
  const ordered = incidents.toSorted(
    (left, right) =>
      compareTime(str(left, 'createTime'), str(right, 'createTime')) ||
      compareText(field(left, 'id'), field(right, 'id')),
  );
  for (const incident of ordered) {
    const index = entryIndex(entries, incident);
    if (index !== undefined)
      attached.set(index, [...(attached.get(index) ?? []), incidentOf(incident)]);
  }
  return entries.map((entry, index) => {
    const own = attached.get(index);
    return own === undefined ? entry : { ...entry, incidents: own };
  });
}
