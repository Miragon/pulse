import { describe, expect, it } from "vitest"
import {
  BARE_PAUSE_RULE_EN,
  catalogTextFindings,
  glossaryFindings,
  PRODUCT_GLOSSARY,
} from "@miragon/pulse-ui/testing"
import { ASK_AI_PROMPT_LABELS } from "./ask-ai-prompt.js"
import { ERROR_KINDS } from "./describe-error.js"
import { ERROR_LABELS, type ErrorLabels, type ErrorSource } from "./error-labels.js"
import { KIT_LABELS } from "./kit-labels.js"
import { PAGE_HINTS } from "./page-hints.js"

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
function renderedErrorWords(
  labels: ErrorLabels,
  pageHints: (typeof PAGE_HINTS)[keyof typeof PAGE_HINTS],
): Record<string, string> {
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
  // A page's words of what to do, which its host brings in place of a chat's (`page-hints.ts`).
  for (const [kind, hint] of Object.entries(pageHints)) words[`${kind}.pageHint`] = hint
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
  de: renderedErrorWords(ERROR_LABELS.de, PAGE_HINTS.de),
  en: renderedErrorWords(ERROR_LABELS.en, PAGE_HINTS.en),
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

/** A page posts to no chat: its words never send the reader to one. */
describe("the frame's words for a page", () => {
  it.each([
    ["de", /Chat/],
    ["en", /chat/i],
  ] as const)("%s: say to reload the page, never to ask in a chat", (language, chat) => {
    const { pageSlowHint, pageViewMissing, slowHint, viewMissing } = KIT_LABELS[language]
    for (const words of [pageSlowHint, pageViewMissing]) expect(words).not.toMatch(chat)
    for (const words of [slowHint, viewMissing]) expect(words).toMatch(chat)
  })

  it.each([
    ["de", /Chat/],
    ["en", /chat/i],
  ] as const)(
    "%s: the error words for a page never send the reader to a chat",
    (language, chat) => {
      const words: Readonly<Record<string, string | undefined>> = ERROR_WORDS[language]
      // What a page shows: its host's hint where it brings one, else the kind's one hint.
      for (const kind of ERROR_KINDS) {
        for (const source of ["engine", "unknown"]) {
          const text = words[`${kind}.pageHint`] ?? words[`${kind}.hint.${source}`]
          expect(text, `${kind} (${source})`).not.toMatch(chat)
        }
      }
      // The chat's own words do, where a chat is the way out: the page brings its own for each.
      const asksChat = Object.entries(words).filter(
        ([key, text]) => key.includes(".hint.") && chat.test(text ?? ""),
      )
      expect(asksChat.length).toBeGreaterThan(0)
      for (const [key] of asksChat) {
        expect(words[`${String(key.split(".")[0])}.pageHint`], key).toBeDefined()
      }
    },
  )
})

describe("kit copy uses the product glossary", () => {
  // The MCP views pause nothing of their own, so any "pause" here means the engine's suspension.
  const rules = {
    de: PRODUCT_GLOSSARY.de,
    en: [...PRODUCT_GLOSSARY.en, BARE_PAUSE_RULE_EN],
  }

  it("holds the profile refusal's words: the kit words it (profileRefused)", () => {
    expect(PRODUCT_GLOSSARY.de.map((rule) => rule.use)).toContain("abgelehnt")
    expect(PRODUCT_GLOSSARY.en.map((rule) => rule.use)).toContain("refused")
  })

  // The kit's labels sit in every module's views (hand-offs, list chrome).
  it.each(["de", "en"] as const)("kit labels (%s)", (language) => {
    expect(glossaryFindings(KIT_LABELS[language], rules[language])).toEqual([])
  })

  it.each(["de", "en"] as const)("error words (%s)", (language) => {
    expect(glossaryFindings(ERROR_WORDS[language], rules[language])).toEqual([])
  })
})
