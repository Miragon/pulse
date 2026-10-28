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

/** What a show tool needs to word its result: the model summary and the view title. */
export interface ViewLocale {
  t: ServerT
  /** Undefined for "system": the server never sees the host locale, so the widget heading names the view (#322 U3). */
  title: (key: string, params?: Record<string, unknown>) => string | undefined
}

export function createViewLocaleOf(
  translator: Translator,
): (language: string | undefined) => ViewLocale {
  return (language) => {
    const named = explicitLocale(language)
    const t: ServerT = (key, params) => translator(named ?? "en", key, params)
    return { t, title: (key, params) => (named ? t(key, params) : undefined) }
  }
}

/** One profile read for summary and title; fail-soft like {@link resolveProfileLocale}. */
export function createLocalizeViewFor(
  translator: Translator,
): (store?: ProfileSource, ctx?: unknown) => Promise<ViewLocale> {
  const viewLocaleOf = createViewLocaleOf(translator)
  return async (store, ctx) => {
    const record = store ? await readProfileAdvisory(store, resolveProfileKey(ctx)) : undefined
    return viewLocaleOf(record?.language)
  }
}
