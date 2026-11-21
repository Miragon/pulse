import { createUseT } from "@miragon/pulse-ui"
import { findDe } from "./find-de.js"
import { findEn, type FindWordKey } from "./find-en.js"
import { translatorOf } from "./message.js"

/** The search's words, by locale tag. */
const findTranslate = translatorOf<FindWordKey>({ en: findEn, de: findDe })

/** A hook over pulse-ui's locale: the search words itself in English or German. */
export const useFindWords: () => (
  key: FindWordKey,
  params?: Readonly<Record<string, unknown>>,
) => string = createUseT(findTranslate)
