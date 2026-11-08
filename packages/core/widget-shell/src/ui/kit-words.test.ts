import { describe, expect, it } from "vitest"
import { catalogTextFindings } from "@miragon/pulse-ui/testing"
import { glossaryFindings, PRODUCT_GLOSSARY } from "../testing/index.js"
import { ASK_AI_PROMPT_LABELS } from "./ask-ai-prompt.js"
import { ERROR_KINDS } from "./describe-error.js"
import { ERROR_LABELS, type ErrorLabels, type ErrorSource } from "./error-labels.js"
import { KIT_LABELS } from "./kit-labels.js"

// The kit's words: the catalog text and glossary half of the brand gates, next to the catalogs
// it reads. The scans of the kit's code read sources from disk, which the browser-only
// tsconfig.widgets.json does not type: ../brand-gates.test.ts.

/** Every source the words branch on, with a key for the rendered entry. */
const ERROR_SOURCES: ReadonlyArray<[key: string, source: ErrorSource]> = [
  ["engineWithId", { type: "engine", id: "prod" }],
  ["engine", { type: "engine" }],
  ["unknown", { type: "unknown" }],
]

/** The gates' sample parameters (every property 1) would only reach the fallback branch, so every branch is rendered here. */
function renderedErrorWords(labels: ErrorLabels): Record<string, string> {
  const status = labels.status({ status: 503 })
  const words: Record<string, string> = { status }
  for (const [key, source] of ERROR_SOURCES) {
    const subject = labels.source({ source })
    words[`source.${key}`] = subject
    for (const kind of ERROR_KINDS) {
      words[`${kind}.title.${key}`] = labels[kind].title({ source: subject, status })
      words[`${kind}.hint.${source.type}`] = labels[kind].hint({ source: source.type })
    }
  }
  const title = labels.failed.title({
    source: labels.source({ source: ERROR_SOURCES[0][1] }),
    status,
  })
  words["toast.reason"] = labels.toast.reason({ title, reason: "Cannot resolve incident." })
  words["toast.failedHint"] = labels.toast.failedHint()
  words["toast.mayHaveApplied"] = labels.toast.mayHaveApplied()
  return words
}

const ERROR_WORDS = {
  de: renderedErrorWords(ERROR_LABELS.de),
  en: renderedErrorWords(ERROR_LABELS.en),
}

describe("the error words are rendered branch by branch", () => {
  it.each(["de", "en"] as const)("%s: the engine and fallback branches differ", (l) => {
    const words = ERROR_WORDS[l]
    const hints = ["engine", "unknown"].map((s) => words[`unreachable.hint.${s}`])
    expect(new Set(hints).size).toBe(2)
    const subjects = ERROR_SOURCES.map(([key]) => words[`source.${key}`])
    expect(new Set(subjects).size).toBe(3)
    expect(words["source.engineWithId"]).toContain("prod")
  })
})

/** brand-lint reads Markdown only, not strings in `.ts`/`.tsx`. */
describe("kit copy follows the voice rules", () => {
  it.each([
    ["kit labels (de)", KIT_LABELS.de, "de"],
    ["kit labels (en)", KIT_LABELS.en, "en"],
    ["hand-off fence (de)", ASK_AI_PROMPT_LABELS.de, "de"],
    ["hand-off fence (en)", ASK_AI_PROMPT_LABELS.en, "en"],
    ["error words (de)", ERROR_WORDS.de, "de"],
    ["error words (en)", ERROR_WORDS.en, "en"],
  ] as const)("%s", (_, catalog, language) => {
    expect(catalogTextFindings(catalog, { language })).toEqual([])
  })
})

describe("kit copy uses the product glossary", () => {
  // The kit's labels sit in every module's views (hand-offs, list chrome).
  it.each(["de", "en"] as const)("kit labels (%s)", (language) => {
    expect(glossaryFindings(KIT_LABELS[language], PRODUCT_GLOSSARY[language])).toEqual([])
  })

  it.each(["de", "en"] as const)("error words (%s)", (language) => {
    expect(glossaryFindings(ERROR_WORDS[language], PRODUCT_GLOSSARY[language])).toEqual([])
  })
})
