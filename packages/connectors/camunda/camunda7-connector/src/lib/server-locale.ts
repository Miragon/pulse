import { createLocalizeFor, resolveProfileLocale } from "@miragon/pulse-widget-shell/server"
import type { ProfileSource, ServerT } from "@miragon/pulse-widget-shell/server"
import { translator } from "../messages/index.js"

// Binds the shared kit's locale rules to this module's catalogs; pass the handler `ctx`.
export type { ServerT }

export async function resolveLocale(store: ProfileSource, ctx?: unknown): Promise<string> {
  return resolveProfileLocale(store, ctx)
}

export const localizeFor: (store?: ProfileSource, ctx?: unknown) => Promise<ServerT> =
  createLocalizeFor(translator)
