import { createUseT } from "@miragon/pulse-ui"
import { historyDe } from "./history-de.js"
import { historyEn, type HistoryWordKey } from "./history-en.js"
import { translatorOf } from "./message.js"

/** The words of the history notice, by locale tag. */
const historyTranslate = translatorOf<HistoryWordKey>({ en: historyEn, de: historyDe })

/** A hook over pulse-ui's locale: the history notice words itself in English or German. */
export const useHistoryWords: () => (
  key: HistoryWordKey,
  params?: Readonly<Record<string, unknown>>,
) => string = createUseT(historyTranslate)
