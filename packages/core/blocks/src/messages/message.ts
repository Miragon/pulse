/** A text with `{name}` placeholders, or a function of the values (plurals, conditions). */
export type Message = string | ((params: Readonly<Record<string, unknown>>) => string)

/** A count reaches an entry formatted ("1,234"), so one is decided on its text: exactly "1". */
export function isOne(count: unknown): boolean {
  return String(count) === "1"
}

/** The count and its noun in the right number: "1 engine", "2 engines". */
export function countOf(count: unknown, one: string, other: string): string {
  return `${String(count)} ${isOne(count) ? one : other}`
}

/** A catalog of the blocks in each language they speak, the same keys in both. */
type Catalogs<Key extends string> = Readonly<Record<"en" | "de", Readonly<Record<Key, Message>>>>

/**
 * A translator over catalogs: German for a German locale tag (`de`, `de-DE`), English for every
 * other; it fills a message's `{name}` placeholders, or calls a message that is a function of its
 * values. The board's tiles and the screens' blocks each keep a catalog of their own, so a surface
 * that renders only one of them bundles only its words.
 */
export function translatorOf<Key extends string>(catalogs: Catalogs<Key>) {
  return (locale: string, key: string, params: Record<string, unknown> = {}): string => {
    const catalog = locale.toLowerCase().split("-")[0] === "de" ? catalogs.de : catalogs.en
    const message = catalog[key as Key]
    if (typeof message === "function") return message(params)
    return message.replace(/\{(\w+)\}/g, (whole, name: string) =>
      name in params ? String(params[name]) : whole,
    )
  }
}

/**
 * An engine's code in words, for a code no catalog names: `failedJob` and `JOB_NO_RETRIES` read
 * "Failed job" and "Job no retries", the editors' words for an incident's type.
 */
export function humanized(code: string): string {
  const words = code
    .replace(/[_-]+/g, " ")
    .replace(/([a-z\d])([A-Z])/g, "$1 $2")
    .trim()
    .toLowerCase()
  return words.charAt(0).toUpperCase() + words.slice(1)
}
