/**
 * The command line checker of the command line tests (src/cli/command-lines.test.ts): an
 * `pulse-cli` command line is valid against the catalog when its group and command exist, it has the
 * right number of positional arguments, only options the command registers (operation options from
 * `operationOptions`, `--no-x` for boolean options, the global options of GLOBAL_FLAGS) and values
 * the CLI accepts.
 */

import { expect } from "vitest"
import { GLOBAL_FLAGS } from "../../scripts/catalog/flags.js"
import {
  findByOperationId,
  findGroup,
  findOperation,
  loadCatalog,
} from "../../src/catalog/catalog.js"
import { EFFECTS, type OperationSpec } from "../../src/catalog/types.js"
import { validateBody } from "../../src/catalog/validate.js"
import { normalizeDateTime } from "../../src/operation/dates.js"
import { parseVariable } from "../../src/operation/variables.js"
import { findGuideTopic } from "../../src/docs/guide.js"
import { type OptionDoc, operationArguments, operationOptions } from "../../src/docs/options.js"
import { commandWords } from "../../src/docs/text.js"
import { findWorkflow, WORKFLOW_DOCS, type WorkflowDoc } from "../../src/docs/workflow.js"
import { parseDuration } from "../../src/operation/durations.js"
import { parseCondition } from "../../src/workflow/conditions.js"

export const catalog = loadCatalog()

interface FlagSpec {
  readonly takesValue: boolean
  readonly check?: (value: string) => void
}

type Flags = ReadonlyMap<string, FlagSpec>

const OPERATORS = new Set(["|", "||", "&&", ";", ">", ">>", "<", "2>"])

function unquote(word: string): string {
  return word.replace(/'([^']*)'/g, "$1")
}

function checkOutput(value: string): void {
  expect(["json", "table"]).toContain(value)
}

function checkJson(value: string): unknown {
  if (value === "-" || value.startsWith("@")) return undefined
  return JSON.parse(value) as unknown
}

function valueCheck(option: OptionDoc, operation: OperationSpec): (value: string) => void {
  return (value) => {
    if (option.enum !== undefined) expect(option.enum).toContain(value)
    if (option.type === "integer") expect(value).toMatch(/^-?\d+$/)
    if (option.type === "number") expect(Number.isFinite(Number(value))).toBe(true)
    if (option.type === "date-time") normalizeDateTime(value)
    if (option.source === "variables") parseVariable(value, option.flag)
    if (option.source === "body" && operation.body?.kind === "json") {
      const body = checkJson(value)
      if (body === undefined) return
      const problems = validateBody(operation.body.schema, body, catalog.schemas).filter(
        // required top-level properties may come from flags
        (problem) => !(problem.path === "$" && problem.message.startsWith("missing required")),
      )
      expect(problems).toEqual([])
    }
  }
}

function withFlags(base: Flags, extra: Record<string, FlagSpec>): Flags {
  return new Map([...base, ...Object.entries(extra)])
}

/** Value checks of the workflow options: choices, durations, conditions, variables, integers. */
function workflowCheck(option: OptionDoc): (value: string) => void {
  return (value) => {
    if (option.enum !== undefined) expect(option.enum).toContain(value)
    if (option.type === "duration") parseDuration(value, `--${option.flag}`)
    if (option.type === "condition") parseCondition(value)
    if (option.type === "variables") parseVariable(value, option.flag)
    if (option.type === "integer") expect(value).toMatch(/^\d+$/)
  }
}

/** Number of positionals after the subcommand: [min, max]. */
const CONFIG_SUBCOMMANDS: Readonly<Record<string, readonly [number, number]>> = {
  path: [0, 0],
  show: [0, 0],
  list: [0, 0],
  set: [1, 1],
  unset: [2, Infinity],
  use: [1, 1],
  delete: [1, 1],
}

/** `pulse-cli` commands in the fenced code blocks, split at shell operators such as `|`. */
export function guideCommands(markdown: string): string[][] {
  const commands: string[][] = []
  let fenced = false
  for (const line of markdown.split("\n")) {
    if (line.startsWith("```")) {
      fenced = !fenced
      continue
    }
    if (!fenced) continue
    let segment: string[] = []
    for (const word of [...commandWords(line), "|"]) {
      if (!OPERATORS.has(word)) {
        segment.push(word)
        continue
      }
      if (segment[0] === "pulse-cli") commands.push(segment)
      segment = []
    }
  }
  return commands
}

/** The flags of a global option, as src/cli/globals.ts declares them (GLOBAL_OPTIONS). */
export interface GlobalOptionFlags {
  readonly long: string
  readonly short?: string
  readonly value?: string
}

/**
 * The checker of a command line, for the global options the CLI registers. The test passes
 * GLOBAL_OPTIONS (src/cli/globals.ts): test/support never imports the command layer.
 */
export function commandLineChecker(globalOptions: readonly GlobalOptionFlags[]) {
  /** Short flags and the flags with a value, from the global options the CLI registers. */
  const SHORT_FLAGS: Readonly<Record<string, string>> = Object.fromEntries(
    globalOptions.flatMap((spec) => (spec.short === undefined ? [] : [[spec.short, spec.long]])),
  )
  const GLOBAL_VALUE_FLAGS = globalOptions
    .filter((spec) => spec.value !== undefined)
    .map((spec) => spec.long)

  const GLOBALS: Flags = new Map(
    GLOBAL_FLAGS.map((flag): [string, FlagSpec] => [
      flag,
      {
        takesValue: GLOBAL_VALUE_FLAGS.includes(flag),
        ...(flag === "output" ? { check: checkOutput } : {}),
        ...(flag === "timeout"
          ? {
              check: (value: string) => {
                expect(value).toMatch(/^\d+$/)
              },
            }
          : {}),
      },
    ]),
  )

  function operationFlags(operation: OperationSpec): Flags {
    const flags = new Map<string, FlagSpec>(GLOBALS)
    for (const option of operationOptions(operation, catalog.schemas)) {
      const takesValue = option.kind === "value" || option.kind === "repeatable"
      if (option.kind !== "negated") {
        flags.set(option.flag, { takesValue, check: valueCheck(option, operation) })
      }
      if (option.kind === "boolean" || option.kind === "negated") {
        flags.set(`no-${option.flag}`, { takesValue: false })
      }
    }
    return flags
  }

  /** Splits words into positionals and checks every option and its value; returns the positionals. */
  function parseWords(words: readonly string[], flags: Flags): string[] {
    const positionals: string[] = []
    for (let index = 0; index < words.length; index++) {
      const word = words[index]!
      if (!word.startsWith("-")) {
        positionals.push(unquote(word))
        continue
      }
      const name = word.startsWith("--") ? word.slice(2) : SHORT_FLAGS[word.slice(1)]
      const spec = name === undefined ? undefined : flags.get(name)
      expect(spec, `unknown option ${word}`).toBeDefined()
      if (spec?.takesValue === true) {
        const value = words[++index]
        expect(value, `missing value of ${word}`).toBeDefined()
        spec.check?.(unquote(value!))
      }
    }
    return positionals
  }

  function checkOperationCommand(operation: OperationSpec, rest: readonly string[]): void {
    const positionals = parseWords(rest, operationFlags(operation))
    const args = operationArguments(operation)
    const required = args.filter((argument) => !argument.variadic).length
    operation.params
      .filter((param) => param.in === "path")
      .forEach((param, index) => {
        if (param.enum !== undefined) expect(param.enum).toContain(positionals[index])
      })
    if (args.some((argument) => argument.variadic)) {
      expect(positionals.length).toBeGreaterThan(required)
    } else {
      expect(positionals).toHaveLength(required)
    }
    if (operation.effect === "delete" || operation.effect === "bulk") {
      expect(rest.some((word) => word === "--yes" || word === "-y" || word === "--dry-run")).toBe(
        true,
      )
    }
  }

  const OUTPUT_FLAGS: Flags = new Map(
    [...GLOBALS].filter(([flag]) => ["output", "fields", "pretty", "help"].includes(flag)),
  )

  function checkCommands(rest: readonly string[]): void {
    const flags = withFlags(OUTPUT_FLAGS, {
      search: { takesValue: true },
      effect: {
        takesValue: true,
        check: (value) => {
          expect(EFFECTS).toContain(value)
        },
      },
    })
    const positionals = parseWords(rest, flags)
    expect(positionals.length).toBeLessThanOrEqual(1)
    if (positionals[0] !== undefined && positionals[0] !== "workflow") {
      expect(findGroup(catalog, positionals[0])).toBeDefined()
    }
  }

  function checkDescribe(rest: readonly string[]): void {
    const [first, second, ...extra] = parseWords(rest, OUTPUT_FLAGS)
    expect(extra).toEqual([])
    expect(first).toBeDefined()
    if (second !== undefined) {
      expect(findOperation(catalog, first!, second)).toBeDefined()
    } else {
      const known = first === "workflow" || findWorkflow(first!) !== undefined
      expect(
        known || (findGroup(catalog, first!) ?? findByOperationId(catalog, first!)) !== undefined,
      ).toBe(true)
    }
  }

  function workflowFlags(doc: WorkflowDoc): Flags {
    const flags = new Map<string, FlagSpec>(GLOBALS)
    for (const option of doc.options) {
      const takesValue = option.kind === "value" || option.kind === "repeatable"
      const name = option.kind === "negated" ? `no-${option.flag}` : option.flag
      flags.set(name, { takesValue, check: workflowCheck(option) })
    }
    return flags
  }

  /** A workflow command line: its options and the number of positionals. */
  function checkWorkflow(doc: WorkflowDoc, rest: readonly string[]): void {
    const positionals = parseWords(rest, workflowFlags(doc))
    const [argument] = doc.arguments
    if (argument === undefined) expect(positionals).toEqual([])
    else if (argument.variadic) expect(positionals.length).toBeGreaterThan(0)
    else expect(positionals.length).toBeLessThanOrEqual(1)
    const definitionOnly =
      doc.name === "retry" &&
      rest.includes("--process-definition-key") &&
      positionals.length === 0 &&
      !rest.includes("--business-key") &&
      !rest.includes("--latest")
    if (definitionOnly)
      expect(rest.some((word) => word === "--yes" || word === "--dry-run")).toBe(true)
  }

  function checkApi(rest: readonly string[]): void {
    const flags = withFlags(GLOBALS, {
      query: {
        takesValue: true,
        check: (value) => {
          expect(value).toMatch(/^[^=]+=/)
        },
      },
      body: { takesValue: true, check: (value) => checkJson(value) },
    })
    const [method, path, ...extra] = parseWords(rest, flags)
    expect(["GET", "POST", "PUT", "DELETE"]).toContain(method)
    expect(path).toMatch(/^\//)
    expect(extra).toEqual([])
    if (method === "DELETE") expect(rest).toContain("--yes")
  }

  const CONFIG_FLAGS: Flags = withFlags(OUTPUT_FLAGS, {
    profile: { takesValue: true },
    config: { takesValue: true },
    url: {
      takesValue: true,
      check: (value) => {
        expect(value).toMatch(/^https?:\/\/[^@]+$/)
      },
    },
    engine: { takesValue: true },
    auth: {
      takesValue: true,
      check: (value) => {
        expect(["none", "basic", "oauth", "bearer"]).toContain(value)
      },
    },
    "auth-user": {
      takesValue: true,
      check: (value) => {
        expect(value).toMatch(/^[^:\s]+$/)
      },
    },
    "auth-password-env": {
      takesValue: true,
      check: (value) => {
        expect(value).toMatch(/^[A-Za-z_][A-Za-z0-9_]*$/)
      },
    },
    "auth-password-stdin": { takesValue: false },
    "auth-token-env": {
      takesValue: true,
      check: (value) => {
        expect(value).toMatch(/^[A-Za-z_][A-Za-z0-9_]*$/)
      },
    },
    "auth-token-stdin": { takesValue: false },
    project: { takesValue: false },
    "oauth-issuer": {
      takesValue: true,
      check: (value) => {
        expect(value).toMatch(/^https:\/\/[^@?#]+$/)
      },
    },
    "oauth-client-id": { takesValue: true },
    timeout: { takesValue: true },
    header: {
      takesValue: true,
      check: (value) => {
        expect(value).toMatch(/^[\w-]+: \S/)
      },
    },
    "read-only": { takesValue: false },
    "no-read-only": { takesValue: false },
    default: { takesValue: false },
    "show-secrets": { takesValue: false },
  })

  function checkConfig(rest: readonly string[]): void {
    const [subcommand, ...positionals] = parseWords(rest, CONFIG_FLAGS)
    const range = CONFIG_SUBCOMMANDS[subcommand ?? ""]
    expect(range, `config ${subcommand}`).toBeDefined()
    expect(positionals.length).toBeGreaterThanOrEqual(range![0])
    expect(positionals.length).toBeLessThanOrEqual(range![1])
    if (subcommand === "set") expect(positionals[0]).toMatch(/^[A-Za-z0-9][A-Za-z0-9._-]*$/)
  }

  /** `pulse-cli auth status|logout` (`auth login` is for a person, never in the guide). */
  function checkAuth(rest: readonly string[]): void {
    const flags = withFlags(new Map([["output", GLOBALS.get("output")!]]), {
      profile: { takesValue: true },
      config: { takesValue: true },
      "auth-token-stdin": { takesValue: false },
      "auth-token-command": CONFIG_FLAGS.get("auth-token-command")!,
    })
    const [subcommand, ...positionals] = parseWords(rest, flags)
    expect(["status", "logout"]).toContain(subcommand)
    expect(positionals).toEqual([])
  }

  /** `pulse-cli guide [topic]` or `pulse-cli guide --list`, with `-o` for the list. */
  function checkGuide(rest: readonly string[]): void {
    const flags = withFlags(new Map([["output", GLOBALS.get("output")!]]), {
      list: { takesValue: false },
    })
    const positionals = parseWords(rest, flags)
    expect(positionals.length).toBeLessThanOrEqual(rest.includes("--list") ? 0 : 1)
    if (positionals[0] !== undefined) expect(findGuideTopic(positionals[0])).toBeDefined()
  }

  const UTILITIES: Readonly<Record<string, (rest: readonly string[]) => void>> = {
    commands: checkCommands,
    describe: checkDescribe,
    api: checkApi,
    ping: (rest) => {
      expect(parseWords(rest, GLOBALS)).toEqual([])
    },
    guide: checkGuide,
    config: checkConfig,
    auth: checkAuth,
    completion: (rest) => {
      expect(rest).toHaveLength(1)
      expect(["bash", "zsh", "fish"]).toContain(rest[0])
    },
    ...Object.fromEntries(
      WORKFLOW_DOCS.map((doc) => [
        doc.name,
        (rest: readonly string[]) => {
          checkWorkflow(doc, rest)
        },
      ]),
    ),
  }

  /** Validates one command line given as words, the first being `pulse-cli`. */
  function checkCommandLine(words: readonly string[]): void {
    expect(words[0]).toBe("pulse-cli")
    const [, first = "", second = "", ...rest] = words
    const utility = UTILITIES[first]
    if (utility !== undefined) {
      utility(words.slice(2))
      return
    }
    const operation = findOperation(catalog, first, second)
    expect(operation, `unknown command ${first} ${second}`).toBeDefined()
    checkOperationCommand(operation!, rest)
  }

  return { checkCommandLine, checkOperationCommand }
}
