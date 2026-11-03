import { useMemo } from "react"
import { useLocale, type Translate } from "../locale/locale-provider.js"

/** A locale-bound translate for widgets: `t(key, params?) => string`. */
export type T = (key: string, params?: Record<string, unknown>) => string

/** A module's `useT` over its own translator: the hook reads the locale of the nearest `LocaleProvider`. */
export function createUseT(translator: Translate): () => T {
  return function useT(): T {
    const locale = useLocale()
    return useMemo<T>(() => (key, params) => translator(locale, key, params), [locale])
  }
}
