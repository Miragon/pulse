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

export interface CamundaClient {
  topology(): Promise<TopologyView>
  latestDefinitions(): Promise<readonly DefinitionView[]>
  versionsOf(bpmnProcessId: string): Promise<readonly DefinitionView[]>
  definition(key: string): Promise<DefinitionView | undefined>
  processStatistics(): Promise<readonly ProcessStatisticsView[]>
  versionStatistics(bpmnProcessId: string): Promise<readonly VersionStatisticsView[]>
  elementStatistics(definitionKey: string): Promise<readonly ElementStatisticsView[]>
  diagramXml(definitionKey: string): Promise<string | undefined>
  instances(filter: SearchFilter, window: Window): Promise<SearchPage<InstanceView>>
  instance(key: string): Promise<InstanceView | undefined>
  elementHistory(instanceKey: string): Promise<Rows<ElementInstanceView>>
  activeElements(instanceKey: string): Promise<Rows<ElementInstanceView>>
  elementInstance(key: string): Promise<ElementInstanceView | undefined>
  jobsOf(instanceKey: string, elementInstanceKeys: readonly string[]): Promise<Rows<JobView>>
  jobsByKey(jobKeys: readonly string[]): Promise<Rows<JobView>>
  userTasks(instanceKey: string): Promise<Rows<UserTaskView>>
  messageSubscriptions(instanceKey: string): Promise<Rows<MessageSubscriptionView>>
  incidents(filter: SearchFilter, window: Window): Promise<SearchPage<IncidentView>>
  incident(key: string): Promise<IncidentView | undefined>
  variables(instanceKeys: readonly string[], limit: number): Promise<readonly VariableView[]>
}
