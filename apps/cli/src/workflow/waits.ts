/**
 * Where an instance tree waits (design §17.4): one wait state per user task, external task, job
 * and message, signal or conditional event subscription, plus the leaf activity instances that
 * wait for something else. Pure and independent of the order of the engine's lists.
 */

import { compact } from '../util.js';
import { type ActivityIndex, type ActivityNode, indexActivities } from './activities.js';
import { amount, compareText, field, num, type Rec, str, yes } from './records.js';
import type { InstanceData, WaitKind, WaitState } from './types.js';

interface Context {
  readonly data: InstanceData;
  readonly index: ActivityIndex;
  /** Activity instances that already have a wait state. */
  readonly covered: Set<string>;
}

interface Trigger {
  readonly processInstanceId: string | undefined;
  readonly activityId: string;
  readonly node: ActivityNode | undefined;
  readonly since: string | undefined;
  readonly incidentId?: string | undefined;
}

const EVENT_KINDS: ReadonlySet<string> = new Set(['message', 'signal', 'conditional']);

/** The id of the wait state's resource: task, external task, job, subscription or execution. */
export function waitId(wait: WaitState): string {
  switch (wait.kind) {
    case 'userTask':
      return wait.taskId;
    case 'externalTask':
      return wait.externalTaskId;
    case 'timer':
    case 'asyncContinuation':
      return wait.jobId;
    case 'message':
    case 'signal':
    case 'conditional':
      return wait.eventSubscriptionId;
    case 'other':
      return wait.executionId;
  }
}

/** The activity a trigger on another activity (a boundary event) is attached to. */
function attachment(node: ActivityNode | undefined, activityId: string): string | undefined {
  if (node === undefined || node.root || node.activityId === activityId) return undefined;
  return node.activityId;
}

/** The common fields; the activity instance names the activity and the attachment. */
function base(context: Context, trigger: Trigger) {
  const { node, activityId } = trigger;
  if (node !== undefined) context.covered.add(node.id);
  const pid = trigger.processInstanceId ?? node?.processInstanceId;
  const own = node?.activityId === activityId ? node : undefined;
  return {
    ...compact({ processInstanceId: pid === context.data.id ? undefined : pid }),
    activityId,
    ...compact({
      activityName: own?.activityName,
      activityType: own?.activityType,
      attachedTo: attachment(node, activityId),
      since: trigger.since,
      incidentId: trigger.incidentId,
    }),
  };
}

/** The open incident of a job or external task (its `configuration`), root causes first. */
function incidentOf(context: Context, resourceId: string): string | undefined {
  const ids = context.data.incidents
    .filter((incident) => str(incident, 'configuration') === resourceId)
    .map((incident) => ({
      id: field(incident, 'id'),
      root: str(incident, 'id') === str(incident, 'rootCauseIncidentId'),
    }))
    .toSorted(
      (left, right) => Number(right.root) - Number(left.root) || compareText(left.id, right.id),
    );
  return ids[0]?.id;
}

function userTask(context: Context, task: Rec): WaitState[] {
  const taskId = str(task, 'id');
  if (taskId === undefined) return [];
  const activityId = field(task, 'taskDefinitionKey');
  const node = context.index.forExecution(str(task, 'executionId'), activityId);
  const pid = str(task, 'processInstanceId');
  const since = str(task, 'created');
  const common = base(context, { processInstanceId: pid, activityId, node, since });
  const name = str(task, 'name');
  return [
    {
      ...common,
      kind: 'userTask',
      taskId,
      ...compact({
        // left out when it is the activity name
        name: name === common.activityName ? undefined : name,
        assignee: str(task, 'assignee'),
        due: str(task, 'due'),
      }),
    },
  ];
}

function externalTask(context: Context, task: Rec): WaitState[] {
  const externalTaskId = str(task, 'id');
  if (externalTaskId === undefined) return [];
  const activityId = field(task, 'activityId');
  const node =
    context.index.byId(str(task, 'activityInstanceId')) ??
    context.index.forExecution(str(task, 'executionId'), activityId);
  const trigger = {
    processInstanceId: str(task, 'processInstanceId'),
    activityId,
    node,
    since: str(task, 'createTime'),
    incidentId: incidentOf(context, externalTaskId),
  };
  return [
    {
      ...base(context, trigger),
      kind: 'externalTask',
      externalTaskId,
      topic: field(task, 'topicName'),
      ...compact({
        workerId: str(task, 'workerId'),
        lockExpirationTime: str(task, 'lockExpirationTime'),
        retries: num(task, 'retries'),
        errorMessage: str(task, 'errorMessage'),
      }),
    },
  ];
}

/** The trigger of a job: its activity from the job definition, else the activity instance. */
function jobTrigger(context: Context, entry: Rec, timer: boolean, jobId: string): Trigger {
  const definition = context.data.jobDefinitions.find(
    (candidate) => str(candidate, 'id') === str(entry, 'jobDefinitionId'),
  );
  const known = str(definition, 'activityId') ?? str(entry, 'failedActivityId');
  const executionId = str(entry, 'executionId');
  // async continuations wait in a transition instance, timers in an activity instance
  const lookups = [
    () => context.index.transition(executionId, known),
    () => context.index.forExecution(executionId, known),
  ];
  const node = (timer ? lookups.toReversed() : lookups).reduce<ActivityNode | undefined>(
    (found, lookup) => found ?? lookup(),
    undefined,
  );
  return {
    processInstanceId: str(entry, 'processInstanceId'),
    activityId: known ?? node?.activityId ?? '',
    node,
    since: str(entry, 'createTime'),
    incidentId: incidentOf(context, jobId),
  };
}

function job(context: Context, entry: Rec): WaitState[] {
  const jobId = str(entry, 'id');
  if (jobId === undefined) return [];
  const timer = context.data.timerJobIds.has(jobId);
  const common = base(context, jobTrigger(context, entry, timer, jobId));
  const retries = amount(entry, 'retries');
  const dueDate = str(entry, 'dueDate');
  const suspended = yes(entry, 'suspended') ? (true as const) : undefined;
  if (timer) {
    return [
      {
        ...common,
        kind: 'timer',
        jobId,
        dueDate: dueDate ?? '',
        retries,
        ...compact({ suspended }),
      },
    ];
  }
  // an incident carries the same message
  const exceptionMessage =
    common.incidentId === undefined ? str(entry, 'exceptionMessage') : undefined;
  return [
    {
      ...common,
      kind: 'asyncContinuation',
      jobId,
      retries,
      ...compact({ dueDate, exceptionMessage, suspended }),
    },
  ];
}

function subscription(context: Context, entry: Rec): WaitState[] {
  const eventSubscriptionId = str(entry, 'id');
  const kind = field(entry, 'eventType');
  // compensation subscriptions are no wait states
  if (eventSubscriptionId === undefined || !EVENT_KINDS.has(kind)) return [];
  const activityId = field(entry, 'activityId');
  const executionId = field(entry, 'executionId');
  const node = context.index.forExecution(executionId, activityId);
  const trigger = {
    processInstanceId: str(entry, 'processInstanceId'),
    activityId,
    node,
    since: str(entry, 'createdDate'),
  };
  return [
    {
      ...base(context, trigger),
      kind: kind as 'message' | 'signal' | 'conditional',
      eventSubscriptionId,
      ...compact({ eventName: str(entry, 'eventName') }),
      executionId,
    },
  ];
}

/** Instances of the tree that have called instances below them. */
function callers(data: InstanceData): Set<string> {
  return new Set(data.tree.flatMap((node) => (node.parentId === undefined ? [] : [node.parentId])));
}

/** Leaf activity instances without a wait state, except call activities with called instances. */
function others(context: Context): WaitState[] {
  const calling = callers(context.data);
  return context.index.nodes
    .filter((node) => node.leaf && !node.root && !context.covered.has(node.id))
    .filter(
      (node) => !(node.activityType === 'callActivity' && calling.has(node.processInstanceId)),
    )
    .map((node) => ({
      ...base(context, {
        processInstanceId: node.processInstanceId,
        activityId: node.activityId,
        node,
        since: undefined,
      }),
      kind: 'other' as const,
      executionId: node.executionIds[0] ?? '',
    }));
}

const KIND_ORDER: readonly WaitKind[] = [
  'userTask',
  'externalTask',
  'message',
  'signal',
  'conditional',
  'timer',
  'asyncContinuation',
  'other',
];

/** By tree depth, instance id, activity id, kind and resource id. */
function sorted(data: InstanceData, waits: readonly WaitState[]): WaitState[] {
  const depth = new Map(data.tree.map((node) => [node.id, node.depth]));
  const key = (wait: WaitState) => {
    const pid = wait.processInstanceId ?? data.id;
    return { depth: depth.get(pid) ?? 0, pid };
  };
  return waits.toSorted((left, right) => {
    const a = key(left);
    const b = key(right);
    return (
      a.depth - b.depth ||
      compareText(a.pid, b.pid) ||
      compareText(left.activityId, right.activityId) ||
      KIND_ORDER.indexOf(left.kind) - KIND_ORDER.indexOf(right.kind) ||
      compareText(waitId(left), waitId(right))
    );
  });
}

/** Every wait state of the instance tree, sorted. */
export function waitStates(data: InstanceData): WaitState[] {
  const context: Context = { data, index: indexActivities(data.activityTrees), covered: new Set() };
  const waits = [
    ...data.tasks.flatMap((task) => userTask(context, task)),
    ...data.externalTasks.flatMap((task) => externalTask(context, task)),
    ...data.jobs.flatMap((entry) => job(context, entry)),
    ...data.subscriptions.flatMap((entry) => subscription(context, entry)),
  ];
  return sorted(data, [...waits, ...others(context)]);
}
