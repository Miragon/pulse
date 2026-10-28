import type { LanguagePref } from "./profile-constants.js"

/** No runtime dependency, so the browser bundle imports it without server code. */

export const SHELL_SHOW_SETTINGS = "shell_show_settings"
/** Also what `ProfileGate` reads the language from. */
export const SHELL_SETTINGS_DATA = "shell_settings_data"
export const SHELL_SAVE_SETTINGS = "shell_save_settings"

export const SHELL_SETTINGS_PAGE_WIDGET = "shell:settings-page"
export const SHELL_SETTINGS_WIDGET = "shell:settings"

export type ShellSettingsReadOnlyReason = "noSignIn" | "readOnly"

export interface ShellSettingsView {
  language: LanguagePref
  canSave: boolean
  readOnlyReason: ShellSettingsReadOnlyReason | null
}
