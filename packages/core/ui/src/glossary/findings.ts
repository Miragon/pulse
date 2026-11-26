import { renderedTexts } from "./catalog.js"
import type { GlossaryRule } from "./rules.js"

export interface GlossaryFinding {
  key: string
  text: string
  /** The glossary term to write instead. */
  use: string
}

/**
 * The texts of `catalog` that use a word `rules` replace, each with the term to write instead.
 * A catalog is any object of strings, functions (rendered with stand-in parameters) and nested
 * objects, so a page checks its own messages with it, in a browser too. Also reports exceptions
 * that no longer spare a real use (shrink-only).
 */
export function glossaryFindings(
  catalog: object,
  rules: readonly GlossaryRule[],
): GlossaryFinding[] {
  const texts = renderedTexts(catalog)
  const findings = new Map<string, GlossaryFinding>()
  for (const rule of rules) {
    for (const [key, text] of texts) {
      if (rule.except && key in rule.except) continue
      if (rule.pattern.test(text))
        findings.set(`${key}\u0000${rule.use}`, { key, text, use: rule.use })
    }
    for (const [key, reason] of Object.entries(rule.except ?? {})) {
      const spared = texts.some(([k, text]) => k === key && rule.pattern.test(text))
      if (!spared)
        findings.set(`${key}\u0000except`, { key, text: reason, use: "unused exception" })
    }
  }
  return [...findings.values()]
}

/**
 * The probes and the replaced words `rules` do not catch: a rule whose pattern misses its own
 * probe guards nothing, and one that misses a word it says it replaces lists a word the gate lets
 * through.
 */
export function blindGlossaryRules(rules: readonly GlossaryRule[]): string[] {
  return rules.flatMap((rule) =>
    [rule.probe, ...(rule.replaces ?? [])].filter((text) => !rule.pattern.test(text)),
  )
}

/** Glossary words a glossary document does not name, so the document and the gate cannot drift apart. */
export function unnamedGlossaryTerms(doc: string, rules: readonly GlossaryRule[]): string[] {
  const terms = new Set(rules.flatMap((rule) => rule.use.split(", ")))
  return [...terms].filter((term) => !doc.includes(term))
}
