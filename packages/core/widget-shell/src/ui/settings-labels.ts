import type { Locale } from "../profile-constants.js"
import type { ShellSettingsReadOnlyReason } from "../shell-settings-contract.js"
import { supportedLanguage } from "./host-context.js"

/** Voice per brand-tone; `brand-gates.test.ts` runs the catalog text test over both sets. */
export interface SettingsLabels {
  pageTitle: string
  pageSubtitle: string
  languageSection: string
  language: string
  languageHelp: string
  /** The "system" option: the view follows the chat app's locale. */
  languageSystem: string
  save: string
  saving: string
  savedToast: string
  saveFailedToast: string
  loadError: string
  none: string
  readOnlyTitle: string
  readOnly: Readonly<Record<ShellSettingsReadOnlyReason, string>>
}

/** Each language named in itself, so a reader finds theirs in any view. */
export const LANGUAGE_NAMES: Readonly<Record<Locale, string>> = { en: "English", de: "Deutsch" }

const LABELS: Readonly<Record<Locale, SettingsLabels>> = {
  en: {
    pageTitle: "Settings",
    pageSubtitle: "Your language and each module's settings, in every chat.",
    languageSection: "Language",
    language: "Language",
    languageHelp:
      "Automatic follows your chat app. A fixed language also applies to what the tools report back to the AI.",
    languageSystem: "Automatic (follows the chat app)",
    save: "Save",
    saving: "Saving…",
    savedToast: "Language saved",
    saveFailedToast: "Couldn't save the language",
    loadError: "Couldn't load the language setting",
    none: "No settings available",
    readOnlyTitle: "The language is read-only here",
    readOnly: {
      noSignIn:
        "This connection has no sign-in, so it has no one to save settings for. Saving needs a connection with sign-in: ask your administrator to set one up.",
      readOnly:
        "This server runs a module read-only, so it saves no settings. Ask your administrator for a connection that allows changes.",
    },
  },
  de: {
    pageTitle: "Einstellungen",
    pageSubtitle: "Deine Sprache und die Einstellungen jedes Moduls, in jedem Chat.",
    languageSection: "Sprache",
    language: "Sprache",
    languageHelp:
      "„Automatisch“ übernimmt die Sprache deiner Chat-App. Eine feste Sprache gilt auch für das, was die Tools der AI zurückmelden.",
    languageSystem: "Automatisch (wie die Chat-App)",
    save: "Speichern",
    saving: "Wird gespeichert…",
    savedToast: "Sprache gespeichert",
    saveFailedToast: "Die Sprache wurde nicht gespeichert",
    loadError: "Die Spracheinstellung konnte nicht geladen werden",
    none: "Keine Einstellungen verfügbar",
    readOnlyTitle: "Die Sprache ist hier nur lesbar",
    readOnly: {
      noSignIn:
        "Diese Verbindung hat keine Anmeldung und weiß deshalb nicht, für wen sie speichern soll. Speichern geht nur über eine Verbindung mit Anmeldung: Bitte deine Administration, sie einzurichten.",
      readOnly:
        "Dieser Server betreibt ein Modul nur lesend und speichert deshalb keine Einstellungen. Bitte deine Administration um eine Verbindung, die Änderungen erlaubt.",
    },
  },
}

/** The settings words for a locale tag (`de-AT` → German); English for anything unsupported. */
export function settingsLabels(locale: string | undefined): SettingsLabels {
  return LABELS[supportedLanguage(locale) ?? "en"]
}

export const SETTINGS_LABELS: Readonly<Record<Locale, SettingsLabels>> = LABELS
