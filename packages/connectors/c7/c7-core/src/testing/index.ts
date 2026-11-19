/**
 * Test helpers of @miragon/pulse-c7-core: the verified workflow fixture, the status fixture,
 * wait states of every kind, a recording fake port and a fake clock; the seed of the Camunda 7
 * conformance world and a board's answers recorded from it, with the board they give; and the
 * seams tests reach below the entry's API: the pure rules behind inspect and status, the paging
 * rule of the port, and the operations each composite and the runtime send (a port adapter's test
 * holds its table equal to them).
 */

export * from "./fixture.js"
export { NOW, statistics } from "./status.js"
export * from "./waits.js"
export { APPROVE_INCIDENT, approveRoutes, STACKTRACE } from "./inspect-routes.js"
export {
  type FakeCall,
  FakeFailure,
  fakeClock,
  fakeFailure,
  type FakePort,
  fakePort,
  type Route,
} from "./fake-port.js"
export { seedC7CommandWorld, seedC7World } from "./seed-world.js"
export { C7_BOARD_ENGINE, type C7BoardEngine, type C7RecordedAnswer } from "./board-engine.js"
export type {
  C7CommandWorld,
  C7CommandWorldPlan,
  C7SeedAnswer,
  C7SeedEngine,
  C7SeedRequest,
  C7SeededWorld,
  C7UnknownIds,
  C7WorldDeployment,
  C7WorldInstance,
  C7WorldPlan,
  C7WorldValue,
} from "./c7-world.js"
export { pageQuery } from "../port.js"
export { countByIds, ID_CHUNK } from "../requests.js"
export {
  INSPECT_OPERATIONS,
  RUNTIME_OPERATIONS,
  STATUS_OPERATIONS,
  WITH_INCIDENT_OPERATIONS,
} from "../operations.js"
export { mergeCandidates } from "../select.js"
export { incidentCause } from "../inspect.js"
export { instanceView } from "../snapshot.js"
export { historicVariableMap, plainVariables } from "../variables.js"
export { nextSteps } from "../next.js"
export {
  definitionStatus,
  type GroupedIncidents,
  groupIncidents,
  jobStatus,
  topicStatus,
  unknownKeys,
} from "../status.js"
export { type FindingInput, findings } from "../findings.js"
