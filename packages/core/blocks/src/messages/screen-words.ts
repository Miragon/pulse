import { createUseT } from "@miragon/pulse-ui"
import { screenDe } from "./screen-de.js"
import { screenEn, type ScreenWordKey } from "./screen-en.js"
import { translatorOf } from "./message.js"

/** The words of the screens' blocks in the language of the nearest `LocaleProvider`. */
export type ScreenWords = (key: ScreenWordKey, params?: Readonly<Record<string, unknown>>) => string

/** The words of the screens' blocks, by locale tag. */
export const screenTranslate = translatorOf<ScreenWordKey>({ en: screenEn, de: screenDe })

/** A hook over pulse-ui's locale: the screens' blocks word themselves in English or German. */
export const useScreenWords: () => ScreenWords = createUseT(screenTranslate)
