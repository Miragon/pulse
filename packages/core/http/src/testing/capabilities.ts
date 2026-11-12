/**
 * What a surface must be able to express to run a case, read off the case itself: a wiring runs
 * every case its surface can express, and its test names the ones it leaves out, so no wiring
 * builds a skip list of its own that thins "every wiring passes" unnoticed.
 */
import { TRANSPORT_CASES } from "./cases.js"
import type { CaseCredential, TransportCase } from "./types.js"

/** What a case needs beyond a read or a write without a credential. */
export type CaseCapability =
  /** HTTP Basic. */
  | "basic"
  /** A fixed bearer token. */
  | "bearer"
  /** The token of whoever calls, forwarded (the MCP server's passthrough). */
  | "passthrough"
  /** A credential that renews after a 401 (OAuth). */
  | "renewal"
  /** A read-only connection. */
  | "read-only"
  /** The caller's own abort of a request. */
  | "cancel"

export const CASE_CAPABILITIES: readonly CaseCapability[] = [
  "basic",
  "bearer",
  "passthrough",
  "renewal",
  "read-only",
  "cancel",
]

const CREDENTIAL_CAPABILITY: Readonly<Record<CaseCredential["type"], CaseCapability | undefined>> =
  {
    none: undefined,
    basic: "basic",
    bearer: "bearer",
    caller: "passthrough",
    renewable: "renewal",
  }

/** What `kase` needs of a wiring. */
export function requirementsOf(kase: TransportCase): readonly CaseCapability[] {
  const { connection, request } = kase
  const needs: (CaseCapability | undefined)[] = [
    CREDENTIAL_CAPABILITY[connection.credential.type],
    connection.readOnly === true ? "read-only" : undefined,
    request.cancelAfterMs === undefined ? undefined : "cancel",
  ]
  return needs.filter((need) => need !== undefined)
}

/**
 * The cases of TRANSPORT_CASES a wiring that can express `capabilities` runs: each one it needs
 * nothing else for. Its test names the rest, so a case a surface cannot run stays visible.
 */
export function casesFor(capabilities: readonly CaseCapability[]): readonly TransportCase[] {
  return TRANSPORT_CASES.filter((kase) =>
    requirementsOf(kase).every((need) => capabilities.includes(need)),
  )
}
