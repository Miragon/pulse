import { useMemo } from "react"
import { useLocale } from "@miragon/mcp-toolkit-ui"

/** A locale-bound translate for widgets: `t(key, params?) => string`. */
export type T = (key: string, params?: Record<string, unknown>) => string

type Translator = (locale: string, key: string, params?: Record<string, unknown>) => string

/** Kept apart from `messages/index.ts` so the server can import `translator` without pulling React into the Node graph. */
export function createUseT(translator: Translator): () => T {
  return function useT(): T {
    const locale = useLocale()
    return useMemo<T>(() => (key, params) => translator(locale, key, params), [locale])
  }
}
