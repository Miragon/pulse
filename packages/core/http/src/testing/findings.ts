/**
 * What a wiring needs to run the conformance cases besides the data: a case's credential as
 * this package's `Credential`, its path filled in, and the comparison of what it observed.
 */
import {
  basicCredential,
  bearerCredential,
  callerToken,
  type Credential,
  noCredential,
  staticToken,
  type TokenSource,
} from "../credential.js"
import type { CaseCredential, CaseRequest, Observed, Seen, TransportCase } from "./types.js"

/** A token source that moves to its next token after each 401 to its current one. */
function renewableTokens(tokens: readonly string[]): TokenSource {
  let at = 0
  return {
    renewable: true,
    token: () => Promise.resolve(tokens[at]),
    rejected: (sent) => {
      const renews = sent === tokens[at] && at + 1 < tokens.length
      if (renews) at += 1
      return Promise.resolve(renews)
    },
  }
}

/**
 * A case's credential as a `Credential`. Throws the `CredentialError` a fixed token with a line
 * inside gets, as a surface's boot would: the wiring observes it as outcome "credential".
 */
export function credentialOfCase(credential: CaseCredential): Credential {
  switch (credential.type) {
    case "none":
      return noCredential
    case "basic":
      return basicCredential(credential.username, credential.password)
    case "bearer":
      return bearerCredential(staticToken(credential.token))
    case "caller":
      return bearerCredential(callerToken(() => credential.token))
    case "renewable":
      return bearerCredential(renewableTokens(credential.tokens))
  }
}

/** A case's path with each `{name}` replaced by `encode(value)`. */
export function pathOfCase(request: CaseRequest, encode: (value: string) => string): string {
  return request.path.replace(/\{(\w+)\}/g, (_, name: string) =>
    encode(request.values?.[name] ?? ""),
  )
}

const listed = (values: readonly (string | null | undefined)[]): string => JSON.stringify(values)

function sameList(
  label: string,
  expected: readonly (string | null)[] | undefined,
  seen: readonly (string | null)[],
): string[] {
  if (expected === undefined || listed(expected) === listed(seen)) return []
  return [`${label}: expected ${listed(expected)}, the engine saw ${listed(seen)}`]
}

function outcomeFindings(kase: TransportCase, observed: Observed): string[] {
  const { expect } = kase
  const findings: string[] = []
  if (observed.outcome !== expect.outcome) {
    findings.push(`outcome: expected ${expect.outcome}, observed ${observed.outcome}`)
  }
  if (expect.status !== undefined && observed.status !== expect.status) {
    findings.push(`status: expected ${String(expect.status)}, observed ${String(observed.status)}`)
  }
  const applied = expect.mayHaveApplied
  if (applied !== undefined && observed.mayHaveApplied !== applied) {
    findings.push(
      `mayHaveApplied: expected ${String(applied)}, observed ${String(observed.mayHaveApplied)}`,
    )
  }
  return findings
}

function textFindings(kase: TransportCase, text: string): string[] {
  const missing = (kase.expect.contains ?? []).filter((part) => !text.includes(part))
  const shown = (kase.expect.never ?? []).filter((part) => text.includes(part))
  return [
    ...missing.map((part) => `the observation does not show ${JSON.stringify(part)}`),
    ...shown.map((part) => `the observation shows ${JSON.stringify(part)}, which it never may`),
  ]
}

/**
 * Where an observation and the requests the engine saw differ from the case, one sentence each;
 * empty when the wiring passes the case.
 */
export function caseFindings(
  kase: TransportCase,
  observed: Observed,
  seen: readonly Seen[],
): string[] {
  const { expect } = kase
  const sent =
    seen.length === expect.sent
      ? []
      : [`sent: expected ${String(expect.sent)} requests, the engine saw ${String(seen.length)}`]
  return [
    ...outcomeFindings(kase, observed),
    ...sent,
    ...sameList(
      "authorization",
      expect.authorization,
      seen.map((one) => one.authorization ?? null),
    ),
    ...sameList(
      "targets",
      expect.targets,
      seen.map((one) => one.target),
    ),
    ...sameList(
      "bodies",
      expect.bodies,
      seen.map((one) => one.body),
    ),
    ...textFindings(kase, observed.text),
  ]
}
