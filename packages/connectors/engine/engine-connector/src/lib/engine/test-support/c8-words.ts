/**
 * The Camunda 8 wire of the server with its words, for the tests of what the model reads
 * (c8-errors.test.ts, c8-errors.token.test.ts): c8-core's `C8Runtime` over a connection to the
 * cluster of a `fetch` of its own (c8-platform.ts), and what a failed read says, held to the texts
 * no Camunda 8 failure may show.
 */
import { expect } from "vitest"
import { C8Runtime } from "@miragon/pulse-c8-core"
import type { RuntimeError } from "@miragon/pulse-engine-core"
import { type C8Auth, createC8Connection } from "../c8-connection.js"
import { c8WordsOf } from "../c8-errors.js"
import { type Answer, c8Platform, CLUSTER, TOKEN_ENDPOINT } from "./c8-platform.js"

export const CLIENT: C8Auth = {
  type: "clientCredentials",
  tokenEndpoint: TOKEN_ENDPOINT,
  clientId: "pulse-reader",
  clientSecret: "reader-secret-42",
  audience: "camunda",
}

/** Texts no Camunda 8 failure may show: Camunda 7's root and variables, the URLs, the secret. */
export const NEVER = [
  /engine-rest/,
  /ENGINE_AUTH_TYPE|ENGINE_USERNAME|ENGINE_PASSWORD|ENGINE_TOKEN/,
  /cluster\.c8\.test|login\.c8\.test/,
  /reader-secret-42/,
]

export interface Said {
  readonly failure: string
  readonly message: string
  readonly hint?: string
}

export function runtimeOver(
  answers: Readonly<Record<string, Answer>>,
  auth: C8Auth = { type: "none" },
) {
  const platform = c8Platform(answers)
  const connection = createC8Connection(
    { id: "c8", baseUrl: CLUSTER },
    auth,
    {
      timeoutMs: 40,
    },
    platform,
  )
  const runtime = C8Runtime.over(connection.transport(), { wordsOf: c8WordsOf(connection) })
  return { platform, connection, runtime }
}

/** What the model reads of a read that failed. */
export async function said(read: Promise<unknown>): Promise<Said> {
  try {
    await read
  } catch (error) {
    const { failure, message, hint } = error as RuntimeError
    for (const text of NEVER) expect(`${message}\n${hint ?? ""}`).not.toMatch(text)
    return hint === undefined ? { failure, message } : { failure, message, hint }
  }
  throw new Error("the read did not fail")
}

export const describeEngine = (answers: Readonly<Record<string, Answer>>, auth?: C8Auth) =>
  said(runtimeOver(answers, auth).runtime.describeEngine())

export const ROOT_HINT = "The profile's url must be the REST root of the cluster and end in /v2."
export const AGAIN_IN_A_MINUTE =
  "The server asks the token endpoint again a minute after its last answer."
export const IN_FIVE_SECONDS =
  "The server asks the token endpoint again 5 seconds after its last answer."
export const CLIENT_HINT =
  "Check auth.clientId in the engine's profile and the secret in the ENGINE_SECRET_* variable " +
  "its auth.clientSecretEnv names; the server reads both at its start."
export const REQUEST_HINT =
  "Check auth.audience and auth.scopes in the engine's profile: they are sent as written."
export const ENDPOINT_HINT =
  "auth.tokenEndpoint in the engine's profile must be the URL that issues tokens."
