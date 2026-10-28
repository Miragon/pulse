import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { TOOLKIT_MESSAGES } from "@miragon/mcp-toolkit-ui"
import {
  catalogTextFindings,
  glossaryFindings,
  PRODUCT_GLOSSARY,
  scanColors,
  scanGlyphs,
  scanIconSizes,
  scanTypeScale,
} from "../testing/index.js"
import { ASK_AI_PROMPT_LABELS } from "./ask-ai-prompt.js"
import { DEFAULT_HEATMAP_LABELS } from "./bpmn-heatmap-labels.js"
import { ERROR_KINDS } from "./describe-error.js"
import { ERROR_LABELS, type ErrorLabels, type ErrorSource } from "./error-labels.js"
import { KIT_LABELS } from "./kit-labels.js"
import { SETTINGS_LABELS } from "./settings-labels.js"
import { SHELL_SETTINGS_CATALOGS } from "../shell-settings.js"

/** Every source the words branch on, with a key for the rendered entry. */
const ERROR_SOURCES: ReadonlyArray<[key: string, source: ErrorSource]> = [
  ["engineWithId", { type: "engine", id: "prod" }],
  ["engine", { type: "engine" }],
  ["prometheus", { type: "prometheus" }],
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
  it.each(["de", "en"] as const)("%s: the engine, Prometheus and fallback branches differ", (l) => {
    const words = ERROR_WORDS[l]
    const hints = ["engine", "prometheus", "unknown"].map((s) => words[`unreachable.hint.${s}`])
    expect(new Set(hints).size).toBe(3)
    const subjects = ERROR_SOURCES.map(([key]) => words[`source.${key}`])
    expect(new Set(subjects).size).toBe(4)
    expect(words["source.engineWithId"]).toContain("prod")
  })
})

/** brand-lint reads Markdown only, not strings in `.ts`/`.tsx`. */
describe("kit copy follows the voice rules", () => {
  it.each([
    ["kit labels (de)", KIT_LABELS.de, "de"],
    ["kit labels (en)", KIT_LABELS.en, "en"],
    // The view chrome every view shows is the toolkit's own catalog now.
    ["view chrome (toolkit, de)", TOOLKIT_MESSAGES.de.view, "de"],
    ["view chrome (toolkit, en)", TOOLKIT_MESSAGES.en.view, "en"],
    ["hand-off fence (de)", ASK_AI_PROMPT_LABELS.de, "de"],
    ["hand-off fence (en)", ASK_AI_PROMPT_LABELS.en, "en"],
    ["heatmap defaults (en)", DEFAULT_HEATMAP_LABELS, "en"],
    ["error words (de)", ERROR_WORDS.de, "de"],
    ["error words (en)", ERROR_WORDS.en, "en"],
    ["settings page (de)", SETTINGS_LABELS.de, "de"],
    ["settings page (en)", SETTINGS_LABELS.en, "en"],
    ["settings summaries (de)", SHELL_SETTINGS_CATALOGS.de, "de"],
    ["settings summaries (en)", SHELL_SETTINGS_CATALOGS.en, "en"],
  ] as const)("%s", (_, catalog, language) => {
    expect(catalogTextFindings(catalog, { language })).toEqual([])
  })
})

const UI_DIR = fileURLToPath(new URL(".", import.meta.url))

describe("kit widget code draws icons with Lucide, never glyphs or emoji", () => {
  it("src/ui has no forbidden glyph in JSX or strings", () => {
    expect(scanGlyphs(UI_DIR)).toEqual([])
  })
})

describe("kit widget code draws icons at the CI sizes", () => {
  it("src/ui has no icon at a size other than 16 or 24 px", () => {
    expect(scanIconSizes(UI_DIR)).toEqual([])
  })
})

describe("kit widget code sets text on the type scale", () => {
  it("src/ui has no text size off the five steps and nothing below 13 px", () => {
    expect(scanTypeScale(UI_DIR)).toEqual([])
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

  it.each(["de", "en"] as const)("settings page (%s)", (language) => {
    expect(glossaryFindings(SETTINGS_LABELS[language], PRODUCT_GLOSSARY[language])).toEqual([])
  })
})

describe("kit widget code colours through role names only", () => {
  it("src/ui has no palette class or raw colour outside the reasoned allowances", () => {
    // Shrink-only: a file that loses its raw colours fails here until its
    // entry is deleted.
    expect(
      scanColors(UI_DIR, {
        allow: {
          "komet-svg.ts":
            "the CI's Komet icon, vendored byte for byte (modeler-tool-design §11), sha-pinned in brand-mark.test.tsx",
        },
      }),
    ).toEqual([])
  })
})
