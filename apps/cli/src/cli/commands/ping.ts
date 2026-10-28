/**
 * `pulse-cli ping`: `GET /version` and `GET /engine`, printed as
 * `{url, engine, reachable, version, engines, latencyMs, auth}`, plus `user` with Basic auth, and
 * `user` and `subject` of a bearer token that is a JWT. Failures are normal errors; a
 * configured engine name that the REST API does not serve is a CONFIG error.
 */

import type { Command } from "commander"
import { jwtClaims } from "../../auth/jwt.js"
import type { AuthProvider } from "../../auth/types.js"
import { findByOperationId } from "../../catalog/catalog.js"
import type { Catalog, OperationSpec } from "../../catalog/types.js"
import type { AuthConfig } from "../../config/types.js"
import { PulseCliError } from "../../errors.js"
import { dryRunPreview, sendRequest } from "../../operation/execute.js"
import { buildRequest, type OperationInput } from "../../operation/request.js"
import type { OperationResult } from "../../operation/result.js"
import { maskUrl } from "../../output/secrets.js"
import { isRecord } from "../../util.js"
import { subcommand } from "../command.js"
import type { CliContext } from "../context.js"
import { emitResult } from "../emit.js"
import { addGlobalOptions, readGlobals } from "../globals.js"
import { clientOf, openSession, targetOf } from "../session.js"
import type { UtilityCommand } from "./types.js"

const VERSION_OPERATION = "getRestAPIVersion"
const ENGINES_OPERATION = "getProcessEngineNames"
const NO_INPUT: OperationInput = { pathArgs: [], query: {} }

const DESCRIPTION = [
  "Check the connection to the engine: REST API version, process engines and latency.",
  "",
  "Sends GET /version and GET /engine; --dry-run shows the first request.",
].join("\n")

function catalogOperation(catalog: Catalog, operationId: string): OperationSpec {
  const operation = findByOperationId(catalog, operationId)
  if (operation === undefined) {
    throw new PulseCliError("INTERNAL", `The catalog has no operation ${operationId}`)
  }
  return operation
}

function jsonValue(result: OperationResult): unknown {
  return result.kind === "json" ? result.value : undefined
}

/** `version` of the VersionDto, or null. */
export function versionOf(result: OperationResult): string | null {
  const value = jsonValue(result)
  return isRecord(value) && typeof value.version === "string" ? value.version : null
}

/** Names of the ProcessEngineDto list. */
export function engineNames(result: OperationResult): string[] {
  const value = jsonValue(result)
  if (!Array.isArray(value)) return []
  return value.flatMap((engine: unknown) =>
    isRecord(engine) && typeof engine.name === "string" ? [engine.name] : [],
  )
}

/** Throws CONFIG when `engine` is set but not among the (non-empty) engine names. */
export function checkEngine(engine: string | undefined, names: readonly string[]): void {
  if (engine === undefined || names.length === 0 || names.includes(engine)) return
  throw new PulseCliError("CONFIG", `Process engine "${engine}" does not exist`, {
    hint: `The REST API serves: ${names.join(", ")}. Pass one of them with --engine (or PULSE_CLI_ENGINE, or the profile setting engine), or leave it unset for the default engine.`,
  })
}

/**
 * `user`: the Basic auth username; for a bearer token that is a JWT its `preferred_username` and `sub` (`subject`); for the token of a
 * token command its `preferred_username`, else `sub` (null for an opaque token).
 */
function userOf(
  auth: AuthConfig,
  provider: AuthProvider,
): { user?: string | null; subject?: string | null } {
  if (auth.type === "basic") return { user: auth.username }
  if (auth.type === "none") return {}
  // the token of a token command is known once the provider got it
  if (auth.command !== undefined) {
    return { user: provider.principal?.user ?? null }
  }
  const claims = jwtClaims(auth.token)
  return claims === undefined ? {} : { user: claims.user, subject: claims.subject }
}

async function runPing(command: Command, context: CliContext): Promise<void> {
  const { runtime, catalog } = context
  const session = await openSession(context, readGlobals(command))
  const target = targetOf(session)
  const versionRequest = buildRequest(
    catalogOperation(catalog, VERSION_OPERATION),
    NO_INPUT,
    target,
  )
  const client = clientOf(session, runtime)
  if (session.globals.dryRun) {
    await emitResult(await dryRunPreview(versionRequest, client.auth), session, runtime)
    return
  }
  const started = runtime.now()
  const version = await sendRequest(versionRequest, client)
  const latencyMs = runtime.now() - started
  const enginesOperation = catalogOperation(catalog, ENGINES_OPERATION)
  const engines = await sendRequest(buildRequest(enginesOperation, NO_INPUT, target), client)
  const { config, globals } = session
  const names = engineNames(engines)
  checkEngine(config.engine, names)
  const value = {
    url: maskUrl(config.url, globals.showSecrets),
    engine: config.engine ?? null,
    reachable: true,
    version: versionOf(version),
    engines: names,
    latencyMs,
    auth: config.auth.type,
    ...userOf(config.auth, client.auth),
  }
  await emitResult({ kind: "json", status: 200, value, request: version.request }, session, runtime)
}

export const pingCommand: UtilityCommand = {
  name: "ping",
  nested: false,
  register(program, context) {
    const command = subcommand(program, "ping")
      .summary("Check the connection to the engine")
      .description(DESCRIPTION)
    addGlobalOptions(command)
    command.action(() => runPing(command, context))
  },
}
