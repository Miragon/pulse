/** A language the product glossary and the kit's catalogs are written in. */
export type GlossaryLanguage = "de" | "en"

/**
 * A stand-in parameter object: every property and its own primitive value is `n`, so a catalog's
 * function entry renders without its real arguments ("1 incidents" surfaces).
 */
export function sampleParams(n: number): unknown {
  return new Proxy(Object.create(null) as object, {
    get: (_target, prop) => {
      if (prop === Symbol.toPrimitive) return (hint: string) => (hint === "number" ? n : String(n))
      if (prop === "toString" || prop === "valueOf") return () => String(n)
      return n
    },
  })
}

/** Undefined when the entry needs a real shape (the catalog text test reports that). */
function renderWith(value: (p: unknown) => unknown, n: number): string | undefined {
  try {
    const text = value(sampleParams(n))
    return typeof text === "string" ? text : undefined
  } catch {
    return undefined
  }
}

/**
 * Every text of a catalog, keyed by its dotted path. Functions render with 1 and 2 (both forms of
 * a counted entry); `{placeholder}` names are code and drop out.
 */
export function renderedTexts(catalog: object, prefix = ""): [key: string, text: string][] {
  return Object.entries(catalog as Record<string, unknown>).flatMap(
    ([name, value]): [string, string][] => {
      const key = prefix + name
      if (typeof value === "string") return [[key, value.replace(/\{\w+\}/g, "")]]
      if (typeof value === "function") {
        return [1, 2]
          .map((n) => renderWith(value as (p: unknown) => unknown, n))
          .filter((text): text is string => text !== undefined)
          .map((text) => [key, text])
      }
      if (value !== null && typeof value === "object") return renderedTexts(value, `${key}.`)
      return []
    },
  )
}
