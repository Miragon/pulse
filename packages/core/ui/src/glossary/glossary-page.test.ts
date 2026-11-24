import fs from "node:fs"
import { fileURLToPath } from "node:url"
import { format, resolveConfig } from "prettier"
import { describe, expect, it } from "vitest"
import {
  cell,
  GLOSSARY_UPDATE_COMMAND,
  renderGlossaryPage,
  termRows,
} from "./glossary-page.test-support.js"
import { BARE_PAUSE_RULE_EN, COUNT_TERMS, PRODUCT_GLOSSARY, unnamedGlossaryTerms } from "./index.js"

/**
 * docs/glossary.md is generated, never written by hand: this test renders it from the glossary's
 * data, formats it with the repository's Prettier config and holds the committed page to that, so
 * a word the gate changes reaches the docs (and the skill that links the page) in the same PR.
 * `GOLDEN_UPDATE=1` (the `golden:update` script, refused in CI like every golden) rewrites it.
 * The page lies outside the package: packages/core/ui/turbo.json names it among this task's
 * inputs and scripts/ci-scopes.mjs runs this job when it changes.
 */
const PAGE_FILE = "docs/glossary.md"
const PAGE_PATH = fileURLToPath(new URL(`../../../../../${PAGE_FILE}`, import.meta.url))

async function page(): Promise<string> {
  const config = (await resolveConfig(PAGE_PATH)) ?? {}
  return format(renderGlossaryPage(), { ...config, filepath: PAGE_PATH })
}

describe(PAGE_FILE, () => {
  it("is the glossary's data as rendered", async () => {
    const rendered = await page()
    if (process.env.GOLDEN_UPDATE === "1") {
      if (process.env.CI) {
        throw new Error(
          `GOLDEN_UPDATE is forbidden in CI: ${PAGE_FILE} changes in a reviewed diff.`,
        )
      }
      fs.writeFileSync(PAGE_PATH, rendered, "utf8")
      console.warn(`GOLDEN UPDATED: ${PAGE_FILE}. Commit the diff.`)
      return
    }
    const committed = fs.existsSync(PAGE_PATH) ? fs.readFileSync(PAGE_PATH, "utf8") : ""
    expect(
      committed,
      `${PAGE_FILE} differs from @miragon/pulse-ui/glossary. Never edit it by hand: run \`${GLOSSARY_UPDATE_COMMAND}\` and commit the diff.`,
    ).toBe(rendered)
  })

  it("names every term, every word it replaces and every count word", () => {
    const doc = renderGlossaryPage()
    const rules = [...PRODUCT_GLOSSARY.de, ...PRODUCT_GLOSSARY.en, BARE_PAUSE_RULE_EN]
    expect(unnamedGlossaryTerms(doc, rules)).toEqual([])
    for (const word of rules.flatMap((rule) => rule.replaces)) expect(doc).toContain(word)
    for (const term of Object.values(COUNT_TERMS)) {
      for (const word of [term.en, term.de, term.counts]) expect(doc).toContain(word)
    }
    expect(doc).toContain(`${COUNT_TERMS.incidents.long.en}, ${COUNT_TERMS.incidents.long.de}`)
  })

  it("gives a term one row, the words and notes of its rules joined", () => {
    const rows = termRows([
      { pattern: /a/, use: "Incident", probe: "a", replaces: ["Vorfall"], note: "One." },
      { pattern: /b/, use: "Incident", probe: "b", replaces: ["Störung"], note: "One." },
      { pattern: /c/, use: "läuft", probe: "c" },
    ])
    expect(rows).toEqual([
      { use: "Incident", replaces: ["Vorfall", "Störung"], notes: ["One."] },
      { use: "läuft", replaces: [], notes: [] },
    ])
  })

  it("keeps a pipe inside its cell", () => {
    expect(cell("a | b")).toBe("a \\| b")
  })
})
