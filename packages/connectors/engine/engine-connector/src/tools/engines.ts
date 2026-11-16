import { engineStatusInput } from "../schemas/index.js"
import type { BoardFiles } from "../board-files.js"
import type { ToolRegistrar } from "@miragon/pulse-widget-shell/server"
import { engineStatusForModel } from "../lib/core-adapter/composites.js"
import type { VerdictThresholds } from "@miragon/pulse-c7-core"
import type { EngineRegistry, RefusedProfile } from "../lib/engine/resolve-engine.js"
import { engineParamShape, withEngine } from "../lib/engine/with-engine.js"
import { environmentOf, groupEnginesByEnvironment } from "../lib/shared/environments.js"
import { providerForEntry } from "../providers/index.js"
import { ENGINE_LIST_ENGINES } from "../tool-names.js"

/** A refused profile as the model reads it: its id, its environment and why, never a value. */
function refusedEntry({ id, environment, reason }: RefusedProfile) {
  return { id, ...(environment === undefined ? {} : { environment }), reason }
}

/**
 * The boards of ENGINE_BOARDS_DIR as the model reads them: each board's id (what
 * engine_open_cockpit's `board` takes), its title and the engines it names; a file that gives no
 * board with how many problems it has, never their text.
 */
function boardList({ boards, refused }: BoardFiles) {
  return {
    boards: boards.map(({ id, board }) => ({ id, title: board.title, engines: board.engines })),
    ...(refused.length > 0
      ? { refusedBoards: refused.map(({ id, problems }) => ({ id, problems: problems.length })) }
      : {}),
  }
}

/**
 * Reads: the engine list (so even a read-only multi-engine deployment can route, and with
 * ENGINE_BOARDS_DIR the boards) and the triage, judged by the thresholds the cockpit's overview
 * uses.
 */
export function registerEngineTools(
  register: ToolRegistrar<EngineRegistry>,
  thresholds: VerdictThresholds,
  boards?: BoardFiles,
): void {
  register({
    name: ENGINE_LIST_ENGINES,
    category: "engines",
    description:
      "List the configured engines, grouped by environment (`environments` maps each " +
      "to its engine ids), plus the default engine (`defaultEngineId`, null when none) and the " +
      "server's boards, if it has any (`boards`).",
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    inputSchema: {},
    handler: (reg: EngineRegistry) =>
      Promise.resolve({
        // No REST baseUrl: internal network topology the model never needs.
        engines: reg.engines.map((e) => {
          const provider = providerForEntry(e)
          return {
            id: e.id,
            environment: environmentOf(e),
            flavor: provider.flavor,
            engineName: provider.branding.displayName,
            ...(e.cockpitUrl ? { cockpitUrl: e.cockpitUrl } : {}),
          }
        }),
        environments: groupEnginesByEnvironment(reg.engines).map((g) => ({
          id: g.id,
          engineIds: g.engines.map((e) => e.id),
        })),
        defaultEngineId: reg.defaultEngineId ?? null,
        // Only when there is one: a call to it fails with ENGINE_PROFILE_REFUSED and this reason.
        ...(reg.refused.size > 0 ? { refused: [...reg.refused.values()].map(refusedEntry) } : {}),
        // Only with ENGINE_BOARDS_DIR: engine_open_cockpit with view board opens one.
        ...(boards ? boardList(boards) : {}),
      }),
  })

  register({
    name: "engine_status",
    category: "engines",
    description: "Triage of one engine: findings by severity, overall status and counts.",
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    inputSchema: { ...engineStatusInput.shape, ...engineParamShape },
    handler: withEngine((client, args, { engineId }) =>
      engineStatusForModel(client, args, engineId, thresholds),
    ),
  })
}
