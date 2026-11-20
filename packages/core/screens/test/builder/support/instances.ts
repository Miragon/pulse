import {
  BpmnProcessId,
  DefinitionId,
  ElementId,
  IncidentId,
  InstanceId,
  IsoTimestamp,
  type CalledInstance,
  type DefinitionRef,
  type Incident,
  type IncidentDetails,
  type InstanceDetail,
  type InstanceSummary,
  type WaitState,
} from "@miragon/pulse-engine-core"
import type { InstanceFacts } from "../../../src/builder/index.js"

export class Instances {
  static readonly AS_OF = new Date("2026-11-19T09:00:00.000Z")
  static readonly ROOT = InstanceId("8f3c2a1e-0000-4000-8000-000000000001")
  static readonly CHILD = InstanceId("8f3c2a1e-0000-4000-8000-000000000002")
  static readonly GRANDCHILD = InstanceId("8f3c2a1e-0000-4000-8000-000000000003")
  static readonly CALLER = InstanceId("8f3c2a1e-0000-4000-8000-000000000000")
  static readonly ELEMENT = ElementId("Activity_Wait")
  static readonly CALL = ElementId("Activity_Call")
  static readonly SINCE = IsoTimestamp("2026-10-21T08:00:00.000Z")
  static readonly ORDER: DefinitionRef = {
    id: DefinitionId("order:1"),
    bpmnProcessId: BpmnProcessId("order"),
    version: 1,
    name: "Order fulfillment",
  }
  static readonly SCORING: DefinitionRef = {
    id: DefinitionId("scoring:3"),
    bpmnProcessId: BpmnProcessId("scoring"),
    version: 3,
  }

  static summary(changes: Partial<InstanceSummary> = {}): InstanceSummary {
    return {
      id: Instances.ROOT,
      definition: Instances.ORDER,
      state: "running",
      hasIncident: false,
      ...changes,
    }
  }

  static detail(changes: Partial<InstanceDetail> = {}): InstanceDetail {
    return {
      instance: Instances.summary(),
      path: [],
      waitStates: [],
      incidents: [],
      calledInstances: [],
      variables: [],
      truncated: false,
      ...changes,
    }
  }

  static facts(detail: InstanceDetail, changes: Partial<InstanceFacts> = {}): InstanceFacts {
    return {
      engine: "prod-a",
      asOf: Instances.AS_OF,
      detail,
      diagramXml: "<definitions/>",
      calledProcesses: [],
      caller: undefined,
      ...changes,
    }
  }

  static incident(id: string, changes: Partial<Incident> = {}): Incident {
    return {
      id: IncidentId(id),
      instanceId: Instances.ROOT,
      definition: Instances.ORDER,
      elementId: Instances.ELEMENT,
      type: "failedJob",
      message: "boom",
      createdAt: Instances.SINCE,
      ...changes,
    }
  }

  static complete(kind: IncidentDetails["kind"], rootCause: string): IncidentDetails {
    return { kind, text: `${rootCause}\n  more lines`, truncated: false, rootCause }
  }

  static called(
    id: InstanceId,
    parentInstanceId: InstanceId,
    changes: Partial<CalledInstance> = {},
  ): CalledInstance {
    return {
      id,
      parentInstanceId,
      bpmnProcessId: BpmnProcessId("scoring"),
      state: "running",
      calledFromElementId: Instances.CALL,
      ...changes,
    }
  }

  static wait(changes: Partial<WaitState> = {}): WaitState {
    return {
      kind: "asyncContinuation",
      instanceId: Instances.ROOT,
      elementId: Instances.ELEMENT,
      ...changes,
    } as WaitState
  }

  static chain(): Pick<InstanceDetail, "calledInstances"> {
    return {
      calledInstances: [
        Instances.called(Instances.CHILD, Instances.ROOT),
        Instances.called(Instances.GRANDCHILD, Instances.CHILD, {
          bpmnProcessId: BpmnProcessId("bureau"),
          calledFromElementId: ElementId("Activity_AskBureau"),
        }),
      ],
    }
  }
}
