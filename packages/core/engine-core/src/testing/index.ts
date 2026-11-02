/**
 * Test helpers of @miragon/pulse-engine-core: the verified workflow fixture, the status fixture,
 * wait states of every kind, a recording fake port and a fake clock; and the seams tests reach
 * below the entry's API: the pure rules behind inspect and status, the paging and missing-resource
 * rules of the port, and the operations each composite sends (a port adapter's test holds its
 * table equal to them).
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
export { isMissing, pageQuery } from "../port.js"
export { countByIds, ID_CHUNK } from "../requests.js"
export { INSPECT_OPERATIONS, STATUS_OPERATIONS } from "../operations.js"
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
  messagePattern,
  topicStatus,
  unknownKeys,
} from "../status.js"
export { engineStatus, type FindingInput, findings } from "../findings.js"
