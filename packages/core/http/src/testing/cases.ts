/** Every conformance case, the wire's, the credential's and the request's. */
import { CREDENTIAL_CASES } from "./credential-cases.js"
import { REQUEST_CASES } from "./request-cases.js"
import type { TransportCase } from "./types.js"
import { WIRE_CASES } from "./wire-cases.js"

export const TRANSPORT_CASES: readonly TransportCase[] = [
  ...WIRE_CASES,
  ...CREDENTIAL_CASES,
  ...REQUEST_CASES,
]
