import type { CamundaClient } from "./camunda-client.js"
import type { CamundaHttp } from "./camunda-http.js"
import { CamundaRequestError } from "./camunda-request-error.js"
import { CamundaViews } from "./camunda-views.js"
import { JsonObject } from "./json-object.js"
import { Present } from "./present.js"
import type {
  DefinitionView,
  ElementInstanceView,
  ElementStatisticsView,
  IncidentView,
  InstanceView,
  JobView,
  MessageSubscriptionView,
  ProcessStatisticsView,
  Rows,
  SearchFilter,
  SearchPage,
  TopologyView,
  UserTaskView,
  VariableView,
  VersionStatisticsView,
  Window,
} from "./views.js"

const PAGE_SIZE = 500
const MOST_ROWS = 10_000
const MOST_KEYS = 1_000
const OPEN_USER_TASKS = ["CREATING", "CREATED", "ASSIGNING", "UPDATING", "COMPLETING", "CANCELING"]
const OPEN_SUBSCRIPTIONS = ["CREATED", "MIGRATED"]

const NEWEST_INSTANCES_FIRST = [
  { field: "startDate", order: "DESC" },
  { field: "processInstanceKey", order: "ASC" },
]
const NEWEST_INCIDENTS_FIRST = [
  { field: "creationTime", order: "DESC" },
  { field: "incidentKey", order: "ASC" },
]
const IN_START_ORDER = [
  { field: "startDate", order: "ASC" },
  { field: "elementInstanceKey", order: "ASC" },
]
const NEWEST_ELEMENTS_FIRST = [
  { field: "startDate", order: "DESC" },
  { field: "elementInstanceKey", order: "DESC" },
]

export class RestCamundaClient implements CamundaClient {
  constructor(private readonly http: CamundaHttp) {}

  async topology(): Promise<TopologyView> {
    return CamundaViews.topology(JsonObject.of(await this.http.get("/topology"), "topology"))
  }

  latestDefinitions(): Promise<readonly DefinitionView[]> {
    return this.allAfter(
      "/process-definitions/search",
      { filter: { isLatestVersion: true } },
      (json) => CamundaViews.definition(json),
    )
  }

  versionsOf(bpmnProcessId: string): Promise<readonly DefinitionView[]> {
    return this.allAfter(
      "/process-definitions/search",
      {
        filter: { processDefinitionId: bpmnProcessId },
        sort: [{ field: "version", order: "DESC" }],
      },
      (json) => CamundaViews.definition(json),
    )
  }

  definition(key: string): Promise<DefinitionView | undefined> {
    return this.unlessMissing(async () =>
      CamundaViews.definition(
        JsonObject.of(await this.http.get(`/process-definitions/${key}`), "process definition"),
      ),
    )
  }

  processStatistics(): Promise<readonly ProcessStatisticsView[]> {
    return this.allFrom("/process-definitions/statistics/process-instances", {}, (json) =>
      CamundaViews.processStatistics(json),
    )
  }

  versionStatistics(bpmnProcessId: string): Promise<readonly VersionStatisticsView[]> {
    return this.allFrom(
      "/process-definitions/statistics/process-instances-by-version",
      { filter: { processDefinitionId: bpmnProcessId } },
      (json) => CamundaViews.versionStatistics(json),
    )
  }

  async elementStatistics(definitionKey: string): Promise<readonly ElementStatisticsView[]> {
    const answer = await this.http.post(
      `/process-definitions/${definitionKey}/statistics/element-instances`,
      {},
    )
    return JsonObject.itemsOf(answer, "element statistics").map((json) =>
      CamundaViews.elementStatistics(json),
    )
  }

  diagramXml(definitionKey: string): Promise<string | undefined> {
    return this.unlessMissing(() => this.http.text(`/process-definitions/${definitionKey}/xml`))
  }

  instances(filter: SearchFilter, window: Window): Promise<SearchPage<InstanceView>> {
    return this.page(
      "/process-instances/search",
      { filter, sort: NEWEST_INSTANCES_FIRST },
      window,
      (json) => CamundaViews.instance(json),
    )
  }

  instance(key: string): Promise<InstanceView | undefined> {
    return this.unlessMissing(async () =>
      CamundaViews.instance(
        JsonObject.of(await this.http.get(`/process-instances/${key}`), "process instance"),
      ),
    )
  }

  elementHistory(instanceKey: string): Promise<Rows<ElementInstanceView>> {
    return this.rowsAfter(
      "/element-instances/search",
      { filter: { processInstanceKey: instanceKey }, sort: NEWEST_ELEMENTS_FIRST },
      (json) => CamundaViews.elementInstance(json),
    )
  }

  activeElements(instanceKey: string): Promise<Rows<ElementInstanceView>> {
    return this.rowsAfter(
      "/element-instances/search",
      { filter: { processInstanceKey: instanceKey, state: "ACTIVE" }, sort: IN_START_ORDER },
      (json) => CamundaViews.elementInstance(json),
    )
  }

  jobsOf(instanceKey: string, elementInstanceKeys: readonly string[]): Promise<Rows<JobView>> {
    return this.inChunks(elementInstanceKeys, (keys) =>
      this.rowsAfter(
        "/jobs/search",
        { filter: { processInstanceKey: instanceKey, elementInstanceKey: { $in: keys } } },
        (json) => CamundaViews.job(json),
      ),
    )
  }

  jobsByKey(jobKeys: readonly string[]): Promise<Rows<JobView>> {
    return this.inChunks(jobKeys, (keys) =>
      this.rowsAfter("/jobs/search", { filter: { jobKey: { $in: keys } } }, (json) =>
        CamundaViews.job(json),
      ),
    )
  }

  userTasks(instanceKey: string): Promise<Rows<UserTaskView>> {
    return this.rowsAfter(
      "/user-tasks/search",
      { filter: { processInstanceKey: instanceKey, state: { $in: OPEN_USER_TASKS } } },
      (json) => CamundaViews.userTask(json),
    )
  }

  messageSubscriptions(instanceKey: string): Promise<Rows<MessageSubscriptionView>> {
    return this.rowsAfter(
      "/message-subscriptions/search",
      {
        filter: {
          processInstanceKey: instanceKey,
          messageSubscriptionState: { $in: OPEN_SUBSCRIPTIONS },
        },
      },
      (json) => CamundaViews.messageSubscription(json),
    )
  }

  incidents(filter: SearchFilter, window: Window): Promise<SearchPage<IncidentView>> {
    return this.page(
      "/incidents/search",
      { filter: { ...filter, state: "ACTIVE" }, sort: NEWEST_INCIDENTS_FIRST },
      window,
      (json) => CamundaViews.incident(json),
    )
  }

  incident(key: string): Promise<IncidentView | undefined> {
    return this.unlessMissing(async () =>
      CamundaViews.incident(JsonObject.of(await this.http.get(`/incidents/${key}`), "incident")),
    )
  }

  async variables(
    instanceKeys: readonly string[],
    limit: number,
  ): Promise<readonly VariableView[]> {
    const answer = await this.page(
      "/variables/search",
      { filter: { processInstanceKey: { $in: instanceKeys } } },
      { limit },
      (json) => CamundaViews.variable(json),
    )
    return answer.items
  }

  private async page<Item>(
    path: string,
    query: SearchFilter,
    window: Window,
    parse: (json: JsonObject) => Item,
  ): Promise<SearchPage<Item>> {
    const answer = await this.http.post(path, {
      ...query,
      page: {
        limit: window.limit,
        ...Present.fields({ after: window.after }),
      },
    })
    const page = JsonObject.of(answer, path).object("page")
    return {
      items: JsonObject.itemsOf(answer, path).map(parse),
      total: page.requiredNumber("totalItems"),
      capped: page.flag("hasMoreTotalItems"),
      ...Present.fields({ endCursor: page.optionalString("endCursor") }),
    }
  }

  private async allAfter<Item>(
    path: string,
    query: SearchFilter,
    parse: (json: JsonObject) => Item,
  ): Promise<readonly Item[]> {
    return (await this.rowsAfter(path, query, parse)).items
  }

  private async rowsAfter<Item>(
    path: string,
    query: SearchFilter,
    parse: (json: JsonObject) => Item,
  ): Promise<Rows<Item>> {
    const items: Item[] = []
    let after: string | undefined
    for (;;) {
      const room = MOST_ROWS - items.length
      const limit = room > PAGE_SIZE ? PAGE_SIZE : room + 1
      const page = await this.page(path, query, { limit, ...Present.fields({ after }) }, parse)
      items.push(...page.items.slice(0, room))
      if (page.items.length > room) {
        return { items, cut: true }
      }
      if (page.items.length < limit || page.endCursor === undefined) {
        return { items, cut: false }
      }
      after = page.endCursor
    }
  }

  private async inChunks<Item>(
    keys: readonly string[],
    read: (chunk: readonly string[]) => Promise<Rows<Item>>,
  ): Promise<Rows<Item>> {
    const chunks = Array.from({ length: Math.ceil(keys.length / MOST_KEYS) }, (_, index) =>
      keys.slice(index * MOST_KEYS, (index + 1) * MOST_KEYS),
    )
    const rows = await Promise.all(chunks.map((chunk) => read(chunk)))
    return { items: rows.flatMap((row) => row.items), cut: rows.some((row) => row.cut) }
  }

  private async allFrom<Item>(
    path: string,
    query: SearchFilter,
    parse: (json: JsonObject) => Item,
  ): Promise<readonly Item[]> {
    const items: Item[] = []
    for (;;) {
      const answer = await this.http.post(path, {
        ...query,
        page: { from: items.length, limit: PAGE_SIZE },
      })
      const rows = JsonObject.itemsOf(answer, path).map(parse)
      items.push(...rows)
      if (rows.length < PAGE_SIZE || items.length >= MOST_ROWS) {
        return items
      }
    }
  }

  private async unlessMissing<Result>(read: () => Promise<Result>): Promise<Result | undefined> {
    try {
      return await read()
    } catch (error: unknown) {
      if (CamundaRequestError.isMissingResource(error)) {
        return undefined
      }
      throw error
    }
  }
}
