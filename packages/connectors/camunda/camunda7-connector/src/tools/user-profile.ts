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
 * One-line, model-facing summary of the settings — localized to the record's
 * language (steers the model toward responding in that language; the MCP
 * server cannot force the model's output language). `system` follows the
 * host's locale, a widget-side signal the server never sees — English here.
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

/**
 * Registers camunda7's settings section, a `<module>:settings` section of the
 * shell's settings page like analytics': `camunda7_show_settings`, its feed
 * `camunda7_settings_data` and the partial update `camunda7_save_settings`.
 * The UI language is the shell's (`shell_save_settings`), not this module's.
 * None of them talks to an engine; the registry only lists the configured
 * engines the section offers as availability checkboxes.
 *
 * The save is a durable write registered OUTSIDE the registrar, so it gates
 * itself against the (already concrete) toolset through the one profile-write
 * decision `camunda7_select_engine` shares: absent in `read-only`, present in
 * `operations`/`admin`.
 */
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
        // By id + environment only — the engine REST baseUrl is internal
        // topology the settings panel has no use for.
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
      // Titled only in a language the profile names; "system" sets none, so
      // no English toolbar title sits over a German section (#322 U3).
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
          // The flat input is a tool-API convenience; the handler writes it
          // into this module's own slice.
          input: userProfileToolSaveInput.shape,
          write: async (params, { key, userId }) => {
            // The store is called directly for the record it returns (its
            // `updatedAt` re-syncs the section's form), with ONLY the given
            // fields, merged over the RAW stored slice under its per-key lock,
            // so a concurrent `camunda7_select_engine` is never reverted.
            const slicePatch: Record<string, unknown> = { ...params }
            // The settings UI sends "" for the "(auto)"/"(none)" option of an
            // optional id field. That CLEARS the stored value: an explicit
            // `undefined` overrides the stored field in the store's merge.
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
