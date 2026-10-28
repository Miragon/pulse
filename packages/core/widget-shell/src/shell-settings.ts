import { z } from "zod"
import type { MCPServer } from "mcp-use"
import { createTranslator, type Catalogs } from "@miragon/mcp-toolkit-core"
import { LANGUAGES, type LanguagePref } from "./profile-constants.js"
import type { ProfileStore } from "./profile-store.js"
import { createViewLocaleOf, type ServerT } from "./server-locale.js"
import { registerSettingsSection } from "./settings-section.js"
import {
  SHELL_SAVE_SETTINGS,
  SHELL_SETTINGS_DATA,
  SHELL_SETTINGS_PAGE_WIDGET,
  SHELL_SHOW_SETTINGS,
  type ShellSettingsReadOnlyReason,
  type ShellSettingsView,
} from "./shell-settings-contract.js"

/**
 * The shell's settings tools — the record-level preferences every module
 * reads (the UI language) and the settings page, owned by no connector (#346):
 *   - `shell_show_settings`  renders the page (the shell's section first, then
 *     every module's `<module>:settings` section the host bundles);
 *   - `shell_settings_data`  is the section's app-only feed, and what
 *     `ProfileGate` reads the language from in every view;
 *   - `shell_save_settings`  saves the language.
 *
 * The save is a durable write no module toolset filters, so it follows the
 * host rule for those: registered only while the composition root says
 * framework writes are allowed (`frameworkWritesAllowed(boot)`: OAuth
 * installed AND no module on its read-only floor). The two view tools carry
 * the same decision as `canSave`, so the section never offers a Save that
 * would resolve to an unknown tool.
 */

/** The model's summaries, in the profile's language (English for "system"). */
const catalogs: Catalogs = {
  en: {
    "settings.title": "Settings",
    "settings.language.system": "automatic (follows the chat app)",
    "settings.language.en": "English",
    "settings.language.de": "German",
    "settings.summary": ({ language }) =>
      `Settings page: UI language ${String(language)}, then each module's settings section.`,
    "settings.summary.canSave": " The user can change them on the page or ask you to.",
    "settings.summary.readOnly": " Settings can't be saved on this server.",
    "settings.saved": ({ language }) => `UI language saved: ${String(language)}.`,
  },
  de: {
    "settings.title": "Einstellungen",
    "settings.language.system": "automatisch (folgt der Chat-App)",
    "settings.language.en": "Englisch",
    "settings.language.de": "Deutsch",
    "settings.summary": ({ language }) =>
      `Einstellungen: Sprache der Oberfläche ${String(language)}, danach der Abschnitt jedes Moduls.`,
    "settings.summary.canSave": " Du kannst sie auf der Seite ändern oder den Chat darum bitten.",
    "settings.summary.readOnly": " Auf diesem Server lassen sich keine Einstellungen speichern.",
    "settings.saved": ({ language }) => `Sprache der Oberfläche gespeichert: ${String(language)}.`,
  },
}

/** The server texts, exported for the brand gates (`catalogTextFindings`). */
export const SHELL_SETTINGS_CATALOGS = catalogs
const viewLocaleOf = createViewLocaleOf(createTranslator(catalogs))

const languageName = (t: ServerT, language: LanguagePref) => t(`settings.language.${language}`)

export const shellSettingsSaveInput = {
  language: z
    .enum(LANGUAGES)
    .describe('"system" follows the chat app. Tool summaries follow it too.'),
}

export interface ShellSettingsToolsOptions {
  /** The shared profile store; the language is a field of its record. */
  profileStore: ProfileStore
  /**
   * Whether the save tool exists: the composition root passes
   * `frameworkWritesAllowed(boot)`. False keeps the section read-only.
   */
  allowSave: boolean
}

export function registerShellSettingsTools(
  server: MCPServer,
  { profileStore: store, allowSave }: ShellSettingsToolsOptions,
): void {
  registerSettingsSection(server, {
    app: "shell",
    widget: SHELL_SETTINGS_PAGE_WIDGET,
    openWorldHint: false,
    readOnlyReason: "readOnly" satisfies ShellSettingsReadOnlyReason,
    load: async (_ctx, key, gate) => {
      // Same key as the save, so a save is always read back. Without OAuth no
      // key resolves: the defaults, read-only — the norm on an open server.
      const language = (key ? await store.get(key) : undefined)?.language ?? "system"
      const view: ShellSettingsView = {
        language,
        canSave: gate.canSave,
        readOnlyReason: gate.readOnlyReason ?? null,
      }
      return { view, language }
    },
    show: {
      name: SHELL_SHOW_SETTINGS,
      title: "Settings",
      description: "Open the settings page: the UI language and each module's settings.",
      render: ({ view }) => {
        // Titled only in a language the profile names; with "system" the
        // page's own heading names it in the host's language (#322 U3).
        const { t, title } = viewLocaleOf(view.language)
        const hint = view.canSave ? "settings.summary.canSave" : "settings.summary.readOnly"
        return {
          title: title("settings.title"),
          summary: t("settings.summary", { language: languageName(t, view.language) }) + t(hint),
        }
      },
    },
    feed: {
      name: SHELL_SETTINGS_DATA,
      title: "Settings data (internal)",
      description:
        "Internal JSON feed (no UI) for the settings page's language section. Prefer shell_show_settings.",
    },
    save: allowSave
      ? {
          name: SHELL_SAVE_SETTINGS,
          title: "Save settings",
          description:
            'Set the caller\'s UI language, e.g. "switch the UI to German" (language: "de").',
          input: shellSettingsSaveInput,
          write: async ({ language }, { key, userId }) => {
            // The store merges the one field over the raw stored record under
            // its per-key lock, so module slices saved concurrently survive.
            const saved = await store.save(key, { language }, { userId })
            const view: ShellSettingsView = {
              language: saved.language,
              canSave: true,
              readOnlyReason: null,
            }
            const { t } = viewLocaleOf(saved.language)
            return {
              text: t("settings.saved", { language: languageName(t, saved.language) }),
              saved: view,
            }
          },
        }
      : undefined,
  })
}
