/**
 * brand-lint reads Markdown, not strings in `.ts`, so every catalog runs this in its own
 * test. Function entries render with every parameter as 1 (and 2), so "1 incidents"
 * surfaces. Formal address counts at a sentence start too, where a UI catalog puts it;
 * a sentence-initial "Ihre" about an instance takes an `allow` entry.
 */

export type CatalogLanguage = "de" | "en"

export type CatalogRule =
  | "dash-connector"
  | "ki"
  | "cib-seven"
  | "formal-address"
  | "impersonal-man"
  | "plural"
  | "render-error"
  | "unused-allowance"

export interface CatalogTextFinding {
  key: string
  rule: CatalogRule
  text: string
}

export interface CatalogAllowance {
  key: string
  rule: CatalogRule
  reason: string
}

export interface CatalogTextOptions {
  language: CatalogLanguage
  /** For entries that need real shapes instead of the default "every parameter is n". */
  params?: Readonly<Record<string, unknown>>
  /** Shrink-only: an allowance that matches nothing comes back as `unused-allowance`. */
  allow?: readonly CatalogAllowance[]
}

/** A stand-in parameter object: every property and its own primitive value is `n`. */
function sampleParams(n: number): unknown {
  return new Proxy(Object.create(null) as object, {
    get: (_target, prop) => {
      if (prop === Symbol.toPrimitive) return (hint: string) => (hint === "number" ? n : String(n))
      if (prop === "toString" || prop === "valueOf") return () => String(n)
      return n
    },
  })
}

function render(value: unknown, n: number, params: unknown): string | undefined {
  if (typeof value === "string") return value.replace(/\{\w+\}/g, String(n))
  if (typeof value === "function") {
    const out: unknown = (value as (p: unknown) => unknown)(params ?? sampleParams(n))
    return typeof out === "string" ? out : undefined
  }
  return undefined
}

const SIE = /(?<![\p{L}\p{N}_])(Sie|Ihnen|Ihr|Ihre|Ihren|Ihrem|Ihrer|Ihres)(?![\p{L}\p{N}_])/gu

function atSentenceStart(text: string, pos: number): boolean {
  const before = text.slice(0, pos).replace(/[\s*_([„"'«]+$/u, "")
  return before === "" || /[.!?:…\n]$/.test(before)
}

/** A plural, i.e. formal, verb form right after "Sie": haben, können, sind, ändern, tun … */
const PLURAL_VERB = /^\s+(?:sind|tun|[a-zäöüß]+(?:en|eln|ern))(?![\p{L}\p{N}_])/u

/** The team's "ihr" (brand-tone allows it): the ihr-form of a verb follows (habt, könnt, seid). */
const IHR_VERB = /^\s+(?:seid|[a-zäöüß]+t)(?![\p{L}\p{N}_])/u

/** At a sentence start, "Sie" counts only before a plural verb and "Ihr" unless an ihr-form verb follows. */
function isFormalAddress(text: string, match: RegExpExecArray): boolean {
  if (!atSentenceStart(text, match.index)) return true
  const rest = text.slice(match.index + match[0].length)
  if (match[0] === "Sie") return PLURAL_VERB.test(rest)
  if (match[0] === "Ihr") return !IHR_VERB.test(rest)
  return true
}

const EN_PLURAL_AFTER_ONE = /(?<![\d.,])\b1\s+([a-z]+s)\b/g
const EN_NOT_PLURAL = /(ss|us|is|ics|news)$|^(has|was|does|its|this|yes|plus|always)$/

const DE_PLURAL_AFTER_ONE =
  /(?<![\d.,])\b1\s+(Incidents|Instanzen|Engines|Jobs|Prozesse|Prozessdefinitionen|Definitionen|Versionen|Tage|Stunden|Minuten|Sekunden|Wochen|Versuche|Einträge|Aufgaben|Tasks|Variablen|Elemente|Aktivitäten|Umgebungen|Deployments)\b/u

type Check = (text: string, language: CatalogLanguage) => CatalogRule[]

const checks: Check[] = [
  // A2: no em dash as a connector; a bare "—" (the empty-value placeholder) is fine.
  (text) =>
    (text.trim() !== "—" && text.includes("—")) || / –(?=[\s,;.:!?)]|$)/.test(text)
      ? ["dash-connector"]
      : [],
  // A10: AI, never KI; CIB seven, never CIB Seven.
  (text) => (/(?<![\p{L}])KI(?![\p{L}])/u.test(text) ? ["ki"] : []),
  (text) => (/\bCIB[\s-]*(Seven|SEVEN)\b/.test(text) ? ["cib-seven"] : []),
  // A1: du, never Sie; no impersonal "man".
  (text, language) =>
    language === "de" && [...text.matchAll(SIE)].some((m) => isFormalAddress(text, m))
      ? ["formal-address"]
      : [],
  (text, language) =>
    language === "de" && /(?<![\p{L}])[Mm]an(?![\p{L}])/u.test(text) ? ["impersonal-man"] : [],
]

function pluralFindings(one: string, language: CatalogLanguage): boolean {
  if (language === "de") return DE_PLURAL_AFTER_ONE.test(one)
  return [...one.matchAll(EN_PLURAL_AFTER_ONE)].some((m) => !EN_NOT_PLURAL.test(m[1]))
}

function entryFindings(
  key: string,
  value: unknown,
  options: CatalogTextOptions,
): CatalogTextFinding[] {
  let one: string | undefined
  let two: string | undefined
  try {
    one = render(value, 1, options.params?.[key])
    two = render(value, 2, options.params?.[key])
  } catch {
    return [{ key, rule: "render-error", text: "pass params for this entry" }]
  }
  if (one === undefined || two === undefined) return []
  const findings = new Set<CatalogRule>()
  for (const text of [one, two]) {
    for (const rule of checks.flatMap((check) => check(text, options.language))) findings.add(rule)
  }
  if (pluralFindings(one, options.language)) findings.add("plural")
  return [...findings].map((rule) => ({ key, rule, text: one }))
}

function walk(catalog: object, options: CatalogTextOptions, prefix: string): CatalogTextFinding[] {
  return Object.entries(catalog as Record<string, unknown>).flatMap(([name, value]) => {
    const key = prefix + name
    if (value !== null && typeof value === "object") return walk(value, options, `${key}.`)
    return entryFindings(key, value, options)
  })
}

const allows = (allowance: CatalogAllowance, finding: CatalogTextFinding) =>
  allowance.key === finding.key && allowance.rule === finding.rule

export function catalogTextFindings(
  catalog: object,
  options: CatalogTextOptions,
): CatalogTextFinding[] {
  const allow = options.allow ?? []
  for (const allowance of allow) {
    if (!allowance.reason.trim()) {
      throw new Error(`The allowance for ${allowance.key} (${allowance.rule}) needs a reason`)
    }
  }
  const findings = walk(catalog, options, "")
  const unused = allow.filter((allowance) => !findings.some((f) => allows(allowance, f)))
  return [
    ...findings.filter((f) => !allow.some((allowance) => allows(allowance, f))),
    ...unused.map((allowance) => ({
      key: allowance.key,
      rule: "unused-allowance" as const,
      text: `${allowance.rule}: ${allowance.reason}`,
    })),
  ]
}
