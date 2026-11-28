// @ts-check
/**
 * What the hand-written texts say of the Camunda 8 scope, held to what a server of Camunda 8
 * engines alone lists (#694, F76). The generated texts (the module instructions' Camunda 8 line,
 * the refusal ENGINE_DIALECT_NOT_SERVED, the boot's warning) and the table of docs/mcp/camunda8.md
 * name the tools and views themselves, held by the engine module's camunda8-scope.test.ts; every
 * other sentence that states the scope is read here, from the tracked Markdown, the `.env.example`
 * files, the docs site's config, the engine module's texts (its instructions, tool descriptions,
 * refusals, model contexts and UI words), widget-shell's error words and the tools/list goldens.
 * The scope is the goldens' (`tools-c8-admin.json`): the boot lists a tool, feed or cockpit view
 * only where its mark serves a configured engine, so the goldens are every mark at once.
 */
import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import path from "node:path"
import ts from "typescript"
import { REPO_ROOT } from "./source-scan.mjs"

/**
 * @typedef {object} Camunda8Scope what a server of Camunda 8 engines alone lists
 * @property {readonly string[]} views the views `engine_open_cockpit` offers
 * @property {readonly string[]} tools the tools the model sees
 */

/** @typedef {{ at: string, text: string, ui?: boolean }} ScopeText a text and where it stands */

const GOLDENS = "apps/mcp-server/test/__golden__"

/** The tools that list the engines and show the cockpit; any other the model sees reads JSON. */
const SHOWING = ["engine_list_engines", "engine_open_cockpit"]

/** The cockpit's views of no engine: a board and the landing. */
const APP_VIEWS = ["board", "landing"]

/** A clause, or its paragraph, that speaks of Camunda 8 (or another dialect than Camunda 7's). */
const CAMUNDA_8 =
  /Camunda 8|\bc8\b|camunda8|\bcluster|another (?:engine API|dialect)|anderen Dialekts/i

/**
 * A clause that speaks of the chat's cockpit, whose views are the scope's `views`, and not of the
 * server, which reads a cluster beyond them.
 */
const COCKPIT = /\bcockpit|\bhere\b|\bhier\b/i
const SERVER = /\bserver\b/i

/**
 * The phrases that say a Camunda 8 engine is read or shown on boards and nowhere else (never the
 * "only" of "read-only").
 */
const BOARDS_ONLY =
  /(?<![\w-])(?:boards only|only on boards|boards alone|read for boards|boards for Camunda 8|nur auf Boards)\b/i

/** The phrases that say the chat reads it as JSON. */
const AS_JSON = /\b(?:as|als) JSON\b/i

/**
 * @param {string} file a tools/list golden under GOLDENS
 * @returns {{ name: string, title?: string, description?: string, inputSchema?: any, outputSchema?: any, _meta?: any }[]}
 */
const golden = (file) => JSON.parse(readFileSync(path.join(REPO_ROOT, GOLDENS, file), "utf8"))

/** @param {{ _meta?: any }} tool */
function modelSees(tool) {
  const visibility = tool._meta?.ui?.visibility
  return !Array.isArray(visibility) || visibility.includes("model")
}

/** @returns {Camunda8Scope} what a server of Camunda 8 engines alone lists, by its admin golden */
export function goldenScope() {
  const tools = golden("tools-c8-admin.json")
  const cockpit = tools.find(({ name }) => name === "engine_open_cockpit")
  return {
    views: cockpit?.inputSchema?.properties?.view?.enum ?? [],
    tools: tools.filter(modelSees).map(({ name }) => name),
  }
}

/**
 * A clause that says Camunda 8 is on boards alone, and why the scope does not bear it out: in the
 * chat's cockpit (or a view's own word) its views are the board and the landing; of the server, or
 * anywhere else, no tool reads it beyond the cockpit's. Such a clause names Camunda 8 and its
 * subject itself.
 * @param {string} clause
 * @param {boolean} ui whether it is a view's own word
 * @param {Camunda8Scope} scope
 */
function boardsOnlyUnborne(clause, ui, scope) {
  if (!BOARDS_ONLY.test(clause) || !(ui || CAMUNDA_8.test(clause))) return undefined
  if (!scope.views.every((view) => APP_VIEWS.includes(view))) {
    return `the cockpit shows it in ${scope.views.join(", ")}`
  }
  const reading = jsonTools(scope)
  const ofTheCockpit = (ui || COCKPIT.test(clause)) && !SERVER.test(clause)
  if (ofTheCockpit || reading.length === 0) return undefined
  return `${reading.join(" and ")} read it too: name the chat's cockpit, or say so`
}

/** @param {Camunda8Scope} scope the tools the model sees besides those that list and show */
const jsonTools = (scope) => scope.tools.filter((tool) => !SHOWING.includes(tool))

/**
 * Why the scope does not bear `clause` out, if it does not: on boards alone
 * (`boardsOnlyUnborne`), or as JSON, which a tool the model sees besides the cockpit's must read;
 * an "as JSON" clause may name Camunda 8 in its paragraph.
 * @param {string} clause
 * @param {{ unit: string, ui: boolean }} where its paragraph, and whether it is a view's own word
 * @param {Camunda8Scope} scope
 * @returns {string | undefined}
 */
function unborne(clause, { unit, ui }, scope) {
  const onBoards = boardsOnlyUnborne(clause, ui, scope)
  if (onBoards !== undefined) return onBoards
  const json = AS_JSON.test(clause) && (ui || CAMUNDA_8.test(unit))
  return json && jsonTools(scope).length === 0
    ? "no tool the model sees reads it as JSON"
    : undefined
}

/**
 * Every clause of `texts` the scope does not bear out, as "at: clause (why)". A text splits into
 * clauses at a full stop, a semicolon, a question or exclamation mark before a space.
 * @param {readonly ScopeText[]} texts
 * @param {Camunda8Scope} scope
 */
export function scopeFindings(texts, scope) {
  return texts.flatMap(({ at, text, ui = false }) => {
    const unit = text.replace(/\s+/g, " ").trim()
    return unit.split(/(?<=[.;!?])\s+/).flatMap((clause) => {
      const why = unborne(clause, { unit, ui }, scope)
      return why === undefined ? [] : [`${at}: "${clause}" (${why})`]
    })
  })
}

/** A line that starts a list item or a heading: a paragraph of its own. */
const ITEM = /^\s*(?:[-*+]|\d+\.|#+)\s/

/**
 * A Markdown file's paragraphs, list items and table cells, each a text: a sentence runs over its
 * lines, and a row's cells stand apart.
 * @param {string} file
 * @param {string} source
 * @returns {ScopeText[]}
 */
export function markdownTexts(file, source) {
  /** @type {ScopeText[]} */
  const texts = []
  let paragraph = /** @type {string[]} */ ([])
  let start = 0
  const flush = () => {
    if (paragraph.length > 0) texts.push({ at: `${file}:${start}`, text: paragraph.join(" ") })
    paragraph = []
  }
  source.split("\n").forEach((line, index) => {
    if (line.trim() === "" || line.startsWith("|") || ITEM.test(line)) flush()
    if (line.startsWith("|")) {
      const cells = line.split("|").slice(1, -1)
      texts.push(...cells.map((text) => ({ at: `${file}:${index + 1}`, text })))
    } else if (line.trim() !== "") {
      if (paragraph.length === 0) start = index + 1
      paragraph.push(line)
    }
  })
  flush()
  return texts
}

/**
 * An `.env.example` file's comments, each run of comment lines a text.
 * @param {string} file
 * @param {string} source
 */
export function envExampleTexts(file, source) {
  const comments = source.split("\n").map((line) => /^\s*#\s?(.*)$/.exec(line)?.[1])
  return markdownTexts(file, comments.map((line) => line ?? "").join("\n"))
}

/**
 * The text of a string or template literal, a template's substitutions as "…".
 * @param {ts.Node} node
 */
function literalText(node) {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text
  if (ts.isTemplateExpression(node)) {
    return node.head.text + node.templateSpans.map((span) => `…${span.literal.text}`).join("")
  }
  return undefined
}

/**
 * The parts a `+` chain joins, a part that is no literal as "…".
 * @param {ts.Expression} node
 * @returns {string}
 */
function joined(node) {
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    return joined(node.left) + joined(node.right)
  }
  if (ts.isParenthesizedExpression(node)) return joined(node.expression)
  return literalText(node) ?? "…"
}

/**
 * A TypeScript file's texts: each string or template literal, a `+` chain of them as one.
 * @param {string} file
 * @param {string} source
 * @param {boolean} [ui] whether its words are a view's own
 * @returns {ScopeText[]}
 */
export function sourceTexts(file, source, ui = false) {
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true)
  /** @type {ScopeText[]} */
  const texts = []
  /** @param {ts.Node} node */
  const visit = (node) => {
    const chain = ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken
    const text = chain ? joined(node) : literalText(node)
    if (text !== undefined && text !== "…") {
      const { line } = tree.getLineAndCharacterOfPosition(node.getStart())
      texts.push({ at: `${file}:${line + 1}`, text, ...(ui ? { ui } : {}) })
      if (chain) return
    }
    ts.forEachChild(node, visit)
  }
  visit(tree)
  return texts
}

/**
 * The model-visible texts of the tools/list goldens of a server beside and of Camunda 8 engines
 * alone: each tool's title and description and every description in its schemas.
 */
export function goldenTexts() {
  const goldens = ["read-only", "operations", "admin"].flatMap((toolset) => [
    `tools-c8-${toolset}.json`,
    `tools-mixed-${toolset}.json`,
  ])
  return goldens.flatMap((file) =>
    golden(file)
      .filter(modelSees)
      .flatMap((tool) =>
        [tool.title, tool.description, ...descriptionsIn([tool.inputSchema, tool.outputSchema])]
          .filter((text) => typeof text === "string")
          .map((text) => ({ at: `${GOLDENS}/${file} ${tool.name}`, text })),
      ),
  )
}

/**
 * Every `description` string under `value`.
 * @param {unknown} value
 * @returns {string[]}
 */
function descriptionsIn(value) {
  if (Array.isArray(value)) return value.flatMap(descriptionsIn)
  if (value === null || typeof value !== "object") return []
  return Object.entries(value).flatMap(([key, inner]) =>
    key === "description" && typeof inner === "string" ? [inner] : descriptionsIn(inner),
  )
}

/** The engine module's sources but tests; its catalogs hold its views' words. */
const MODULE_SOURCE = /^packages\/connectors\/engine\/engine-connector\/src\/.*\.tsx?$/
const TEST_CODE = /\.test\.tsx?$|\.test-support\.tsx?$|\/test-support\//
const VIEW_WORDS = [
  /^packages\/connectors\/engine\/engine-connector\/src\/messages\//,
  /^packages\/core\/widget-shell\/src\/ui\/error-labels\.ts$/,
]

/**
 * Every tracked text that may state the scope, but the changelogs (release history, written by
 * the release train) and the files `skip` names.
 * @param {readonly string[]} [skip]
 * @returns {ScopeText[]}
 */
export function trackedTexts(skip = []) {
  const files = execFileSync("git", ["ls-files", "-z"], { cwd: REPO_ROOT, encoding: "utf8" })
    .split("\0")
    .filter((file) => file !== "" && !skip.includes(file) && !/(?:^|\/)CHANGELOG\.md$/.test(file))
  const read = (/** @type {string} */ file) => readFileSync(path.join(REPO_ROOT, file), "utf8")
  return files.flatMap((file) => {
    if (file.endsWith(".md")) return markdownTexts(file, read(file))
    if (/(?:^|\/)\.env\.example$/.test(file)) return envExampleTexts(file, read(file))
    const ui = VIEW_WORDS.some((pattern) => pattern.test(file))
    const scanned = ui || file === "docs/.vitepress/config.ts"
    if (!scanned && !(MODULE_SOURCE.test(file) && !TEST_CODE.test(file))) return []
    return sourceTexts(file, read(file), ui)
  })
}
