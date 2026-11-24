import type { GlossaryLanguage } from "./catalog.js"
import { COUNT_TERMS, type CountTerm } from "./count-terms.js"
import { BARE_PAUSE_RULE_EN, PRODUCT_GLOSSARY, type GlossaryRule } from "./rules.js"

/**
 * The docs page of the product glossary (docs/glossary.md), rendered from the data of this
 * entry, so the table the docs, the skill and an agent read is the table the gate holds. The page
 * test formats it with the repository's Prettier config and holds the committed page to it;
 * `golden:update` rewrites it.
 */

export const GLOSSARY_UPDATE_COMMAND =
  "pnpm --fail-if-no-match --filter @miragon/pulse-ui golden:update"

/** One row per term: the rules that write the same word are one row, their words and notes joined. */
export interface TermRow {
  use: string
  replaces: string[]
  notes: string[]
}

export function termRows(rules: readonly GlossaryRule[]): TermRow[] {
  const rows = new Map<string, TermRow>()
  for (const rule of rules) {
    const row = rows.get(rule.use) ?? { use: rule.use, replaces: [], notes: [] }
    row.replaces.push(...(rule.replaces ?? []))
    if (rule.note !== undefined && !row.notes.includes(rule.note)) row.notes.push(rule.note)
    rows.set(rule.use, row)
  }
  return [...rows.values()]
}

/** A table cell: a pipe would end it, and a backslash would escape what follows it. */
export function cell(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/\|/g, "\\|")
}

/** A paragraph in lines of at most `width` characters, as the repository's prose is wrapped. */
function paragraph(text: string, width = 100): string[] {
  const lines: string[] = []
  let line = ""
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (line !== "" && line.length + 1 + word.length > width) {
      lines.push(line)
      line = word
    } else {
      line = line === "" ? word : `${line} ${word}`
    }
  }
  return line === "" ? lines : [...lines, line]
}

function table(head: readonly string[], rows: readonly (readonly string[])[]): string[] {
  const line = (cells: readonly string[]) => `| ${cells.map(cell).join(" | ")} |`
  return [line(head), line(head.map(() => "---")), ...rows.map(line)]
}

function termTable(rules: readonly GlossaryRule[]): string[] {
  return table(
    ["Write", "Instead of", "Note"],
    termRows(rules).map((row) => [row.use, row.replaces.join(", "), row.notes.join(" ")]),
  )
}

const LANGUAGES: readonly (readonly [GlossaryLanguage, string])[] = [
  ["en", "English"],
  ["de", "German"],
]

function countRow(key: string, term: CountTerm): string[] {
  const long = term.long === undefined ? "" : `${term.long.en}, ${term.long.de}`
  return [`\`${key}\``, term.en, term.de, long, term.counts]
}

/** The strict pause rule is no product rule: its own table, under the English one. */
function barePause(): string[] {
  return [
    ...paragraph(
      "A UI that pauses nothing of its own, such as a page on the kit, runs " +
        "`BARE_PAUSE_RULE_EN` beside the English rules:",
    ),
    "",
    ...termTable([BARE_PAUSE_RULE_EN]),
    "",
  ]
}

export function renderGlossaryPage(): string {
  const languages = LANGUAGES.flatMap(([language, name]) => [
    `## ${name}`,
    "",
    ...termTable(PRODUCT_GLOSSARY[language]),
    "",
    ...(language === "en" ? barePause() : []),
  ])
  return [
    `<!-- Generated from @miragon/pulse-ui/glossary by packages/core/ui/src/glossary/glossary-page.test-support.ts. Do not edit: run ${GLOSSARY_UPDATE_COMMAND}. -->`,
    "",
    "# Glossary",
    "",
    ...paragraph(
      "Every Pulse UI says one thing with one word: the MCP cockpit, the web app, Pulse for VS " +
        "Code, Pulse for Orca and a page you build on `@miragon/pulse-ui`. The words are data in " +
        "`@miragon/pulse-ui/glossary`, which needs no peer and runs in a browser as it is, and " +
        "this page is generated from it. Each term says what to write, the words it replaces and " +
        "where the rule stops; a term's forms are separated by commas.",
    ),
    "",
    "```ts",
    'import { COUNT_TERMS, glossaryFindings, PRODUCT_GLOSSARY } from "@miragon/pulse-ui/glossary"',
    "",
    "// Each text of your catalog that uses a replaced word, with the term to write instead",
    "const findings = glossaryFindings(messages.de, PRODUCT_GLOSSARY.de)",
    "```",
    "",
    ...paragraph(
      "The rules and their patterns live in `packages/core/ui/src/glossary/rules.ts`; every " +
        "Pulse UI runs them over its catalogs in its tests.",
    ),
    "",
    ...languages,
    "## Count words",
    "",
    ...paragraph(
      "One word per count, and a word never names two counts. A count's header names its " +
        `version scope: "${COUNT_TERMS.allVersions.en}" for every version of a process, the ` +
        "version itself (v3) for one. The long form stands on a label away from the thing it " +
        "counts, such as a key figure.",
    ),
    "",
    ...table(
      ["Count", "English", "German", "Long form", "What it counts"],
      Object.entries(COUNT_TERMS).map(([key, term]) => countRow(key, term)),
    ),
    "",
  ].join("\n")
}
