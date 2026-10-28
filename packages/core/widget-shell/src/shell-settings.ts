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
 * Owned by no connector (#346). The save is a durable write no module toolset filters, so it
 * registers only while `frameworkWritesAllowed(boot)` holds.
 */

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

/** Exported for the brand gates (`catalogTextFindings`). */
export const SHELL_SETTINGS_CATALOGS = catalogs
const viewLocaleOf = createViewLocaleOf(createTranslator(catalogs))

const languageName = (t: ServerT, language: LanguagePref) => t(`settings.language.${language}`)

export const shellSettingsSaveInput = {
  language: z
    .enum(LANGUAGES)
    .describe('"system" follows the chat app. Tool summaries follow it too.'),
}

export interface ShellSettingsToolsOptions {
  profileStore: ProfileStore
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
      // Same key as the save; without OAuth no key resolves: defaults, read-only.
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
