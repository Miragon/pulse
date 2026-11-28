/**
 * The screens and boards as JSON for the model and for any page that renders them with
 * @miragon/pulse-blocks (owner decision 2026-11-24, #666): read-only model tools that return the
 * JSON form of a web app's screen or of a built board with the form's version, data only, no view
 * (`data/json-forms.ts`, over the builders and floors of the feeds). D10 holds for the screens as
 * UI: the web app's pages still read the app-only `SCREEN_FEEDS`, and new engine UI of the chat is
 * a cockpit route. Their marks are the feeds': every dialect, a screen through the engine contract
 * (`resolveRuntimeEngine`, a failed read with the contract's failure as its code), a board over the
 * engines it names, each by its name.
 */

import type { BoardFiles } from "../board-files.js"
import { namedReads } from "../data/feeds.js"
import { readBoardForm, readScreenForm, type ScreenFormTarget } from "../data/json-forms.js"
import {
  type EngineCallContext,
  type EngineRegistry,
  resolveRuntimeEngine,
} from "../lib/engine/resolve-engine.js"
import { contractToolError } from "../lib/engine/runtime-errors.js"
import type { EngineToolRegistrar } from "../lib/engine/served-engines.js"
import { engineParamShape } from "../lib/engine/with-engine.js"
import { getBoardInput, getScreenInput, type ScreenKind } from "../schemas/index.js"
import { ENGINE_GET_BOARD, ENGINE_GET_SCREEN } from "../tool-names.js"
import { EVERY_DIALECT } from "../view-models.dialects.js"

/** What a call asks of a screen: the screen and the ids of the tool's input. */
interface ScreenArgs {
  readonly screen: ScreenKind
  readonly processDefinitionKey?: string | undefined
  readonly tenantId?: string | undefined
  readonly version?: number | undefined
  readonly processInstanceId?: string | undefined
}

type ScreenId = "processDefinitionKey" | "tenantId" | "version" | "processInstanceId"

/** The ids each screen takes. */
const TAKES: Readonly<Record<ScreenKind, readonly ScreenId[]>> = {
  engine: [],
  process: ["processDefinitionKey", "tenantId", "version"],
  instance: ["processInstanceId"],
}

const SCREEN_IDS: readonly ScreenId[] = [
  "processDefinitionKey",
  "tenantId",
  "version",
  "processInstanceId",
]

/** Arguments a screen does not take, or without the id it needs: no retry changes them. */
class ScreenSelectionError extends Error {
  readonly code = "INVALID_SELECTION" as const

  constructor(message: string) {
    super(message)
    this.name = "ScreenSelectionError"
  }
}

/** The id `args` must name for their screen, or the refusal that it is missing. */
function needed<T>(args: ScreenArgs, id: ScreenId, value: T | undefined): T {
  if (value === undefined) throw new ScreenSelectionError(`Screen ${args.screen} needs ${id}.`)
  return value
}

/** The screen `args` ask for; refused when they name an id it does not take or lack its own. */
function targetOf(args: ScreenArgs): ScreenFormTarget {
  const others = SCREEN_IDS.filter(
    (id) => args[id] !== undefined && !TAKES[args.screen].includes(id),
  )
  if (others.length > 0) {
    throw new ScreenSelectionError(`Screen ${args.screen} takes no ${others.join(" or ")}.`)
  }
  switch (args.screen) {
    case "engine":
      return { screen: "engine" }
    case "process":
      return {
        screen: "process",
        process: needed(args, "processDefinitionKey", args.processDefinitionKey),
        tenantId: args.tenantId,
        version: args.version,
      }
    case "instance":
      return {
        screen: "instance",
        instanceId: needed(args, "processInstanceId", args.processInstanceId),
      }
  }
}

/** The screen and board tools, the board's over `boards` (none without ENGINE_BOARDS_DIR). */
export function registerScreenTools(register: EngineToolRegistrar, boards?: BoardFiles): void {
  register({
    name: ENGINE_GET_SCREEN,
    category: "screens",
    description:
      "A web app screen as JSON data, no UI, in the form @miragon/pulse-blocks renders: engine " +
      "(its processes with their counts), process (each version's counts, one version's badges " +
      "per element) or instance (its incidents, waits, path, variables). Check formatVersion.",
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    // As the screen feeds: through the engine contract, an engine of every dialect.
    dialects: EVERY_DIALECT,
    inputSchema: { ...getScreenInput.shape, ...engineParamShape },
    handler: async (registry: EngineRegistry, args, call?: EngineCallContext) => {
      const target = targetOf(args)
      const engine = resolveRuntimeEngine(args.engine, registry, call)
      return await readScreenForm(engine, target).catch((error: unknown) => {
        throw contractToolError(error)
      })
    },
  })

  register({
    name: ENGINE_GET_BOARD,
    category: "screens",
    description:
      "A board as JSON data, no UI, in the form @miragon/pulse-blocks renders, read from the " +
      "engines it names as engine_open_cockpit shows it. Check formatVersion.",
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    // As the board feed: the board names its engines, of every dialect, each by its name.
    dialects: EVERY_DIALECT,
    inputSchema: getBoardInput.shape,
    handler: (registry: EngineRegistry, { board }, call?: EngineCallContext) =>
      readBoardForm(
        boards,
        board,
        namedReads({ registry, boards }, { dialects: EVERY_DIALECT }, call).resolve,
      ),
  })
}
