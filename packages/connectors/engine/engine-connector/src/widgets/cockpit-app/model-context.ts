import { enginesByEnvironment } from "../../lib/shared/environments.js"
import type { ViewContext } from "../lib/hand-off.js"
import type { CockpitView } from "../../view-models.js"
import type { BoardStartData } from "../../view-models.board.js"
import { selectedEntity } from "../nav-core.js"

/** The view was navigated client-side: no chat turn tells the model. */
export function cockpitContext(engineId: string, current: CockpitView): ViewContext {
  const selected = selectedEntity(current)
  return {
    summary:
      "The operator is in the consolidated engine cockpit; navigation is client-side " +
      "(definitions → instances → instance). Offer analysis, a modification or migration plan, " +
      "or a ticket draft when relevant.",
    ids: {
      engine: engineId,
      incidentId: selected.incidentId,
      processInstanceId: selected.processInstanceId,
      processDefinitionKey: selected.processDefinitionKey,
    },
    facts: { view: current.section },
  }
}

/**
 * The open engine's profile is refused (`RefusedEngineGate`): its reason is the view's one state,
 * so the model offers no work on it, since every call to it fails the same way.
 */
export function refusedEngineContext(engineId: string): ViewContext {
  return {
    summary:
      "The operator opened an engine in the engine cockpit whose profile the server refused: " +
      "every read and write to it fails until whoever runs the server fixes the profile, and the " +
      "view shows only that reason. Offer no analysis or change on this engine; another engine " +
      "can still be opened.",
    ids: { engine: engineId },
    facts: { profileRefused: true },
  }
}

/** No engine is open: the engine ids are facts, not an `engine` to pin. */
export function landingContext(
  engineGroups: Array<{ id: string; engines: Array<{ id: string }> }>,
): ViewContext {
  return {
    summary:
      "The operator is on the engine cockpit's engine picker: no engine is open yet, so nothing " +
      "on screen is scoped to one engine. Before an engine-specific answer, ask which engine they " +
      "mean, or pass `engine` explicitly.",
    facts: {
      engines: engineGroups.flatMap((g) => g.engines.map((e) => e.id)),
      environments: enginesByEnvironment(engineGroups),
    },
  }
}

/** Never a ranking: engines run different processes. */
export function fleetContext(
  engineGroups: Array<{ id: string; engines: Array<{ id: string }> }>,
): ViewContext {
  return {
    summary:
      "The operator is in the engine cockpit's CROSS-ENGINE mode — an overview across engines, " +
      "not a ranking between them (they run different processes). Drilling into an engine opens " +
      "its single-engine cockpit.",
    ids: { engine: engineGroups.flatMap((g) => g.engines.map((e) => e.id)) },
    facts: { environments: enginesByEnvironment(engineGroups) },
  }
}

/**
 * A board: the engines it names, a list of `engine`s, each in its state; the board's title is the
 * operator's text from its file, fenced. The tiles' numbers were the tool's facts when it opened.
 */
export function boardContext(board: string, data: BoardStartData): ViewContext {
  const failed = data.engines.filter((engine) => engine.state !== "ready")
  return {
    summary:
      "The operator is viewing a board in the engine cockpit: tiles of counts, instances, " +
      "incidents and a diagram, read from the engines the board names, each engine in its own " +
      "state; a number that was not read shows as missing, never 0. Navigation is client-side: " +
      "a tile opens the engine's own view.",
    ids: { board, engine: data.engines.map((engine) => engine.name) },
    facts: {
      view: "board",
      asOf: data.asOf,
      engines: data.engines.length,
      enginesNotRead: failed.length,
      tiles: data.rows.flat().length,
      refusedTiles: data.rows.flat().filter((tile) => tile.kind === "refused").length,
    },
    untrusted: [{ label: "Board title", text: data.title }],
  }
}
