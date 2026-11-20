import { createUseT } from "@miragon/pulse-ui"
import { de } from "./de.js"
import { en, type WordKey } from "./en.js"
import { translatorOf } from "./message.js"

/** The words of the blocks in the language of the nearest `LocaleProvider`. */
export type Words = (key: WordKey, params?: Readonly<Record<string, unknown>>) => string

/** The words of the board's tiles, by locale tag. */
export const translate = translatorOf<WordKey>({ en, de })

/** A hook over pulse-ui's locale: the tiles word themselves in English or German. */
export const useWords: () => Words = createUseT(translate)
