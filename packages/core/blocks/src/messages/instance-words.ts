import { createUseT } from "@miragon/pulse-ui"
import { instanceDe } from "./instance-de.js"
import { instanceEn, type InstanceWordKey } from "./instance-en.js"
import { translatorOf } from "./message.js"

/** The words of an instance's blocks in the language of the nearest `LocaleProvider`. */
export type InstanceWords = (
  key: InstanceWordKey,
  params?: Readonly<Record<string, unknown>>,
) => string

/** The words of an instance's blocks, by locale tag. */
export const instanceTranslate = translatorOf<InstanceWordKey>({ en: instanceEn, de: instanceDe })

/** A hook over pulse-ui's locale: an instance's blocks word themselves in English or German. */
export const useInstanceWords: () => InstanceWords = createUseT(instanceTranslate)
