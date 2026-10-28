import {
  createLocalizeFor,
  createLocalizeViewFor,
  createViewLocaleOf,
  resolveProfileLocale,
} from "@miragon/pulse-widget-shell/server"
import type { ProfileSource, ServerT, ViewLocale } from "@miragon/pulse-widget-shell/server"
import { translator } from "../messages/index.js"

// Binds the shared kit's locale rules to this module's catalogs; pass the handler `ctx`.
export type { ServerT, ViewLocale }

export async function resolveLocale(store: ProfileSource, ctx?: unknown): Promise<string> {
  return resolveProfileLocale(store, ctx)
}

export const localizeFor: (store?: ProfileSource, ctx?: unknown) => Promise<ServerT> =
  createLocalizeFor(translator)

export const viewLocaleOf: (language: string | undefined) => ViewLocale =
  createViewLocaleOf(translator)

/** Fail-soft: no store, no caller or an outage reads as "system". */
export const localizeViewFor: (store?: ProfileSource, ctx?: unknown) => Promise<ViewLocale> =
  createLocalizeViewFor(translator)
