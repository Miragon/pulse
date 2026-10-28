import {
  createLocalizeFor,
  createLocalizeViewFor,
  resolveProfileKey,
} from "@miragon/pulse-widget-shell/server"
import { translator } from "./messages/index.js"

/**
 * Re-exported from the shared kit, never copied: a divergent key precedence would
 * split a user's settings across two records.
 */
export type { ProfileSlice, ProfileSource } from "@miragon/pulse-widget-shell/server"

export const resolveSettingsKey = resolveProfileKey

export type { ServerT, ViewLocale } from "@miragon/pulse-widget-shell/server"

/** Pass the handler `ctx` so the caller resolves the same record the save path writes. */
export const localizeFor = createLocalizeFor(translator)

/** One profile read; titled only in a language the profile names (#322 U3). */
export const localizeViewFor = createLocalizeViewFor(translator)
