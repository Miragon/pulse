import { Present } from "../present.js"
import type { JsonObject } from "../views/json-object.js"
import type { WaitingAtView } from "../views/views.js"
import { ActivityIndex, type ActivityNode } from "./activity-index.js"
import type { TreeNode } from "./instance-tree.js"

export interface WaitFacts {
  readonly instanceId: string
  readonly tree: readonly TreeNode[]
  readonly activityTrees: readonly JsonObject[]
  readonly incidents: readonly JsonObject[]
  readonly tasks: readonly JsonObject[]
  readonly externalTasks: readonly JsonObject[]
  readonly jobs: readonly JsonObject[]
  readonly timerJobIds: ReadonlySet<string>
  readonly jobDefinitions: readonly JsonObject[]
  readonly subscriptions: readonly JsonObject[]
}

interface Trigger {
  readonly processInstanceId: string | undefined
  readonly activityId: string
  readonly node: ActivityNode | undefined
  readonly since: string | undefined
  readonly incidentId?: string | undefined
}

interface Wait {
  readonly view: WaitingAtView
  readonly resourceId: string
}

const EVENT_KINDS: ReadonlySet<string> = new Set(["message", "signal", "conditional"])
const KIND_ORDER = [
  "userTask",
  "externalTask",
  "message",
  "signal",
  "conditional",
  "timer",
  "asyncContinuation",
  "other",
]

export class WaitStates {
  private readonly index: ActivityIndex
  private readonly covered = new Set<string>()

  constructor(private readonly facts: WaitFacts) {
    this.index = new ActivityIndex(facts.activityTrees)
  }

  all(): WaitingAtView[] {
    const waits = [
      ...this.facts.tasks.map((task) => this.userTask(task)),
      ...this.facts.externalTasks.map((task) => this.externalTask(task)),
      ...this.facts.jobs.map((job) => this.job(job)),
      ...this.facts.subscriptions.flatMap((subscription) => this.subscription(subscription)),
    ]
    return this.sorted([...waits, ...this.others()])
  }

  private userTask(task: JsonObject): Wait {
    const activityId = task.requiredString("taskDefinitionKey")
    const trigger = {
      processInstanceId: task.optionalString("processInstanceId"),
      activityId,
      node: this.index.forExecution(task.optionalString("executionId"), activityId),
      since: task.optionalString("created"),
    }
    return this.waitOf(task, trigger, {
      kind: "userTask",
      ...Present.fields({
        assignee: task.optionalString("assignee"),
        due: task.optionalString("due"),
      }),
    })
  }

  private externalTask(task: JsonObject): Wait {
    const activityId = task.requiredString("activityId")
    const node =
      this.index.byId(task.optionalString("activityInstanceId")) ??
      this.index.forExecution(task.optionalString("executionId"), activityId)
    const trigger = {
      processInstanceId: task.optionalString("processInstanceId"),
      activityId,
      node,
      since: task.optionalString("createTime"),
      incidentId: this.incidentOf(task.requiredString("id")),
    }
    return this.waitOf(task, trigger, {
      kind: "externalTask",
      topic: task.optionalString("topicName") ?? "",
      ...Present.fields({ retries: task.optionalNumber("retries") }),
    })
  }

  private job(job: JsonObject): Wait {
    const jobId = job.requiredString("id")
    const timer = this.facts.timerJobIds.has(jobId)
    const trigger = this.jobTrigger(job, timer)
    if (timer) {
      return this.waitOf(job, trigger, {
        kind: "timer",
        ...Present.fields({ dueDate: job.optionalString("dueDate") }),
      })
    }
    return this.waitOf(job, trigger, {
      kind: "asyncContinuation",
      ...Present.fields({ retries: job.optionalNumber("retries") ?? 0 }),
    })
  }

  private jobTrigger(job: JsonObject, timer: boolean): Trigger {
    const definitionId = job.optionalString("jobDefinitionId")
    const definition = this.facts.jobDefinitions.find(
      (candidate) => candidate.optionalString("id") === definitionId,
    )
    const known = definition?.optionalString("activityId") ?? job.optionalString("failedActivityId")
    const executionId = job.optionalString("executionId")
    const asTransition = () => this.index.transition(executionId, known)
    const asActivity = () => this.index.forExecution(executionId, known)
    const node = timer ? (asActivity() ?? asTransition()) : (asTransition() ?? asActivity())
    return {
      processInstanceId: job.optionalString("processInstanceId"),
      activityId: known ?? node?.activityId ?? "",
      node,
      since: job.optionalString("createTime"),
      incidentId: this.incidentOf(job.requiredString("id")),
    }
  }

  private subscription(subscription: JsonObject): Wait[] {
    const kind = subscription.optionalString("eventType") ?? ""
    if (!EVENT_KINDS.has(kind)) {
      return []
    }
    const activityId = subscription.requiredString("activityId")
    const trigger = {
      processInstanceId: subscription.optionalString("processInstanceId"),
      activityId,
      node: this.index.forExecution(subscription.optionalString("executionId"), activityId),
      since: subscription.optionalString("createdDate"),
    }
    return [
      this.waitOf(subscription, trigger, {
        kind,
        ...Present.fields({ eventName: subscription.optionalString("eventName") }),
      }),
    ]
  }

  private others(): Wait[] {
    const callers = new Set(this.facts.tree.flatMap((node) => node.parentId ?? []))
    return this.index.nodes
      .filter((node) => node.leaf && !node.root && !this.covered.has(node.id))
      .filter(
        (node) => !(node.activityType === "callActivity" && callers.has(node.processInstanceId)),
      )
      .map((node) => ({
        view: {
          ...this.baseOf({
            processInstanceId: node.processInstanceId,
            activityId: node.activityId,
            node,
            since: undefined,
          }),
          kind: "other",
        },
        resourceId: node.executionIds[0] ?? "",
      }))
  }

  private waitOf(
    resource: JsonObject,
    trigger: Trigger,
    details: Pick<WaitingAtView, "kind"> & Partial<WaitingAtView>,
  ): Wait {
    return {
      view: { ...this.baseOf(trigger), ...details },
      resourceId: resource.requiredString("id"),
    }
  }

  private baseOf(trigger: Trigger): Omit<WaitingAtView, "kind"> {
    const { node, activityId } = trigger
    if (node !== undefined) {
      this.covered.add(node.id)
    }
    const own = node?.activityId === activityId ? node : undefined
    return {
      activityId,
      ...Present.fields({
        processInstanceId: this.calledInstanceOf(
          trigger.processInstanceId ?? node?.processInstanceId,
        ),
        activityName: own?.activityName,
        activityType: own?.activityType,
        attachedTo: own === undefined ? WaitStates.hostOf(node) : undefined,
        since: trigger.since,
        incidentId: trigger.incidentId,
      }),
    }
  }

  private static hostOf(node: ActivityNode | undefined): string | undefined {
    return node === undefined || node.root ? undefined : node.activityId
  }

  private calledInstanceOf(instanceId: string | undefined): string | undefined {
    return instanceId === this.facts.instanceId ? undefined : instanceId
  }

  private incidentOf(resourceId: string): string | undefined {
    const isRoot = (incident: JsonObject) =>
      incident.optionalString("id") === incident.optionalString("rootCauseIncidentId")
    return this.facts.incidents
      .filter((incident) => incident.optionalString("configuration") === resourceId)
      .sort(
        (left, right) =>
          Number(isRoot(right)) - Number(isRoot(left)) ||
          ActivityIndex.compare(left.requiredString("id"), right.requiredString("id")),
      )[0]
      ?.requiredString("id")
  }

  private sorted(waits: readonly Wait[]): WaitingAtView[] {
    const depths = new Map(this.facts.tree.map((node) => [node.id, node.depth]))
    const keyOf = ({ view, resourceId }: Wait) => {
      const instanceId = view.processInstanceId ?? this.facts.instanceId
      const depth = depths.get(instanceId) ?? 0
      return { depth, instanceId, kind: KIND_ORDER.indexOf(view.kind), resourceId, view }
    }
    return waits
      .map(keyOf)
      .sort(
        (left, right) =>
          left.depth - right.depth ||
          ActivityIndex.compare(left.instanceId, right.instanceId) ||
          ActivityIndex.compare(left.view.activityId, right.view.activityId) ||
          left.kind - right.kind ||
          ActivityIndex.compare(left.resourceId, right.resourceId),
      )
      .map((key) => key.view)
  }
}
