import type { MCPServer } from "mcp-use"
import {
  explicitLocale,
  registerSettingsSection,
  type LanguagePref,
  type ProfileStore,
} from "@miragon/pulse-widget-shell/server"
import { allowsProfileSave, type Camunda7Toolset } from "../lib/toolsets.js"
import {
  CAMUNDA7_SAVE_SETTINGS,
  CAMUNDA7_SHOW_SETTINGS,
  CAMUNDA7_SETTINGS_DATA,
} from "../tool-names.js"
import {
  CAMUNDA7_MODULE_KEY,
  defaultUserProfile,
  toUserProfile,
  userProfileToolSaveInput,
  type ProfileReadOnlyReason,
  type UserProfile,
  type UserProfileView,
} from "../lib/profile-schema.js"
import { environmentOf } from "../lib/environments.js"
import type { EngineRegistry } from "../lib/resolve-engine.js"
import { translator } from "../messages/index.js"
import { viewLocaleOf } from "../lib/server-locale.js"

/**
 * Localized to steer the model's reply language. `system` is the host's locale, which the
 * server never sees, so English here.
 */
function summarize(p: UserProfile, language: LanguagePref): string {
  const locale = explicitLocale(language) ?? "en"
  const engines =
    p.allowedEngineIds && p.allowedEngineIds.length > 0
      ? translator(locale, "profile.summary.someEngines", { count: p.allowedEngineIds.length })
      : translator(locale, "profile.summary.allEngines")
  const defaultDashboard = p.defaultDashboardId
    ? translator(locale, "profile.summary.defaultDashboard", { id: p.defaultDashboardId })
    : ""
  return translator(locale, "profile.summary", { engines, defaultDashboard })
}

/** The save lives outside the registrar, so it gates itself by the decision `camunda7_select_engine` shares. */
export function registerUserProfileTools(
  server: MCPServer,
  store: ProfileStore,
  registry: EngineRegistry,
  toolset: Camunda7Toolset,
): void {
  registerSettingsSection(server, {
    app: "camunda7",
    widget: "camunda7:settings",
    openWorldHint: true,
    readOnlyReason: "toolset" satisfies ProfileReadOnlyReason,
    load: async (_ctx, key, gate) => {
      // The record's language words the summary and the title; it is not part of the view.
      const record = key ? await store.get(key) : undefined
      const view: UserProfileView = {
        profile: record ? toUserProfile(record) : defaultUserProfile(),
        // No REST baseUrl: internal topology.
        availableEngines: registry.engines.map((e) => ({
          id: e.id,
          environment: environmentOf(e),
        })),
        canSave: gate.canSave,
        readOnlyReason: gate.readOnlyReason ?? null,
      }
      return { view, language: record?.language ?? "system" }
    },
    show: {
      name: CAMUNDA7_SHOW_SETTINGS,
      title: "Engine & dashboard settings",
      description:
        "Open camunda7's settings: available engines, the default engine, dashboard preferences.",
      // "system" sets no title, so no English title sits over a German section (#322 U3).
      render: ({ view, language = "system" }) => ({
        title: viewLocaleOf(language).title("viewTitle.settings"),
        summary: summarize(view.profile, language),
      }),
    },
    feed: {
      name: CAMUNDA7_SETTINGS_DATA,
      title: "Settings data (internal)",
      description:
        "Internal JSON feed (no UI) for the caller's camunda7 settings + the configured engine list. Prefer camunda7_show_settings.",
    },
    save: allowsProfileSave(toolset)
      ? {
          name: CAMUNDA7_SAVE_SETTINGS,
          title: "Save engine & dashboard settings",
          description:
            'Update the caller\'s camunda7 settings. Only the provided fields change; omitted fields keep their value. Use it for requests like "only let me pick the prod engines" (allowedEngineIds) or a default dashboard. Engine availability is curation, not access control.',
          annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: false },
          input: userProfileToolSaveInput.shape,
          write: async (params, { key, userId }) => {
            // Only the given fields, merged under the store's per-key lock, so a concurrent
            // `camunda7_select_engine` is never reverted; the returned `updatedAt` re-syncs the form.
            const slicePatch: Record<string, unknown> = { ...params }
            // "" from the "(auto)"/"(none)" option clears: an explicit `undefined` wins in the merge.
            for (const field of ["defaultEngineId", "defaultDashboardId"]) {
              if (slicePatch[field] === "") slicePatch[field] = undefined
            }
            const saved = await store.save(
              key,
              { modules: { [CAMUNDA7_MODULE_KEY]: slicePatch } },
              { userId },
            )
            const profile = toUserProfile(saved)
            return { text: summarize(profile, saved.language), saved: profile }
          },
        }
      : undefined,
  })
}
