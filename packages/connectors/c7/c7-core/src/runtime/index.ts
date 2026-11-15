/**
 * @miragon/pulse-c7-core/runtime: the reads of the engine contract (`ProcessRuntime` of
 * @miragon/pulse-engine-core) for a surface of the Camunda 7 REST family, over its `EnginePort`:
 * one reader per question (the engine, its processes, the counts on a diagram, the processes a
 * version calls, its instances and their count, a version's variable names, an instance's detail,
 * the open incidents and an incident's details) and what they build on: `JsonView`, the checked
 * reads of an engine answer, which fail an unusable one as `RuntimeError("unexpectedResponse")`,
 * the one engine id rule (`isEngineId`, `engineIdOf`), the incidents of an answer, the contract's
 * reference to a version, its timestamps, an instance's state, the root cause of an incident's
 * details and the history's instance rows. An entry of its own, so a bundle that answers no
 * contract (the CLI's) never carries it.
 */

export { CalledProcessReader } from "./called-process-reader.js"
export { DefinitionReader } from "./definition-reader.js"
export {
  type DefinitionFields,
  definitionRefOf,
  definitionRefOfInstance,
  type InstanceDefinitionFields,
} from "./definition-refs.js"
export { ElementStatisticsReader } from "./element-statistics-reader.js"
export { engineIdOf, isEngineId } from "./engine-ids.js"
export { EngineReader } from "./engine-reader.js"
export {
  type HistoricInstanceQuery,
  type HistoricInstanceRow,
  readHistoricInstances,
} from "./historic-instances.js"
export { IncidentDetailsReader } from "./incident-details-reader.js"
export { type IncidentRow, incidentRowOf, incidentRowsOf, isRootIncident } from "./incident-rows.js"
export { IncidentSearch } from "./incident-search.js"
export { incidentDetailsOf } from "./incident-texts.js"
export { InstanceDetailReader } from "./instance-detail-reader.js"
export { InstanceSearch } from "./instance-search.js"
export { instanceStateOf } from "./instance-states.js"
export { JsonView } from "./json-view.js"
export type { OffsetWindow } from "./offset-paging.js"
export { optionalTimestampOf, timestampOf } from "./timestamps.js"
export { VariableNameReader } from "./variable-name-reader.js"
