import type { EngineHttp } from "../http/engine-http.js"
import { EngineRequestError } from "../http/engine-request-error.js"
import { JsonObject } from "../views/json-object.js"
import type { InspectView, VariableView } from "../views/views.js"
import { InspectedInstance, type ActiveFacts } from "./inspected-instance.js"
import { InstanceTree } from "./instance-tree.js"
import { ParallelReads } from "./parallel-reads.js"

const NO_VALUES = { deserializeValues: "false" }
const MAX_CAUSES = 10
const CAUSE_PATHS: ReadonlyMap<string, string> = new Map([
  ["failedJob", "/job/{}/stacktrace"],
  ["failedExternalTask", "/external-task/{}/errorDetails"],
])

export class InstanceInspection {
  constructor(private readonly http: EngineHttp) {}

  async inspect(id: string, attempts = 2): Promise<InspectView | undefined> {
    const [runtime, history] = await Promise.all([
      this.record(`/process-instance/${encodeURIComponent(id)}`),
      this.record(`/history/process-instance/${encodeURIComponent(id)}`),
    ])
    if (runtime === undefined) {
      return history === undefined ? undefined : this.ended(id, history)
    }
    const facts = await this.activeFacts(id, runtime, history)
    if (facts === undefined) {
      return attempts > 1 ? this.inspect(id, attempts - 1) : undefined
    }
    return new InspectedInstance(id, history).active(facts, await this.causes(facts.incidents))
  }

  private async ended(id: string, history: JsonObject): Promise<InspectView> {
    const [rows, timeline] = await Promise.all([
      this.http.readAll("/history/variable-instance", { processInstanceId: id, ...NO_VALUES }),
      this.timeline(id),
    ])
    const scope = JsonObject.listOf(rows, "historic variables").filter(
      (row) => row.optionalString("activityInstanceId") === id,
    )
    const variables = scope.map((row) =>
      InspectedInstance.variableOf(row.requiredString("name"), row),
    )
    return new InspectedInstance(id, history).ended(history, variables, timeline)
  }

  private async activeFacts(
    id: string,
    runtime: JsonObject,
    history: JsonObject | undefined,
  ): Promise<ActiveFacts | undefined> {
    const [tree, parentId] = await Promise.all([
      new InstanceTree(this.http).below(runtime),
      history === undefined ? this.parentOf(id) : undefined,
    ])
    const ids = tree.nodes.map((node) => node.id)
    const [instances, items, variables, timeline] = await Promise.all([
      ParallelReads.map(ids, (instanceId) => this.perInstance(instanceId)),
      this.perTree(ids, [...new Set(tree.nodes.map((node) => node.definitionId))]),
      this.scopeVariables(id),
      this.timeline(id),
    ])
    const gone = new Set(
      instances.filter((row) => row.activities === undefined).map((row) => row.id),
    )
    if (gone.has(id) || variables === undefined) {
      return undefined
    }
    const present = instances.filter((row) => row.activities !== undefined)
    return {
      runtime,
      parentId,
      tree: tree.nodes.filter((node) => !gone.has(node.id)),
      truncated: tree.truncated,
      activityTrees: present.flatMap((row) => row.activities ?? []),
      incidents: present.flatMap((row) => row.incidents),
      subscriptions: present.flatMap((row) => row.subscriptions),
      ...items,
      variables,
      timeline,
    }
  }

  private async perInstance(id: string) {
    const [activities, incidents, subscriptions] = await Promise.all([
      this.record(`/process-instance/${encodeURIComponent(id)}/activity-instances`),
      this.list("/incident", { processInstanceId: id }),
      this.list("/event-subscription", { processInstanceId: id }),
    ])
    return { id, activities, incidents, subscriptions }
  }

  private async perTree(ids: readonly string[], definitionIds: readonly string[]) {
    const [tasks, externalTasks, jobs, timers, definitions, jobDefinitions] = await Promise.all([
      ParallelReads.byIds(ids, (list) => this.list("/task", { processInstanceIdIn: list })),
      ParallelReads.byIds(ids, (list) =>
        this.list("/external-task", { processInstanceIdIn: list }),
      ),
      ParallelReads.byIds(ids, (list) => this.list("/job", { processInstanceIds: list })),
      ParallelReads.byIds(ids, (list) =>
        this.list("/job", { processInstanceIds: list, timers: "true" }),
      ),
      ParallelReads.byIds(definitionIds, (list) =>
        this.list("/process-definition", { processDefinitionIdIn: list }),
      ),
      ParallelReads.map(definitionIds, (definitionId) =>
        this.list("/job-definition", { processDefinitionId: definitionId }),
      ),
    ])
    const timerJobIds = new Set(timers.map((timer) => timer.requiredString("id")))
    return {
      tasks,
      externalTasks,
      jobs,
      timerJobIds,
      definitions,
      jobDefinitions: jobDefinitions.flat(),
    }
  }

  private async scopeVariables(id: string): Promise<VariableView[] | undefined> {
    try {
      const map = JsonObject.of(
        await this.http.read(`/process-instance/${encodeURIComponent(id)}/variables`, NO_VALUES),
        "variables",
      )
      return map
        .entries()
        .map(([name, value]) => InspectedInstance.variableOf(name, JsonObject.of(value, name)))
    } catch (error: unknown) {
      if (EngineRequestError.isMissingResource(error)) {
        return undefined
      }
      throw error
    }
  }

  private async timeline(id: string): Promise<JsonObject[]> {
    return this.list("/history/activity-instance", {
      processInstanceId: id,
      sortBy: "occurrence",
      sortOrder: "asc",
    })
  }

  private async parentOf(id: string): Promise<string | undefined> {
    const parents = await this.http.read("/process-instance", {
      subProcessInstance: id,
      maxResults: "1",
    })
    return JsonObject.listOf(parents, "parent instances")[0]?.optionalString("id")
  }

  private async causes(incidents: readonly JsonObject[]): Promise<ReadonlyMap<string, string>> {
    const roots = InspectedInstance.rootIncidents(incidents).slice(0, MAX_CAUSES)
    const texts = await ParallelReads.map(roots, (incident) => this.causeOf(incident))
    return new Map(
      roots.flatMap((incident, index) => {
        const text = texts[index]
        return text === undefined ? [] : [[incident.requiredString("id"), text] as const]
      }),
    )
  }

  private async causeOf(incident: JsonObject): Promise<string | undefined> {
    const path = CAUSE_PATHS.get(incident.requiredString("incidentType"))
    const configuration = incident.optionalString("configuration")
    if (path === undefined || configuration === undefined) {
      return undefined
    }
    try {
      return await this.http.text(path.replace("{}", encodeURIComponent(configuration)))
    } catch (error: unknown) {
      if (EngineRequestError.isMissingResource(error)) {
        return undefined
      }
      throw error
    }
  }

  private async record(path: string): Promise<JsonObject | undefined> {
    const answer = await this.http.find(path)
    return answer === undefined ? undefined : JsonObject.of(answer, path)
  }

  private async list(path: string, query: Record<string, string>): Promise<JsonObject[]> {
    return JsonObject.listOf(await this.http.readAll(path, query), path)
  }
}
