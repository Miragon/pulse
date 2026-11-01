import {
  createLocalizeFor,
  createTranslator,
  resolveProfileKey,
} from "@miragon/pulse-widget-shell/server"
import { catalogs } from "./messages/index.js"

/**
 * Re-exported from the shared kit, never copied: a divergent key precedence would
 * split a user's settings across two records.
 */
export type { ProfileSlice, ProfileSource } from "@miragon/pulse-widget-shell/server"

export const resolveSettingsKey = resolveProfileKey

export type { ServerT } from "@miragon/pulse-widget-shell/server"

/** Pass the handler `ctx` so the caller resolves the same record the save path writes. */
export const localizeFor = createLocalizeFor(createTranslator(catalogs))
