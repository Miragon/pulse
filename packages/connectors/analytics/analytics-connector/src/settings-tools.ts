import type { MCPServer } from "mcp-use"
import { registerSettingsSection, saveModuleSlice } from "@miragon/pulse-widget-shell/server"
import { ANALYTICS_SAVE_SETTINGS, ANALYTICS_SETTINGS_DATA } from "./tool-names.js"
import { localizeFor, localizeViewFor, type ProfileSource, type ServerT } from "./server-locale.js"
import {
  ANALYTICS_MODULE_KEY,
  analyticsSettingsSaveInput,
  parseAnalyticsSettings,
  settingsFor,
  type AnalyticsSettings,
} from "./settings.js"
import { allowsDurableWrites, type AnalyticsToolset } from "./toolsets.js"

/** Own tool triple, so camunda7 owns no analytics vocabulary. */

export interface AnalyticsSettingsView {
  settings: AnalyticsSettings
  /** False without a writable store, on the read-only floor or without a caller identity. */
  canSave: boolean
}

export function registerSettingsTools(
  server: MCPServer,
  profileStore?: ProfileSource,
  toolset?: AnalyticsToolset,
): void {
  // Registered outside the registrar, so the save gates itself (`allowsDurableWrites`).
  const store = profileStore
  const save = allowsDurableWrites(toolset) ? store?.save?.bind(store) : undefined

  const summarize = (t: ServerT, view: AnalyticsSettingsView): string =>
    t("aSum.settings", {
      period: view.settings.defaultPeriod,
      minBucketSize: view.settings.minBucketSize,
      changeHint: view.canSave ? t("aSum.settingsChangeHint") : "",
    })

  registerSettingsSection(server, {
    app: "analytics",
    widget: "analytics:settings",
    openWorldHint: true,
    load: async (ctx, _key, gate) => ({
      view: { settings: await settingsFor(store, ctx), ...gate } satisfies AnalyticsSettingsView,
    }),
    show: {
      name: "analytics_show_settings",
      title: "Analytics Settings",
      description:
        "Open the analytics settings section: the default look-back period and the minimum comparison bucket size applied when analytics calls omit them.",
      render: async ({ view }, ctx) => {
        const { t, title } = await localizeViewFor(store, ctx)
        // None with "system": the section heading names it.
        return { title: title("aSettings.heading"), summary: summarize(t, view) }
      },
    },
    feed: {
      name: ANALYTICS_SETTINGS_DATA,
      title: "Analytics settings data (internal)",
      description:
        "Internal JSON feed (no UI) for the analytics settings section's self-fetch. Prefer analytics_show_settings.",
    },
    save:
      save && store
        ? {
            name: ANALYTICS_SAVE_SETTINGS,
            title: "Save analytics settings",
            description:
              "Update the caller's analytics defaults. Only the provided fields change; omitted fields keep their value. The saved defaults apply whenever an analytics call omits `period` or `minBucketSize`.",
            input: analyticsSettingsSaveInput.shape,
            write: async (params, { key, userId }, ctx) => {
              // The store merges the patch under its per-key lock, so a
              // concurrent save of the other field is never reverted.
              const savedSlice = await saveModuleSlice(
                { get: (k) => store.get(k), save },
                key,
                ANALYTICS_MODULE_KEY,
                params,
                { userId },
              )
              const effective = parseAnalyticsSettings({ [ANALYTICS_MODULE_KEY]: savedSlice })
              const t = await localizeFor(store, ctx)
              const text = t("aSum.settingsSaved", {
                period: effective.defaultPeriod,
                minBucketSize: effective.minBucketSize,
              })
              return { text, saved: effective }
            },
          }
        : undefined,
  })
}
