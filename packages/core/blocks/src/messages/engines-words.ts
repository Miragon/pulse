import { createUseT } from "@miragon/pulse-ui"
import { enginesDe } from "./engines-de.js"
import { enginesEn, type EnginesWordKey } from "./engines-en.js"
import { translatorOf } from "./message.js"

/** The words of the tables across engines, by locale tag. */
const enginesTranslate = translatorOf<EnginesWordKey>({ en: enginesEn, de: enginesDe })

/** A hook over pulse-ui's locale: the tables across engines word themselves in English or German. */
export const useEnginesWords: () => (
  key: EnginesWordKey,
  params?: Readonly<Record<string, unknown>>,
) => string = createUseT(enginesTranslate)
