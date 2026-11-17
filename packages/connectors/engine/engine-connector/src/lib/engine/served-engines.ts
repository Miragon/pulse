import type { z } from "zod"
import type { ToolConfig, ToolRegistrar } from "@miragon/pulse-widget-shell/server"
import type { EngineDialect } from "../../view-models.js"
import {
  backendFor,
  type EngineBackend,
  EngineDialectNotServedError,
  EngineNotSelectedError,
  EngineProfileRefusedError,
  EngineReadOnlyError,
  type EngineRegistry,
} from "./resolve-engine.js"
import { engineParamShape, engineParamShapeFor } from "./with-engine.js"

/**
 * What a tool, a feed or a cockpit route serves, its mark: the dialects whose engines it reads,
 * and whether it writes. Dialect is what Pulse can do (code), a profile which dialects a server
 * has and what its operator allows (`readOnly`): the boot registers it only where a configured
 * engine serves it, its `engine` enum offers only those, and a call to another is refused.
 */
export interface EngineMark {
  readonly dialects: readonly EngineDialect[]
  /** A write (a tool without `readOnlyHint`): it serves no engine whose profile is read-only. */
  readonly write?: boolean
}

/** Whether `mark` serves the configured engine `backend`. */
function serves(backend: EngineBackend, mark: EngineMark): boolean {
  return mark.dialects.includes(backend.dialect) && !(mark.write === true && backend.readOnly)
}

/** The usable engines `mark` serves, in the order of the profiles: with none it is not offered. */
export function servedEngineIds(registry: EngineRegistry, mark: EngineMark): string[] {
  return [...registry.backends]
    .filter(([, backend]) => serves(backend, mark))
    .map(([engineId]) => engineId)
}

/**
 * The `engine` values a call of `mark` offers, in the order of the profiles: the engines it
 * serves, and a refused profile of one of its dialects or of none the parser read, so a call to it
 * says why the profile is refused.
 */
export function offeredEngineIds(registry: EngineRegistry, mark: EngineMark): string[] {
  return registry.engineIds.filter((engineId) => {
    const backend = registry.backends.get(engineId)
    if (backend !== undefined) return serves(backend, mark)
    const dialect = registry.refused.get(engineId)?.dialect
    return (
      registry.refused.has(engineId) && (dialect === undefined || mark.dialects.includes(dialect))
    )
  })
}

/**
 * The call-time net of `mark`, before anything resolves a client or sends: the engine a call goes
 * to by invariant 2's precedence, never rerouted. A refused profile fails with
 * ENGINE_PROFILE_REFUSED, an engine of a dialect `mark` does not serve with
 * ENGINE_DIALECT_NOT_SERVED, a read-only one under a write with ENGINE_READ_ONLY. The enum keeps a
 * model from naming such an engine; this holds above all for a call without `engine`, whose
 * default no enum narrows.
 */
export function engineServing(
  override: string | undefined,
  registry: EngineRegistry,
  mark: EngineMark,
): string {
  const { engineId, backend } = backendFor(override, registry)
  if (!mark.dialects.includes(backend.dialect)) {
    throw new EngineDialectNotServedError(engineId, backend, mark.dialects)
  }
  if (mark.write === true && backend.readOnly) throw new EngineReadOnlyError(engineId)
  return engineId
}

/** The failures the cockpit's picker shows instead of an engine's view. */
const PICKER_FAILURES = [
  EngineNotSelectedError,
  EngineProfileRefusedError,
  EngineDialectNotServedError,
] as const

/**
 * Where the cockpit opens without a view: the engine every call would route to, when its start
 * route (`mark`) serves it, or `null` for the picker (no engine selected, a refused one or one
 * the route does not serve, which the picker shows). Any other error propagates.
 */
export function cockpitEngineId(
  override: string | undefined,
  registry: EngineRegistry,
  mark: EngineMark,
): string | null {
  try {
    return engineServing(override, registry, mark)
  } catch (e) {
    if (PICKER_FAILURES.some((failure) => e instanceof failure)) return null
    throw e
  }
}

type ToolShape = Record<string, z.ZodType>

/** A tool of the engine module: the registrar's config with its mark beside its annotations. */
export interface EngineToolConfig<TShape extends ToolShape = ToolShape> extends ToolConfig<
  EngineRegistry,
  TShape
> {
  /** The dialects whose engines it serves; a write serves no read-only engine besides. */
  dialects: readonly EngineDialect[]
}

/** What the engine module's tool files take as `register`. */
export type EngineToolRegistrar = <TShape extends ToolShape = ToolShape>(
  config: EngineToolConfig<TShape>,
) => void

/** The `engine` argument of a call, when it names one. */
function engineArg(args: unknown): string | undefined {
  const engine = (args as { engine?: unknown } | undefined)?.engine
  return typeof engine === "string" ? engine : undefined
}

/**
 * Every registrar tool by its mark: registered only where a configured engine serves it (a write
 * only where one is writable), the `engine` placeholder's enum the engines it offers, and the
 * call-time net (`engineServing`) before the handler of every tool that goes to an engine, by an
 * `engine` field of any shape or as a write, so the net never hangs on the placeholder. A read
 * without an `engine` field (the engine list, which reads none) keeps its config as it is; a tool
 * with its own `engine` field keeps that field.
 */
export function withServedEngines(
  register: ToolRegistrar<EngineRegistry>,
  registry: EngineRegistry,
): EngineToolRegistrar {
  return <TShape extends ToolShape>({ dialects, ...config }: EngineToolConfig<TShape>) => {
    const mark: EngineMark = { dialects, write: config.annotations?.readOnlyHint !== true }
    if (servedEngineIds(registry, mark).length === 0) return
    const shape = config.inputSchema
    if (shape?.engine === undefined && mark.write !== true) {
      register(config)
      return
    }
    const { handler } = config
    // Same field, narrower values: the handler's `engine?: string` holds.
    const offered =
      shape?.engine === engineParamShape.engine
        ? { inputSchema: { ...shape, ...engineParamShapeFor(offeredEngineIds(registry, mark)) } }
        : {}
    register({
      ...config,
      ...offered,
      handler: async (reg, args, ctx) => {
        engineServing(engineArg(args), reg, mark)
        return await handler(reg, args, ctx)
      },
    })
  }
}
