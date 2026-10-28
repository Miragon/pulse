import { z } from "zod"
import type { createToolRegistrar } from "@miragon/mcp-toolkit-core/tools"
import { saveModuleSlice, type ProfileStore } from "@miragon/pulse-widget-shell/server"
import { UnknownEngineError, type EngineRegistry, type EngineEntry } from "../lib/resolve-engine.js"
import { environmentOf, groupEnginesByEnvironment } from "../lib/environments.js"
import { providerForEntry } from "../providers/index.js"
import {
  advisoryCamunda7Settings,
  allowedEngines,
  profileDefaultEngineId,
} from "../lib/engine-preferences.js"
import { CAMUNDA7_MODULE_KEY } from "../lib/profile-schema.js"
import { resolveAuthUserId, resolveProfileKey } from "../lib/resolve-profile-key.js"
import { CAMUNDA7_LIST_ENGINES, CAMUNDA7_SELECT_ENGINE } from "../tool-names.js"

type Register = ReturnType<typeof createToolRegistrar<EngineRegistry>>

/** List is a read, so even a read-only multi-engine deployment can route; select is a write. */
export function registerEngineTools(register: Register, profileStore: ProfileStore): void {
  // Advisory: a profile-store outage lists every engine instead of failing the one tool a
  // multi-engine caller needs to route (select still fails visibly at its write).
  const allowedEnginesFor = async (reg: EngineRegistry, ctx: unknown): Promise<EngineEntry[]> =>
    allowedEngines(await advisoryCamunda7Settings(profileStore, ctx), reg.engines)

  register({
    name: CAMUNDA7_LIST_ENGINES,
    category: "engines",
    description:
      "List the engines available to this profile, grouped by environment (`environments` maps each " +
      "to its engine ids), plus the caller's saved default engine (`defaultEngineId`, null when none).",
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    inputSchema: {},
    handler: async (reg: EngineRegistry, _args, ctx) => {
      const available = await allowedEnginesFor(reg, ctx)
      return {
        // No REST baseUrl: internal network topology the model never needs.
        engines: available.map((e) => {
          const provider = providerForEntry(e)
          return {
            id: e.id,
            environment: environmentOf(e),
            flavor: provider.flavor,
            engineName: provider.branding.displayName,
            ...(e.cockpitUrl ? { cockpitUrl: e.cockpitUrl } : {}),
          }
        }),
        environments: groupEnginesByEnvironment(available).map((g) => ({
          id: g.id,
          engineIds: g.engines.map((e) => e.id),
        })),
        defaultEngineId: (await profileDefaultEngineId(profileStore, reg.engines, ctx)) ?? null,
      }
    },
  })

  register({
    name: CAMUNDA7_SELECT_ENGINE,
    category: "engines",
    description:
      "Save an engine as the caller's default: camunda7 tool calls without `engine` then route to it " +
      "(a durable per-user setting, the same field the settings page edits). Needs a signed-in caller.",
    annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: false },
    inputSchema: {
      engineId: z.string().min(1).describe('Engine id to save as the default, e.g. "prod-a"'),
    },
    handler: async (reg: EngineRegistry, args, ctx) => {
      const id = args.engineId
      if (!reg.engines.some((e) => e.id === id)) {
        throw new UnknownEngineError(id, reg.engines)
      }
      const available = await allowedEnginesFor(reg, ctx)
      if (!available.some((e) => e.id === id)) {
        throw new Error(
          `Engine "${id}" is not available for this profile. ` +
            `Available: ${available.map((e) => e.id).join(", ")}. ` +
            "Update your settings (camunda7_save_settings) to widen allowedEngineIds.",
        )
      }
      // Mirrors requireProfileKey, but names the per-call override, which needs no identity.
      const key = resolveProfileKey(ctx)
      if (!key) {
        throw new Error(
          "No caller identity to save a default engine under — a saved default is per signed-in user (the server needs MCP_OAUTH); " +
            "pass the per-call `engine` parameter instead.",
        )
      }
      // The patch alone: the store merges it under its per-key lock, so a racing settings save
      // cannot revert the new default.
      await saveModuleSlice(
        profileStore,
        key,
        CAMUNDA7_MODULE_KEY,
        { defaultEngineId: id },
        { userId: resolveAuthUserId(ctx) },
      )
      return { defaultEngineId: id }
    },
  })
}
