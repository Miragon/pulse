/**
 * Engine responses of the verified workflow fixture (test/integration/fixtures/workflow.bpmn) at
 * each of its wait states, shaped like the answers of Operaton 2.1.5 / Camunda 7.24 / CIB seven
 * 2.2.0, as `InstanceData` for the instance view assembly.
 */

import type { Rec } from '../../src/workflow/records.js';
import type { InstanceData, TreeNode } from '../../src/workflow/types.js';

export const P = 'adff9abe-c3e6-11f1-aa2b-66e6c1afd69e';
export const C = 'adffc1d4-c3e6-11f1-aa2b-66e6c1afd69e';
export const PARENT_DEF = 'workflow-parent:1:add41deb-c3e6-11f1-aa2b-66e6c1afd69e';
export const CHILD_DEF = 'workflow-child:1:add3f6da-c3e6-11f1-aa2b-66e6c1afd69e';
const T0 = '2026-10-09T13:38:15.430+0000';

export const runtimeDto: Rec = {
  id: P,
  definitionId: PARENT_DEF,
  definitionKey: 'workflow-parent',
  businessKey: 'WF-1',
  ended: false,
  suspended: false,
};

export const historyDto: Rec = {
  id: P,
  businessKey: 'WF-1',
  processDefinitionId: PARENT_DEF,
  processDefinitionKey: 'workflow-parent',
  processDefinitionVersion: 1,
  processDefinitionName: null,
  startTime: T0,
  endTime: null,
  durationInMillis: null,
  rootProcessInstanceId: P,
  superProcessInstanceId: null,
  state: 'ACTIVE',
};

export const DEFINITIONS: readonly Rec[] = [
  { id: PARENT_DEF, key: 'workflow-parent', version: 1, name: null },
  { id: CHILD_DEF, key: 'workflow-child', version: 1, name: 'Child' },
];

export const JOB_DEFINITIONS: readonly Rec[] = [
  {
    id: 'jd-timer',
    processDefinitionId: PARENT_DEF,
    activityId: 'cool-down',
    jobType: 'timer-intermediate-transition',
  },
  {
    id: 'jd-book',
    processDefinitionId: PARENT_DEF,
    activityId: 'book',
    jobType: 'async-continuation',
  },
];

export const ROOT_NODE: TreeNode = {
  id: P,
  definitionId: PARENT_DEF,
  definitionKey: 'workflow-parent',
  businessKey: 'WF-1',
  suspended: false,
  depth: 0,
};
export const CHILD_NODE: TreeNode = {
  id: C,
  parentId: P,
  definitionId: CHILD_DEF,
  definitionKey: 'workflow-child',
  suspended: false,
  depth: 1,
};

/** An activity instance tree of an instance with the given leaf activity instances. */
export function activityTree(
  pid: string,
  definitionId: string,
  children: readonly Rec[],
  transitions: readonly Rec[] = [],
): Rec {
  return {
    id: pid,
    parentActivityInstanceId: null,
    activityId: definitionId,
    activityType: 'processDefinition',
    processInstanceId: pid,
    processDefinitionId: definitionId,
    executionIds: [pid],
    childActivityInstances: children,
    childTransitionInstances: transitions,
  };
}

/** A leaf activity instance; `executions` are its execution ids, optionally ending with `name=<activity name>`. */
export function activity(
  id: string,
  activityId: string,
  activityType: string,
  executions: readonly string[],
): Rec {
  const name = executions.find((entry) => entry.startsWith('name='))?.slice('name='.length);
  return {
    id,
    activityId,
    activityType,
    activityName: name ?? null,
    executionIds: executions.filter((entry) => !entry.startsWith('name=')),
    childActivityInstances: [],
    childTransitionInstances: [],
  };
}

/** Data of an active instance with defaults for everything not given. */
export function activeData(overrides: Partial<InstanceData> = {}): InstanceData {
  return {
    id: P,
    runtime: runtimeDto,
    history: historyDto,
    tree: [ROOT_NODE],
    truncated: false,
    activityTrees: [activityTree(P, PARENT_DEF, [])],
    incidents: [],
    subscriptions: [],
    tasks: [],
    externalTasks: [],
    jobs: [],
    timerJobIds: new Set(),
    definitions: DEFINITIONS,
    jobDefinitions: JOB_DEFINITIONS,
    causes: new Map(),
    historyRequested: false,
    ...overrides,
  };
}

/** Waiting at the user task `approve` of the called child instance. */
export function approveStage(): InstanceData {
  return activeData({
    tree: [ROOT_NODE, CHILD_NODE],
    activityTrees: [
      activityTree(P, PARENT_DEF, [
        activity('call-approval:ai-1', 'call-approval', 'callActivity', ['ex-call']),
      ]),
      activityTree(C, CHILD_DEF, [
        activity('approve:ai-2', 'approve', 'userTask', [C, 'name=Approve']),
      ]),
    ],
    tasks: [
      {
        id: 'task-1',
        name: 'Approve',
        taskDefinitionKey: 'approve',
        executionId: C,
        processInstanceId: C,
        created: '2026-10-09T13:38:15.431+0000',
        assignee: null,
        due: null,
      },
    ],
    variables: { failBooking: { type: 'Boolean', value: true, valueInfo: {} } },
  });
}

/** Waiting at the external task `charge`. */
export function chargeStage(): InstanceData {
  return activeData({
    activityTrees: [
      activityTree(P, PARENT_DEF, [activity('charge:ai-3', 'charge', 'serviceTask', [P])]),
    ],
    externalTasks: [
      {
        id: 'et-1',
        activityId: 'charge',
        activityInstanceId: 'charge:ai-3',
        executionId: P,
        processInstanceId: P,
        topicName: 'workflow-charge',
        workerId: null,
        lockExpirationTime: null,
        retries: null,
        errorMessage: null,
        createTime: '2026-10-09T13:38:31.059+0000',
      },
    ],
  });
}

/** Waiting at the message catch event `paid`. */
export function paidStage(): InstanceData {
  return activeData({
    activityTrees: [
      activityTree(P, PARENT_DEF, [
        activity('paid:ai-4', 'paid', 'intermediateMessageCatch', ['ex-paid']),
      ]),
    ],
    subscriptions: [
      {
        id: 'sub-1',
        eventType: 'message',
        eventName: 'WorkflowPaid',
        executionId: 'ex-paid',
        processInstanceId: P,
        activityId: 'paid',
        createdDate: '2026-10-09T13:38:31.270+0000',
      },
    ],
  });
}

/** Waiting at the timer `cool-down`. */
export function coolDownStage(): InstanceData {
  return activeData({
    activityTrees: [
      activityTree(P, PARENT_DEF, [
        activity('cool-down:ai-5', 'cool-down', 'intermediateTimer', ['ex-timer']),
      ]),
    ],
    jobs: [
      {
        id: 'job-timer',
        jobDefinitionId: 'jd-timer',
        processInstanceId: P,
        executionId: 'ex-timer',
        retries: 3,
        dueDate: '2026-10-09T14:38:39.693+0000',
        createTime: '2026-10-09T13:38:39.693+0000',
        exceptionMessage: null,
      },
    ],
    timerJobIds: new Set(['job-timer']),
  });
}

export const BOOK_ERROR =
  "Unknown property used in expression: ${failBooking ? missingBean.run() : true}. Cause: Cannot resolve identifier 'missingBean'";

/** The asynchronous `book` failed for good: a failedJob incident. */
export function bookFailedStage(): InstanceData {
  return activeData({
    activityTrees: [
      activityTree(
        P,
        PARENT_DEF,
        [],
        [
          {
            id: 'book:ti-1',
            activityId: 'book',
            activityType: 'serviceTask',
            activityName: null,
            executionId: P,
          },
        ],
      ),
    ],
    jobs: [
      {
        id: 'job-book',
        jobDefinitionId: 'jd-book',
        processInstanceId: P,
        executionId: P,
        retries: 0,
        dueDate: null,
        createTime: '2026-10-09T13:38:39.700+0000',
        exceptionMessage: BOOK_ERROR,
        failedActivityId: 'book',
      },
    ],
    incidents: [
      {
        id: 'inc-1',
        rootCauseIncidentId: 'inc-1',
        causeIncidentId: 'inc-1',
        incidentType: 'failedJob',
        activityId: 'book',
        failedActivityId: 'book',
        processInstanceId: P,
        processDefinitionId: PARENT_DEF,
        configuration: 'job-book',
        incidentMessage: BOOK_ERROR,
        incidentTimestamp: '2026-10-09T13:38:39.877+0000',
        annotation: null,
      },
    ],
    causes: new Map([
      [
        'inc-1',
        { rootCause: "PropertyNotFoundException: Cannot resolve identifier 'missingBean'" },
      ],
    ]),
  });
}

/** Waiting at the receive task `wait-signal` (no message): an `other` wait state. */
export function waitSignalStage(): InstanceData {
  return activeData({
    activityTrees: [
      activityTree(P, PARENT_DEF, [
        activity('wait-signal:ai-6', 'wait-signal', 'receiveTask', [P]),
      ]),
    ],
  });
}

/** The instance completed: no runtime, the history record and its timeline. */
export function endedStage(): InstanceData {
  const { runtime: _, ...active } = activeData();
  return {
    ...active,
    history: {
      ...historyDto,
      endTime: '2026-10-09T13:38:58.766+0000',
      durationInMillis: 43336,
      state: 'COMPLETED',
    },
    tree: [],
    activityTrees: [],
  };
}
