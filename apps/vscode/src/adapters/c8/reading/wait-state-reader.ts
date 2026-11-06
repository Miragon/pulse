import {
  ElementId,
  IncidentId,
  InstanceId,
  IsoTimestamp,
  type WaitState,
} from "../../../contract/index.js"
import { BpmnText } from "../mapping/bpmn-text.js"
import { Present, type ElementInstanceView, type InstanceView } from "../rest/index.js"
import type { JobView, MessageSubscriptionView, UserTaskView } from "../rest/index.js"
import type { Diagrams } from "./diagrams.js"

export interface MemberReads {
  readonly instance: InstanceView
  readonly active: readonly ElementInstanceView[]
  readonly jobs: readonly JobView[]
  readonly tasks: readonly UserTaskView[]
  readonly subscriptions: readonly MessageSubscriptionView[]
}

type WaitBase = Pick<WaitState, "instanceId" | "elementId" | "elementName" | "since" | "incidentId">

const NO_WAIT_OF_ITS_OWN: ReadonlySet<string> = new Set([
  "PROCESS",
  "SUB_PROCESS",
  "EVENT_SUB_PROCESS",
  "AD_HOC_SUB_PROCESS",
  "AD_HOC_SUB_PROCESS_INNER_INSTANCE",
  "MULTI_INSTANCE_BODY",
  "CALL_ACTIVITY",
  "SEQUENCE_FLOW",
])
const DONE_JOBS: ReadonlySet<string> = new Set(["COMPLETED", "CANCELED", "ERROR_THROWN"])
const OWN_JOBS: ReadonlySet<string> = new Set(["BPMN_ELEMENT", "AD_HOC_SUB_PROCESS"])

export class WaitStateReader {
  constructor(private readonly diagrams: Diagrams) {}

  async of(reads: MemberReads): Promise<WaitState[]> {
    const waits: WaitState[] = []
    for (const element of reads.active) {
      const wait = await this.waitOf(element, reads)
      if (wait !== undefined) {
        waits.push(wait)
      }
    }
    return waits
  }

  private async waitOf(
    element: ElementInstanceView,
    reads: MemberReads,
  ): Promise<WaitState | undefined> {
    const base = WaitStateReader.baseOf(element, reads.instance)
    const task = reads.tasks.find((item) => item.elementInstanceKey === element.key)
    if (task !== undefined) {
      return {
        ...base,
        kind: "userTask",
        ...Present.fields({
          assignee: task.assignee,
          dueAt: task.dueDate === undefined ? undefined : IsoTimestamp(task.dueDate),
        }),
      }
    }
    const job = WaitStateReader.jobOf(element, reads.jobs)
    if (job !== undefined) {
      return {
        ...base,
        kind: "workerTask",
        taskType: job.type,
        ...Present.fields({ retriesLeft: job.retries }),
      }
    }
    return NO_WAIT_OF_ITS_OWN.has(element.type)
      ? undefined
      : this.subscribedOrCatching(element, base, reads)
  }

  private async subscribedOrCatching(
    element: ElementInstanceView,
    base: WaitBase,
    reads: MemberReads,
  ): Promise<WaitState> {
    const subscription = reads.subscriptions.find((item) => item.elementInstanceKey === element.key)
    if (subscription !== undefined) {
      return {
        ...base,
        kind: "message",
        ...Present.fields({
          messageName: subscription.messageName,
          correlationKey: subscription.correlationKey,
        }),
      }
    }
    const xml = await this.diagrams.xml(reads.instance.definitionKey)
    const kind = xml === undefined ? undefined : BpmnText.catchKind(xml, element.elementId)
    return kind === undefined
      ? { ...base, kind: "other", description: element.type }
      : { ...base, kind }
  }

  private static jobOf(
    element: ElementInstanceView,
    jobs: readonly JobView[],
  ): JobView | undefined {
    const open = jobs.filter(
      (job) => job.elementInstanceKey === element.key && !DONE_JOBS.has(job.state),
    )
    return open.find((job) => job.kind === undefined || OWN_JOBS.has(job.kind)) ?? open[0]
  }

  private static baseOf(element: ElementInstanceView, instance: InstanceView): WaitBase {
    return {
      instanceId: InstanceId(instance.key),
      elementId: ElementId(element.elementId),
      since: IsoTimestamp(element.startedAt),
      ...Present.fields({
        elementName: element.name,
        incidentId: element.incidentKey === undefined ? undefined : IncidentId(element.incidentKey),
      }),
    }
  }
}
