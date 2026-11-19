import { createUseT } from "@miragon/pulse-ui"
import { de } from "./de.js"
import { en, type Message, type WordKey } from "./en.js"

/** The words of the blocks in the language of the nearest `LocaleProvider`. */
export type Words = (key: WordKey, params?: Readonly<Record<string, unknown>>) => string

const CATALOGS: Readonly<Record<"en" | "de", Readonly<Record<WordKey, Message>>>> = { en, de }

/** German for a German locale tag (`de`, `de-DE`), English for every other. */
function catalogOf(locale: string): Readonly<Record<WordKey, Message>> {
  return locale.toLowerCase().split("-")[0] === "de" ? CATALOGS.de : CATALOGS.en
}

/** Fills a message's `{name}` placeholders, or calls a message that is a function of its values. */
export function translate(locale: string, key: string, params: Record<string, unknown> = {}) {
  const message = catalogOf(locale)[key as WordKey]
  if (typeof message === "function") return message(params)
  return message.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in params ? String(params[name]) : whole,
  )
}

/** A hook over pulse-ui's locale: the blocks word themselves in English or German. */
export const useWords: () => Words = createUseT(translate)
