import type { CamundaTransport } from "../port/camunda-transport.js"
import type { CamundaClient } from "./camunda-client.js"
import { CamundaSearch } from "./camunda-search.js"
import { CamundaViews } from "./camunda-views.js"
import { JsonObject } from "./json-object.js"
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
const IN_SUBSCRIPTION_ORDER = [{ field: "messageSubscriptionKey", order: "ASC" }]

export class RestCamundaClient implements CamundaClient {
  private readonly search: CamundaSearch

  constructor(private readonly http: CamundaTransport) {
    this.search = new CamundaSearch(http)
  }

  async topology(): Promise<TopologyView> {
    return CamundaViews.topology(JsonObject.of(await this.http.get("/topology"), "topology"))
  }

  latestDefinitions(): Promise<readonly DefinitionView[]> {
    return this.search.allAfter(
      "/process-definitions/search",
      { filter: { isLatestVersion: true } },
      (json) => CamundaViews.definition(json),
    )
  }

  async latestOf(bpmnProcessIds: readonly string[]): Promise<readonly DefinitionView[]> {
    const rows = await this.search.inChunks(bpmnProcessIds, (ids) =>
      this.search.rowsAfter(
        "/process-definitions/search",
        { filter: { processDefinitionId: { $in: ids }, isLatestVersion: true } },
        (json) => CamundaViews.definition(json),
      ),
    )
    return rows.items
  }

  versionsOf(bpmnProcessId: string): Promise<readonly DefinitionView[]> {
    return this.search.allAfter(
      "/process-definitions/search",
      {
        filter: { processDefinitionId: bpmnProcessId },
        sort: [{ field: "version", order: "DESC" }],
      },
      (json) => CamundaViews.definition(json),
    )
  }

  versionsTagged(bpmnProcessId: string, versionTag: string): Promise<readonly DefinitionView[]> {
    return this.search.allAfter(
      "/process-definitions/search",
      {
        filter: { processDefinitionId: bpmnProcessId, versionTag },
        sort: [{ field: "version", order: "DESC" }],
      },
      (json) => CamundaViews.definition(json),
    )
  }

  definition(key: string): Promise<DefinitionView | undefined> {
    return this.search.unlessMissing(async () =>
      CamundaViews.definition(
        JsonObject.of(
          await this.http.get(RestCamundaClient.at("/process-definitions", key)),
          "process definition",
        ),
      ),
    )
  }

  processStatistics(): Promise<readonly ProcessStatisticsView[]> {
    return this.search.allFrom("/process-definitions/statistics/process-instances", {}, (json) =>
      CamundaViews.processStatistics(json),
    )
  }

  versionStatistics(bpmnProcessId: string): Promise<readonly VersionStatisticsView[]> {
    return this.search.allFrom(
      "/process-definitions/statistics/process-instances-by-version",
      { filter: { processDefinitionId: bpmnProcessId } },
      (json) => CamundaViews.versionStatistics(json),
    )
  }

  async elementStatistics(definitionKey: string): Promise<readonly ElementStatisticsView[]> {
    const path = `${RestCamundaClient.at("/process-definitions", definitionKey)}/statistics/element-instances`
    const answer = await this.http.post(path, {})
    return JsonObject.itemsOf(answer, "element statistics").map((json) =>
      CamundaViews.elementStatistics(json),
    )
  }

  diagramXml(definitionKey: string): Promise<string | undefined> {
    return this.search.unlessMissing(() =>
      this.http.text(`${RestCamundaClient.at("/process-definitions", definitionKey)}/xml`),
    )
  }

  instances(filter: SearchFilter, window: Window): Promise<SearchPage<InstanceView>> {
    return this.search.page(
      "/process-instances/search",
      { filter, sort: NEWEST_INSTANCES_FIRST },
      window,
      (json) => CamundaViews.instance(json),
    )
  }

  instance(key: string): Promise<InstanceView | undefined> {
    return this.search.unlessMissing(async () =>
      CamundaViews.instance(
        JsonObject.of(
          await this.http.get(RestCamundaClient.at("/process-instances", key)),
          "process instance",
        ),
      ),
    )
  }

  elementHistory(instanceKey: string): Promise<Rows<ElementInstanceView>> {
    return this.search.rowsAfter(
      "/element-instances/search",
      { filter: { processInstanceKey: instanceKey }, sort: NEWEST_ELEMENTS_FIRST },
      (json) => CamundaViews.elementInstance(json),
    )
  }

  activeElements(instanceKey: string): Promise<Rows<ElementInstanceView>> {
    return this.search.rowsAfter(
      "/element-instances/search",
      { filter: { processInstanceKey: instanceKey, state: "ACTIVE" }, sort: IN_START_ORDER },
      (json) => CamundaViews.elementInstance(json),
    )
  }

  elementInstance(key: string): Promise<ElementInstanceView | undefined> {
    return this.search.unlessMissing(async () =>
      CamundaViews.elementInstance(
        JsonObject.of(
          await this.http.get(RestCamundaClient.at("/element-instances", key)),
          "element instance",
        ),
      ),
    )
  }

  jobsOf(instanceKey: string, elementInstanceKeys: readonly string[]): Promise<Rows<JobView>> {
    return this.search.inChunks(elementInstanceKeys, (keys) =>
      this.search.rowsAfter(
        "/jobs/search",
        { filter: { processInstanceKey: instanceKey, elementInstanceKey: { $in: keys } } },
        (json) => CamundaViews.job(json),
      ),
    )
  }

  jobsByKey(jobKeys: readonly string[]): Promise<Rows<JobView>> {
    return this.search.inChunks(jobKeys, (keys) =>
      this.search.rowsAfter("/jobs/search", { filter: { jobKey: { $in: keys } } }, (json) =>
        CamundaViews.job(json),
      ),
    )
  }

  userTasks(instanceKey: string): Promise<Rows<UserTaskView>> {
    return this.search.rowsAfter(
      "/user-tasks/search",
      { filter: { processInstanceKey: instanceKey, state: { $in: OPEN_USER_TASKS } } },
      (json) => CamundaViews.userTask(json),
    )
  }

  messageSubscriptions(instanceKey: string): Promise<Rows<MessageSubscriptionView>> {
    return this.search.rowsAfter(
      "/message-subscriptions/search",
      {
        filter: {
          processInstanceKey: instanceKey,
          messageSubscriptionState: { $in: OPEN_SUBSCRIPTIONS },
        },
        sort: IN_SUBSCRIPTION_ORDER,
      },
      (json) => CamundaViews.messageSubscription(json),
    )
  }

  incidents(filter: SearchFilter, window: Window): Promise<SearchPage<IncidentView>> {
    return this.search.page(
      "/incidents/search",
      { filter: { ...filter, state: "ACTIVE" }, sort: NEWEST_INCIDENTS_FIRST },
      window,
      (json) => CamundaViews.incident(json),
    )
  }

  incident(key: string): Promise<IncidentView | undefined> {
    return this.search.unlessMissing(async () =>
      CamundaViews.incident(
        JsonObject.of(await this.http.get(RestCamundaClient.at("/incidents", key)), "incident"),
      ),
    )
  }

  async variables(
    instanceKeys: readonly string[],
    limit: number,
  ): Promise<readonly VariableView[]> {
    const answer = await this.search.page(
      "/variables/search",
      { filter: { processInstanceKey: { $in: instanceKeys } } },
      { limit },
      (json) => CamundaViews.variable(json),
    )
    return answer.items
  }

  private static at(collection: string, key: string): string {
    return `${collection}/${encodeURIComponent(key)}`
  }
}
