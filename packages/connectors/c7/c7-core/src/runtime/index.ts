/**
 * @miragon/pulse-c7-core/runtime: what a surface of the Camunda 7 REST family builds the engine
 * contract's reads on (`ProcessRuntime` of @miragon/pulse-engine-core): `JsonView`, the checked
 * reads of an engine answer, which fail an unusable one as `RuntimeError("unexpectedResponse")`,
 * and the one engine id rule (`isEngineId`, `engineIdOf`). An entry of its own, so a bundle that
 * answers no contract (the CLI's) never carries it.
 */

export { engineIdOf, isEngineId } from "./engine-ids.js"
export { JsonView } from "./json-view.js"
