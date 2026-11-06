import {
  BpmnProcessId,
  ElementId,
  InstanceId,
  IsoTimestamp,
  ValueKinds,
  type CalledInstance,
  type ElementRun,
  type Incident,
  type InstanceDetail,
  type Variable,
} from "../../../contract/index.js"
import { DefinitionRefs } from "../mapping/definition-refs.js"
import { Incidents } from "../mapping/incidents.js"
import { InstanceSummaries } from "../mapping/instance-summaries.js"
import { Keys } from "../mapping/keys.js"
import {
  Present,
  type CamundaClient,
  type ElementInstanceView,
  type IncidentView,
  type InstanceView,
  type JobView,
  type Rows,
  type SearchPage,
  type VariableView,
} from "../rest/index.js"
import type { Diagrams } from "./diagrams.js"
import { WaitStateReader, type MemberReads } from "./wait-state-reader.js"

const MOST_CALLED_INSTANCES = 50
const MOST_INCIDENTS = 200
const MOST_VARIABLES = 1000
const MEMBERS_AT_ONCE = 8
const NOT_ON_THE_PATH: ReadonlySet<string> = new Set(["PROCESS", "SEQUENCE_FLOW"])
const CANCELED = "TERMINATED"

interface Called {
  readonly instances: readonly InstanceView[]
  readonly truncated: boolean
}

interface MemberDetail extends MemberReads {
  readonly cut: boolean
}

interface TreeReads {
  readonly history: Rows<ElementInstanceView>
  readonly members: readonly MemberDetail[]
  readonly incidents: SearchPage<IncidentView>
  readonly jobs: Rows<JobView>
  readonly variables: readonly VariableView[]
}

export class InstanceDetailReader {
  private readonly waits: WaitStateReader

  constructor(
    private readonly client: CamundaClient,
    diagrams: Diagrams,
  ) {
    this.waits = new WaitStateReader(diagrams)
  }

  async read(instanceId: InstanceId): Promise<InstanceDetail | undefined> {
    const instance = Keys.isKey(instanceId) ? await this.client.instance(instanceId) : undefined
    if (instance === undefined) {
      return undefined
    }
    const called = await this.calledOf(instance)
    const reads = await this.readsOf(instance, called.instances)
    const path = [...reads.history.items].reverse()
    const elements = new Map(
      [...path, ...reads.members.flatMap((member) => member.active)].map(
        (element) => [element.key, element] as const,
      ),
    )
    const waits = await InstanceDetailReader.fewAtOnce(reads.members, (member) =>
      this.waits.of(member),
    )
    return {
      instance: InstanceSummaries.of(instance),
      path: path.flatMap((element) => InstanceDetailReader.runOf(element)),
      waitStates: waits.flat(),
      incidents: InstanceDetailReader.incidentsOf(reads),
      calledInstances: called.instances.map((member) =>
        InstanceDetailReader.calledInstanceOf(member, instance, elements),
      ),
      variables: reads.variables.map((variable) =>
        InstanceDetailReader.variableOf(variable, instance, elements),
      ),
      truncated: called.truncated || InstanceDetailReader.cutIn(reads),
    }
  }

  private async calledOf(root: InstanceView): Promise<Called> {
    const found: InstanceView[] = []
    let level = [root.key]
    while (level.length > 0) {
      const room = MOST_CALLED_INSTANCES - found.length
      const children = await this.client.instances(
        { parentProcessInstanceKey: { $in: level } },
        { limit: room + 1 },
      )
      found.push(...children.items.slice(0, room))
      if (children.items.length > room) {
        return { instances: found, truncated: true }
      }
      level = children.items.map((child) => child.key)
    }
    return { instances: found, truncated: false }
  }

  private async readsOf(root: InstanceView, called: readonly InstanceView[]): Promise<TreeReads> {
    const members = [root, ...called]
    const [history, details, incidents, variables] = await Promise.all([
      this.client.elementHistory(root.key),
      InstanceDetailReader.fewAtOnce(members, (member) => this.memberOf(member)),
      this.client.incidents(
        { processInstanceKey: { $in: members.map((member) => member.key) } },
        { limit: MOST_INCIDENTS },
      ),
      this.client.variables([root.key], MOST_VARIABLES),
    ])
    const jobs = await this.incidentJobsOf(incidents.items, details)
    return { history, members: details, incidents, jobs, variables }
  }

  private async memberOf(instance: InstanceView): Promise<MemberDetail> {
    if (instance.endedAt !== undefined) {
      return { instance, active: [], jobs: [], tasks: [], subscriptions: [], cut: false }
    }
    const [active, tasks, subscriptions] = await Promise.all([
      this.client.activeElements(instance.key),
      this.client.userTasks(instance.key),
      this.client.messageSubscriptions(instance.key),
    ])
    const jobs = await this.client.jobsOf(
      instance.key,
      active.items.map((element) => element.key),
    )
    return {
      instance,
      active: active.items,
      jobs: jobs.items,
      tasks: tasks.items,
      subscriptions: subscriptions.items,
      cut: [active, jobs, tasks, subscriptions].some((rows) => rows.cut),
    }
  }

  private async incidentJobsOf(
    incidents: readonly IncidentView[],
    members: readonly MemberDetail[],
  ): Promise<Rows<JobView>> {
    const known = members.flatMap((member) => member.jobs)
    const missing = incidents.flatMap((incident) =>
      incident.jobKey === undefined || known.some((job) => job.key === incident.jobKey)
        ? []
        : [incident.jobKey],
    )
    const found = await this.client.jobsByKey(missing)
    return { items: [...known, ...found.items], cut: found.cut }
  }

  private static async fewAtOnce<Item, Result>(
    items: readonly Item[],
    work: (item: Item) => Promise<Result>,
  ): Promise<Result[]> {
    const results = new Array<Result>(items.length)
    const queue = items.entries()
    let failed = false
    const worker = async (): Promise<void> => {
      for (const [index, item] of queue) {
        if (failed) {
          return
        }
        try {
          results[index] = await work(item)
        } catch (error: unknown) {
          failed = true
          throw error
        }
      }
    }
    await Promise.all(Array.from({ length: MEMBERS_AT_ONCE }, worker))
    return results
  }

  private static cutIn(reads: TreeReads): boolean {
    return (
      reads.history.cut ||
      reads.jobs.cut ||
      reads.members.some((member) => member.cut) ||
      reads.incidents.total > reads.incidents.items.length ||
      reads.variables.length >= MOST_VARIABLES
    )
  }

  private static incidentsOf(reads: TreeReads): Incident[] {
    return reads.incidents.items.flatMap((view) => {
      const member = reads.members.find((candidate) => candidate.instance.key === view.instanceKey)
      if (member === undefined) {
        return []
      }
      const job = reads.jobs.items.find((candidate) => candidate.key === view.jobKey)
      return [Incidents.of(view, DefinitionRefs.ofInstance(member.instance), job)]
    })
  }

  private static runOf(element: ElementInstanceView): ElementRun[] {
    if (NOT_ON_THE_PATH.has(element.type)) {
      return []
    }
    return [
      {
        elementId: ElementId(element.elementId),
        startedAt: IsoTimestamp(element.startedAt),
        canceled: element.state === CANCELED,
        ...Present.fields({
          elementName: element.name,
          endedAt: element.endedAt === undefined ? undefined : IsoTimestamp(element.endedAt),
        }),
      },
    ]
  }

  private static calledInstanceOf(
    member: InstanceView,
    root: InstanceView,
    elements: ReadonlyMap<string, ElementInstanceView>,
  ): CalledInstance {
    const caller =
      member.parentElementKey === undefined ? undefined : elements.get(member.parentElementKey)
    return {
      id: InstanceId(member.key),
      parentInstanceId: InstanceId(member.parentKey ?? root.key),
      bpmnProcessId: BpmnProcessId(member.bpmnProcessId),
      state: InstanceSummaries.stateOf(member),
      ...(caller === undefined ? {} : { calledFromElementId: ElementId(caller.elementId) }),
    }
  }

  private static variableOf(
    variable: VariableView,
    instance: InstanceView,
    elements: ReadonlyMap<string, ElementInstanceView>,
  ): Variable {
    const scope = variable.scopeKey === instance.key ? undefined : elements.get(variable.scopeKey)
    return {
      name: variable.name,
      scope:
        scope === undefined
          ? { kind: "instance" }
          : { kind: "element", elementId: ElementId(scope.elementId) },
      valueJson: variable.value,
      truncated: variable.truncated,
      kind: ValueKinds.ofJson(variable.value),
    }
  }
}
