import { createContext, useContext, useMemo, type ReactNode } from "react"
import { resolveUiMessages, type UiMessages, type UiMessagesOverride } from "./ui-messages.js"

/**
 * A translator over catalogs keyed by locale: any function of this shape, for
 * example a lookup in `{ en: { … }, de: { … } }` that fills `{param}` slots.
 */
export type Translate = (locale: string, key: string, params?: Record<string, unknown>) => string

/**
 * A locale-bound translate: the active locale is already applied, so call sites
 * only pass a key (+ params). Obtained from {@link useTranslate}.
 */
export type BoundTranslate = (key: string, params?: Record<string, unknown>) => string

/** The value exposed by {@link useLocale} / {@link useTranslate}. */
export interface LocaleContextValue {
  /** The active locale tag (e.g. `"en"`, `"de"`). */
  locale: string
  /** Translate a key in the active locale. */
  t: BoundTranslate
  /**
   * The kit's own strings for the active locale (its shipped `en`/`de`
   * catalog, English for any other locale) with the provider's
   * `uiMessages` override applied. Read it with {@link useUiMessages}.
   * Optional on the type (a hand-built value may omit it); `LocaleProvider`
   * always sets it.
   */
  messages?: UiMessages
}

const DEFAULT_LOCALE = "en"

/**
 * Default used when a component renders *outside* a {@link LocaleProvider}.
 * The locale hooks degrade rather than throw: a missing wrapper echoes the key
 * (visible + greppable) instead of crashing a component that renders fine in
 * English.
 */
const DEFAULT_VALUE = {
  locale: DEFAULT_LOCALE,
  t: (key) => key,
  messages: resolveUiMessages(DEFAULT_LOCALE),
} satisfies Required<LocaleContextValue>

const LocaleContext = createContext<LocaleContextValue | null>(null)

/** Read the active locale tag from the nearest {@link LocaleProvider}. */
export function useLocale(): string {
  return useContext(LocaleContext)?.locale ?? DEFAULT_VALUE.locale
}

/**
 * Get a locale-bound translate from the nearest {@link LocaleProvider}. Outside
 * a provider it returns a passthrough that echoes the key, so unwrapped widgets
 * render their keys instead of throwing.
 */
export function useTranslate(): BoundTranslate {
  return useContext(LocaleContext)?.t ?? DEFAULT_VALUE.t
}

/**
 * The kit's own UI strings for the nearest {@link LocaleProvider}'s locale
 * (English outside a provider). Every kit component reads its captions,
 * labels and accessible names here, so a German locale renders no English
 * kit chrome.
 */
export function useUiMessages(): UiMessages {
  return useContext(LocaleContext)?.messages ?? DEFAULT_VALUE.messages
}

/**
 * The locale the kit's own text is in: the nearest {@link LocaleProvider}'s,
 * else `"en"`. Kit components format their numbers with it, so a count
 * always matches the language of the sentence around it. Internal: consumer
 * widgets read {@link useLocale}.
 */
export function useUiLocale(): string {
  return useContext(LocaleContext)?.locale ?? DEFAULT_VALUE.locale
}

export interface LocaleProviderProps {
  /** The active locale tag (e.g. `"en"`, `"de"`). */
  locale: string
  /**
   * A {@link Translate} over your own catalogs. Omit to provide the locale only
   * (translate echoes keys), useful while you wire the locale before any
   * catalog exists. The kit's own strings need no translator.
   */
  translator?: Translate
  /**
   * Override individual kit strings for this subtree, per catalog section
   * (e.g. `{ listFooter: { loadMore: "Show more" } }`). Omitted entries keep the
   * shipped `en`/`de` catalog of `locale`.
   */
  uiMessages?: UiMessagesOverride
  children: ReactNode
}

/**
 * Provide the active locale (and an optional translator) to a subtree. Widgets
 * read it with {@link useLocale} / {@link useTranslate}. Pure React, so it
 * works in a host, a standalone app, or a test alike.
 *
 * The locale itself is app-specific (a header, a user profile, a session
 * store …): resolve it on the host/server and pass it in.
 *
 * @example
 * const CATALOGS = { en: { title: "Orders" }, de: { title: "Aufträge" } }
 * const translator: Translate = (locale, key) => CATALOGS[locale]?.[key] ?? key
 * <LocaleProvider locale="de" translator={translator}>
 *   <YourWidget />
 * </LocaleProvider>
 */
export function LocaleProvider({
  locale,
  translator,
  uiMessages,
  children,
}: LocaleProviderProps): ReactNode {
  const value = useMemo<LocaleContextValue>(
    () => ({
      locale,
      t: translator ? (key, params) => translator(locale, key, params) : (key) => key,
      messages: resolveUiMessages(locale, uiMessages),
    }),
    [locale, translator, uiMessages],
  )
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>
}
