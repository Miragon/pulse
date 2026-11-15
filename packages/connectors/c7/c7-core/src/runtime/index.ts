/**
 * @miragon/pulse-c7-core/runtime: the reads of the engine contract (`ProcessRuntime` of
 * @miragon/pulse-engine-core) for a surface of the Camunda 7 REST family, over its `EnginePort`:
 * one reader per question (the engine, its processes, the counts on a diagram, the processes a
 * version calls) and what they build on: `JsonView`, the checked reads of an engine answer, which
 * fail an unusable one as `RuntimeError("unexpectedResponse")`, the one engine id rule
 * (`isEngineId`, `engineIdOf`), the incidents of an answer and the contract's reference to a
 * version. An entry of its own, so a bundle that answers no contract (the CLI's) never carries it.
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
export { type IncidentRow, incidentRowOf, incidentRowsOf, isRootIncident } from "./incident-rows.js"
export { JsonView } from "./json-view.js"
