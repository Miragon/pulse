import { resolveProfileKey } from "./profile.js"
import type { ProfileSource } from "./profile.js"
import { readProfileAdvisory } from "./profile-advisory.js"
import { explicitLocale } from "./profile-constants.js"

export type ServerT = (key: string, params?: Record<string, unknown>) => string

export type Translator = (locale: string, key: string, params?: Record<string, unknown>) => string

/**
 * `system` reads as English: the host locale is a widget-side signal the server never sees.
 * Fail-soft on a store OUTAGE too: a Postgres hiccup must degrade the summary to English,
 * never fail a tool whose data comes from the engine/Prometheus.
 */
export async function resolveProfileLocale(
  store: ProfileSource | undefined,
  ctx?: unknown,
): Promise<string> {
  if (!store) return "en"
  return (
    explicitLocale((await readProfileAdvisory(store, resolveProfileKey(ctx)))?.language) ?? "en"
  )
}

export function createLocalizeFor(
  translator: Translator,
): (store?: ProfileSource, ctx?: unknown) => Promise<ServerT> {
  return async (store, ctx) => {
    const locale = await resolveProfileLocale(store, ctx)
    return (key, params) => translator(locale, key, params)
  }
}

/**
 * A translator bound to the language a profile names; `system` and no profile read as English,
 * since the server never sees the host locale. The server never titles a view: views carry their
 * own heading in the host's language.
 */
export function createLanguageT(translator: Translator): (language: string | undefined) => ServerT {
  return (language) => {
    const locale = explicitLocale(language) ?? "en"
    return (key, params) => translator(locale, key, params)
  }
}
