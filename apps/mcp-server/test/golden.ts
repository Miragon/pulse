import fs from "node:fs"
import path from "node:path"
import { expect } from "vitest"

/**
 * Golden-contract helper (ported from mcp-toolkit's examples/test/helpers/golden.ts).
 *
 * Deliberately NOT vitest snapshots: `vitest -u` would be a one-command
 * bypass an agent reaches for reflexively. Plain JSON + toEqual makes
 * `vitest -u` a no-op: the ONLY update path is an explicit
 * `GOLDEN_UPDATE=1` run, which is refused in CI, so every golden change is a
 * reviewable JSON diff in the PR. UPDATE_COMMAND is that run: the app reads
 * the connectors from their dist, so it builds them first (a bare
 * `vitest run` would write the goldens from their last build), and it turns
 * coverage off, since it is no gate: `pnpm test` measures the suite.
 *
 * Next to each golden sits a CHARACTER BUDGET (`__golden__/char-budgets.json`):
 * the size of the text a model reads from that toolset: its model-visible
 * tools/list entries plus the server instructions, measured on the golden's
 * single-engine boot (a fleet adds its engine ids to every `engine`
 * enum and to the routing line, which no budget shows). The test pins it
 * exactly; scripts/check-ratchets.mjs (`pnpm lint`) makes it shrink-only
 * against the merge base, so the LLM-facing surface cannot grow without a
 * reviewed `Ratchet-Exception:` commit trailer.
 */

export const GOLDEN_DIR = path.join(import.meta.dirname, "__golden__")
const BUDGETS_FILE = "char-budgets.json"

export const UPDATE_COMMAND =
  "pnpm --fail-if-no-match --filter @miragon/pulse-mcp-server golden:update"

/** The agent-facing instruction attached to every golden assertion. */
export const GOLDEN_HINT =
  `The frozen tool surface diverges from the checked-in golden. If the change is INTENDED: run \`${UPDATE_COMMAND}\`, ` +
  "commit the JSON diff and justify it in the PR (a description, schema or annotation change alters what every " +
  "consuming model reads). NEVER edit a golden by hand to match broken output. Fix the code instead."

/** Recursively sort object keys so goldens are byte-stable; arrays keep their order. */
export function stableSort(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableSort)
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((key) => [key, stableSort((value as Record<string, unknown>)[key])]),
    )
  }
  return value
}

/**
 * True when this run may rewrite goldens: `GOLDEN_UPDATE=1` outside CI.
 * Throws in CI: a golden only ever changes through a committed, reviewed diff.
 */
function updating(what: string, dir: string): boolean {
  if (process.env.GOLDEN_UPDATE !== "1") return false
  if (process.env.CI) {
    throw new Error(
      `GOLDEN_UPDATE is forbidden in CI: goldens change only via a local, committed, reviewed JSON diff (${what}).`,
    )
  }
  fs.mkdirSync(dir, { recursive: true })
  return true
}

/**
 * Compares `actual` (key-sorted) against the checked-in golden `name`. With
 * `GOLDEN_UPDATE=1` (and NOT in CI) the golden is rewritten instead, loudly.
 */
export function assertGolden(name: string, actual: unknown, dir = GOLDEN_DIR): void {
  const sorted = stableSort(actual)
  const file = path.join(dir, `${name}.json`)
  if (updating(name, dir)) {
    fs.writeFileSync(file, JSON.stringify(sorted, null, 2) + "\n", "utf8")
    console.warn(
      `GOLDEN UPDATED: ${path.relative(process.cwd(), file)}. Commit and justify the diff.`,
    )
    return
  }
  if (!fs.existsSync(file)) {
    throw new Error(
      `Golden "${name}" does not exist yet. If this surface is new and intended: ${UPDATE_COMMAND}, then commit the JSON. Never hand-write a golden.`,
    )
  }
  expect(sorted, GOLDEN_HINT).toEqual(JSON.parse(fs.readFileSync(file, "utf8")))
}

type Budgets = Record<string, number | string>

function readBudgets(file: string): Budgets {
  return fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, "utf8")) as Budgets) : {}
}

/**
 * Pins golden `name`'s model-visible character count to its budget. With
 * `GOLDEN_UPDATE=1` the budget is rewritten to the measured value. A raise
 * then fails `pnpm lint` (check-ratchets) unless the branch carries a
 * `Ratchet-Exception:` trailer; a shrink tightens the budget for good.
 */
export function assertCharBudget(name: string, measured: number, dir = GOLDEN_DIR): void {
  const file = path.join(dir, BUDGETS_FILE)
  const budgets = readBudgets(file)
  const budget = budgets[name]
  if (updating(`${BUDGETS_FILE} → ${name}`, dir)) {
    budgets[name] = measured
    fs.writeFileSync(file, JSON.stringify(stableSort(budgets), null, 2) + "\n", "utf8")
    if (typeof budget === "number" && measured > budget) {
      console.warn(
        `CHAR BUDGET RAISED: ${name} ${budget} -> ${measured}. The budget is shrink-only: \`pnpm lint\` fails until the commit carries "Ratchet-Exception: <why the model must read ${measured - budget} more characters>".`,
      )
    }
    return
  }
  if (typeof budget !== "number") {
    throw new Error(
      `No character budget for "${name}" in __golden__/${BUDGETS_FILE}. Create it with ${UPDATE_COMMAND} and commit it.`,
    )
  }
  if (measured > budget) {
    throw new Error(
      `The model-visible surface "${name}" grew from ${budget} to ${measured} characters. The budget is shrink-only: trim descriptions, schemas or instructions, or run ${UPDATE_COMMAND} and justify the growth with a "Ratchet-Exception: <reason>" commit trailer (pnpm lint enforces it).`,
    )
  }
  if (measured < budget) {
    throw new Error(
      `The model-visible surface "${name}" shrank from ${budget} to ${measured} characters; tighten the budget: ${UPDATE_COMMAND}.`,
    )
  }
}

export interface WireTool {
  name: string
  title?: string
  description?: string
  inputSchema?: unknown
  _meta?: { ui?: { visibility?: unknown } } & Record<string, unknown>
}

/**
 * Whether a model can call (and therefore reads) the tool: everything except
 * app-only feeds, whose `_meta.ui.visibility` omits "model" (SEP-1865 hosts
 * hide them from the LLM).
 */
export function isModelVisible(tool: WireTool): boolean {
  const visibility = tool._meta?.ui?.visibility
  return !Array.isArray(visibility) || visibility.includes("model")
}

/**
 * The text a model reads from one toolset: for each tool it can call, name,
 * title, description and the serialized inputSchema (incl. every
 * `.describe()`); plus the server `instructions` (the preamble and every
 * active module's snippet) a client receives at initialize, so text moved
 * from a description into the instructions still counts. `outputSchema`,
 * annotations and `_meta` steer hosts and stay out (they are pinned by the
 * golden itself).
 */
export function modelVisibleChars(tools: readonly WireTool[], instructions: string): number {
  return tools
    .filter(isModelVisible)
    .reduce(
      (sum, tool) =>
        sum +
        tool.name.length +
        (tool.title?.length ?? 0) +
        (tool.description?.length ?? 0) +
        JSON.stringify(tool.inputSchema ?? {}).length,
      instructions.length,
    )
}

/** One parameter description a model reads on several tools. */
export interface RepeatedParamDescription {
  description: string
  /** The parameter names it is attached to (one, unless a text is shared under several names). */
  params: string[]
  tools: string[]
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null

/**
 * Every `[property name, description]` at any depth of a JSON schema: the properties of every
 * object node, wherever it sits (nested objects, array `items`, map `additionalProperties`,
 * `anyOf`/`oneOf`/`allOf` branches), since a nested `value` repeats a top-level one just the same.
 */
function describedParams(node: unknown): Array<[string, string]> {
  if (Array.isArray(node)) return node.flatMap(describedParams)
  if (!isObject(node)) return []
  const { properties } = node
  const own = isObject(properties)
    ? Object.entries(properties).flatMap(([key, property]) =>
        isObject(property) && typeof property.description === "string"
          ? [[key, property.description] as [string, string]]
          : [],
      )
    : []
  return [...own, ...Object.values(node).flatMap(describedParams)]
}

/**
 * The parameter descriptions that appear on more than `maxTools` model-visible tools, keyed on
 * the text alone (a text shared under different names repeats just the same). A parameter that
 * means the same on every tool is explained once in the module instructions, not per tool.
 */
export function repeatedParamDescriptions(
  tools: readonly WireTool[],
  maxTools = 2,
): RepeatedParamDescription[] {
  const seen = new Map<string, RepeatedParamDescription>()
  for (const tool of tools.filter(isModelVisible)) {
    for (const [param, description] of describedParams(tool.inputSchema)) {
      const entry = seen.get(description) ?? { description, params: [], tools: [] }
      if (!entry.params.includes(param)) entry.params.push(param)
      if (!entry.tools.includes(tool.name)) entry.tools.push(tool.name)
      seen.set(description, entry)
    }
  }
  return [...seen.values()].filter((entry) => entry.tools.length > maxTools)
}
