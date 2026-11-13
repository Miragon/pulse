/**
 * TRANSPORT_CASES of @miragon/pulse-http through the CLI's wiring of the transport: the
 * configuration resolved from the CLI's variables (PULSE_CLI_URL, PULSE_CLI_TIMEOUT, the auth),
 * the auth provider and the client a command gets, and the request of the generated command the
 * case's method and path name (`pulse process-instance get pi-1`), built and sent as the command
 * sends it, against the package's loopback engine of each case. What a person or an agent would
 * read (the error's message, hint and engine message, or the answer) is the observation's text.
 */

import {
  type CaseCapability,
  type CaseConnection,
  caseFindings,
  casesFor,
  credentialOfCase,
  type Observed,
  TRANSPORT_CASES,
  type TransportCase,
} from "@miragon/pulse-http/testing"
import { HttpFailure } from "@miragon/pulse-http"
import { startCaseEngine } from "@miragon/pulse-http/testing/loopback"
import { describe, expect, it } from "vitest"
import { fakeRuntime } from "../../test/support/fake-runtime.js"
import { authDeps } from "../../test/support/oauth.js"
import { createAuthProvider } from "../auth/index.js"
import { findOperationByPath, loadCatalog } from "../catalog/catalog.js"
import { resolveConfig } from "../config/resolve.js"
import { PulseCliError } from "../errors.js"
import { commandRef } from "../operation/command-ref.js"
import { buildRequest } from "../operation/request.js"
import type { OperationResult } from "../operation/result.js"
import { sendRequest } from "../operation/send.js"
import { stringifyJson } from "../util.js"
import { createClient } from "./client.js"

/**
 * What the CLI can express: Basic, a fixed bearer token and a credential that renews (an OAuth
 * login, a token command). It forwards no caller's token, its read-only mode refuses a write
 * before the transport is asked, and no caller aborts a command's request.
 */
const CLI: readonly CaseCapability[] = ["basic", "bearer", "renewal"]

/** What the CLI decides otherwise, on purpose, beyond its capabilities. */
const DECIDED_OTHERWISE: Readonly<Record<string, string>> = {
  "too-large-response": "the CLI caps no answer (transport plan 2.4)",
  "too-large-announced": "the CLI caps no answer (transport plan 2.4)",
  "too-large-write": "the CLI caps no answer (transport plan 2.4)",
  "invalid-answer": "the CLI shows an answer that is no JSON as its text",
  "invalid-answer-write": "the CLI shows an answer that is no JSON as its text",
}

const catalog = loadCatalog()

/** The CLI's variables for a case's connection, as a user would set them. */
function envOf(connection: CaseConnection, origin: string): Record<string, string> {
  const base = {
    PULSE_CLI_URL: `${origin}${connection.root}`,
    PULSE_CLI_TIMEOUT: String(connection.timeoutMs),
  }
  const { credential } = connection
  switch (credential.type) {
    case "basic":
      return {
        ...base,
        PULSE_CLI_USERNAME: credential.username,
        PULSE_CLI_PASSWORD: credential.password,
      }
    case "bearer":
      return { ...base, PULSE_CLI_AUTH: "bearer", PULSE_CLI_TOKEN: credential.token }
    default:
      return base
  }
}

function textOf(result: OperationResult): string {
  if (result.kind === "json") return stringifyJson(result.value) ?? ""
  return result.kind === "text" ? result.text : ""
}

/** A failure as the case reads it: the transport's reason where it gave one. */
function failed(error: unknown): Observed {
  if (!(error instanceof PulseCliError)) throw error
  const { message, details, cause } = error
  const text = [message, details.hint, details.engineType, details.engineMessage].join("\n")
  if (cause instanceof HttpFailure) {
    const status = cause.status === undefined ? {} : { status: cause.status }
    return { outcome: cause.reason, ...status, mayHaveApplied: cause.mayHaveApplied, text }
  }
  if (details.status !== undefined) {
    const outcome = details.status === 401 ? "unauthorized" : "status"
    return { outcome, status: details.status, mayHaveApplied: false, text }
  }
  // The configuration refuses a token with a line break inside; a command refuses a path value
  // "", "." or ".." before it builds the request.
  const outcome = error.code === "CONFIG" ? "credential" : "invalid-request"
  return { outcome, mayHaveApplied: false, text }
}

async function observe(kase: TransportCase, origin: string): Promise<Observed> {
  const { connection, request } = kase
  try {
    const config = resolveConfig({}, envOf(connection, origin), undefined)
    const provider = createAuthProvider(config.auth, authDeps(fakeRuntime()))
    // A renewing credential is what an OAuth login or a token command gives the transport.
    const auth =
      connection.credential.type === "renewable"
        ? { ...provider, credential: credentialOfCase(connection.credential) }
        : provider
    const { url, timeoutMs, headers } = config
    const client = createClient({ url, fetch, auth, timeoutMs, now: Date.now, headers })
    const operation = findOperationByPath(catalog, request.method, request.path)
    if (operation === undefined) throw new Error(`no command for ${request.method} ${request.path}`)
    const pathArgs = [...request.path.matchAll(/\{(\w+)\}/g)].map(
      ([, name]) => request.values?.[name ?? ""] ?? "",
    )
    const body = request.body === undefined ? {} : { body: JSON.parse(request.body) as unknown }
    const target = { baseUrl: config.url, headers: {} }
    const built = buildRequest(operation, { pathArgs, query: {}, ...body }, target)
    const result = await sendRequest(built, client, commandRef(operation, catalog))
    if (result.kind === "dry-run") throw new Error("a command that sends previews nothing")
    return { outcome: "answered", status: result.status, text: textOf(result) }
  } catch (error) {
    return failed(error)
  }
}

describe("the CLI's wiring of the transport", () => {
  const expressed = casesFor(CLI).filter((kase) => !Object.hasOwn(DECIDED_OTHERWISE, kase.name))

  it("names the cases it leaves out: passthrough, read-only, a caller's abort, a cap, JSON only", () => {
    const left = TRANSPORT_CASES.filter((kase) => !expressed.includes(kase))
    expect(left.map((kase) => kase.name)).toEqual([
      "cancelled-by-the-caller",
      "cancel-of-a-write-ignored",
      "too-large-response",
      "too-large-announced",
      "too-large-write",
      "unauthorized-passthrough",
      "invalid-answer",
      "invalid-answer-write",
      "read-only-refuses-a-write",
      "read-only-sends-a-reading-post",
    ])
  })

  it.each(expressed.map((kase) => [kase.name, kase] as const))("passes %s", async (_name, kase) => {
    const engine = await startCaseEngine(kase)
    try {
      const observed = await observe(kase, engine.origin)
      expect(caseFindings(kase, observed, engine.seen)).toEqual([])
    } finally {
      await engine.close()
    }
  })
})
