import { createUseT } from "@miragon/pulse-ui"
import { translatorOf } from "./message.js"
import { outsideDe } from "./outside-de.js"
import { outsideEn, type OutsideWordKey } from "./outside-en.js"

/** The words of the line outside any process, by locale tag. */
export const outsideTranslate = translatorOf<OutsideWordKey>({ en: outsideEn, de: outsideDe })

/** A hook over pulse-ui's locale: the line outside any process words itself in English or German. */
export const useOutsideWords: () => (
  key: OutsideWordKey,
  params?: Readonly<Record<string, unknown>>,
) => string = createUseT(outsideTranslate)
