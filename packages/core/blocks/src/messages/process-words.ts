import { createUseT } from "@miragon/pulse-ui"
import { translatorOf } from "./message.js"
import { processDe } from "./process-de.js"
import { processEn, type ProcessWordKey } from "./process-en.js"

/** The words of a process's blocks in the language of the nearest `LocaleProvider`. */
export type ProcessWords = (
  key: ProcessWordKey,
  params?: Readonly<Record<string, unknown>>,
) => string

/** The words of a process's blocks, by locale tag. */
export const processTranslate = translatorOf<ProcessWordKey>({ en: processEn, de: processDe })

/** A hook over pulse-ui's locale: a process's blocks word themselves in English or German. */
export const useProcessWords: () => ProcessWords = createUseT(processTranslate)
