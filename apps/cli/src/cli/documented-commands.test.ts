/**
 * Drift protection between the docs and the real command line: every `operate` command of the guide
 * (the core and every topic), of the README and of every page of docs/ (each page in order on its
 * own fake engine) and every example of every operation must run in the CLI with exit code 0
 * (examples with --dry-run, whose preview must show the method and path of the operation).
 * src/cli/command-lines.test.ts checks them against the catalog; this test runs them.
 */

import { describe, expect, it } from "vitest"
import { DOC_PAGES } from "../../test/support/doc-pages.js"
import {
  CONFIG_PATH,
  execute,
  type FakeRuntime,
  fakeRuntime,
} from "../../test/support/fake-runtime.js"
import { GUIDE_PAGES } from "../../test/support/guide-pages.js"
import { WorkflowEngine } from "../../test/support/workflow-engine.js"
import { loadCatalog } from "../catalog/catalog.js"
import type { OperationSpec } from "../catalog/types.js"
import { examplesFor } from "../docs/examples.js"
import { commandWords } from "../docs/text.js"
import { run } from "./run.js"

const catalog = loadCatalog()

const SHELL_OPERATORS = new Set(["|", "||", "&&", ";", ">", ">>", "<", "2>"])

/** Shell words without their single quotes, as the shell passes them. */
function shellWords(line: string): string[] {
  return commandWords(line).map((word) => word.replaceAll("'", ""))
}

function operateSegments(words: readonly string[]): string[][] {
  const segments: string[][] = [[]]
  for (const word of words) {
    if (SHELL_OPERATORS.has(word)) segments.push([])
    else segments.at(-1)?.push(word)
  }
  return segments.filter((segment) => segment[0] === "operate")
}

/**
 * `operate` commands in the shell code blocks (```sh, or ```sh [label] in a VitePress code group)
 * of markdown, split at shell operators. Other blocks hold transcripts and syntax summaries.
 */
function fencedCommands(markdown: string): string[][] {
  const commands: string[][] = []
  let fence: string | undefined
  for (const line of markdown.split("\n")) {
    if (line.startsWith("```")) fence = fence === undefined ? line.slice(3) : undefined
    else if (fence !== undefined && /^sh(?: \[.*\])?$/.test(fence)) {
      commands.push(...operateSegments(shellWords(line)))
    }
  }
  return commands
}

/** A BPMN file with one executable process named like the file (`invoice.bpmn` → `invoice`). */
function processXml(path: string): string {
  const key = (path.split("/").at(-1) ?? path).replace(/\.bpmn$/, "")
  return `<bpmn:definitions><bpmn:process id="${key}" isExecutable="true" /></bpmn:definitions>`
}

function contentOf(path: string): string {
  if (path.endsWith(".json")) return "{}"
  return path.endsWith(".bpmn") ? processXml(path) : "<x/>"
}

/** Files the command lines refer to (`invoice.bpmn`, `@start.json`), with minimal content. */
function referencedFiles(words: readonly string[]): Record<string, string> {
  const paths = words
    .map((word) => word.replace(/^@/, ""))
    .filter((word) => /\.(?:json|bpmn|dmn|form|pdf)$/.test(word))
  return Object.fromEntries(paths.map((path) => [path, contentOf(path)]))
}

/** Directories the documented `operate deploy` lines deploy, each with one process. */
const DEPLOYED_DIRECTORIES = {
  "bpmn/invoice.bpmn": processXml("invoice.bpmn"),
  "src/main/resources/invoice.bpmn": processXml("invoice.bpmn"),
}

/**
 * Documented lines that exit with code 9 on purpose: the dev loop's `advance --wait` meets the
 * incident of the failing job (the next line retries it).
 */
const EXIT_9: ReadonlySet<string> = new Set([
  "operate advance --business-key B-1 --var approved=true --wait",
])

/**
 * The config file a docs page starts with: its reader already has a default profile, so a profile
 * the page creates (`config set staging ...`) does not become the default of its later commands.
 */
const READER_CONFIG = {
  [CONFIG_PATH]: JSON.stringify({
    defaultProfile: "local",
    profiles: { local: { url: "http://localhost:8080/engine-rest" } },
  }),
}

/** The repository the documented commands run in (project files go to its root). */
const REPOSITORY = "/home/tester/repo"

/**
 * A runtime with the scripted fake engine of the workflow commands (lenient: every other request
 * gets `{}`, paged ones `[]`), whose job executor runs while the CLI sleeps, and the referenced
 * files, in a repository whose token commands print a token.
 */
function documentedRuntime(
  words: readonly string[],
  files: Readonly<Record<string, string>> = {},
): FakeRuntime {
  const engine = new WorkflowEngine("approve", true)
  return fakeRuntime({
    fetch: engine.fetch,
    onSleep: () => {
      engine.tick()
    },
    stdin: "{}",
    cwd: REPOSITORY,
    dirs: [`${REPOSITORY}/.git`],
    commands: { stdout: "documented-token\n" },
    files: { ...DEPLOYED_DIRECTORIES, ...referencedFiles(words), ...files },
  })
}

/** Runs the command lines one after the other on `runtime`; returns the failed ones. */
async function failures(lines: readonly (readonly string[])[], runtime: FakeRuntime) {
  const failed: string[] = []
  for (const words of lines) {
    runtime.stdout.chunks.length = 0
    runtime.stderr.chunks.length = 0
    const result = await execute(run, words.slice(1), runtime)
    const expected = EXIT_9.has(words.join(" ")) ? 9 : 0
    if (result.code !== expected) failed.push(`${words.join(" ")}: ${result.stderr}`)
  }
  return failed
}

/** Method and URL of a dry-run preview: JSON, or the curl line of `-o table`. */
function previewOf(stdout: string): { method: string; url: string } {
  if (!stdout.startsWith("curl ")) return JSON.parse(stdout) as { method: string; url: string }
  const method = /-X ([A-Z]+)/.exec(stdout)?.[1] ?? "GET"
  return { method, url: /'(http[^']*)'/.exec(stdout)?.[1] ?? "" }
}

/** The path of an operation as a pattern: `{id}` matches one non-empty segment. */
function pathPattern(operation: OperationSpec): RegExp {
  const segments = operation.path
    .replace(/[.*+?^$()|[\]\\]/g, "\\$&")
    .replace(/\{[^}]+\}/g, "[^/]+")
  return new RegExp(`^/engine-rest${segments}$`)
}

/**
 * Runs the dry-run examples; returns those that fail or whose preview does not show the method
 * and path of their operation (a flag swallowed by another option would still exit with 0).
 */
async function previewFailures(examples: readonly (readonly [OperationSpec, readonly string[]])[]) {
  const runtime = documentedRuntime(examples.flatMap(([, words]) => words))
  const failed: string[] = []
  for (const [operation, words] of examples) {
    runtime.stdout.chunks.length = 0
    runtime.stderr.chunks.length = 0
    const result = await execute(run, words.slice(1), runtime)
    const preview = result.code === 0 ? previewOf(result.stdout) : undefined
    const matches =
      preview?.method === operation.method &&
      pathPattern(operation).test(new URL(preview.url).pathname)
    if (!matches) failed.push(`${words.join(" ")}: ${result.stdout}${result.stderr}`)
  }
  return failed
}

describe("documented command lines run in the CLI", () => {
  it("finds the operate commands of fenced code blocks", () => {
    const markdown =
      "text operate x\n```sh\necho '{}' | operate guide && operate ping -o 'json'\n```\n```text\noperate <group>\n```"
    expect(fencedCommands(markdown)).toEqual([
      ["operate", "guide"],
      ["operate", "ping", "-o", "json"],
    ])
    const codeGroup = "```sh [CI]\noperate status\n```\n```text [Claude Code]\n/operate:status\n```"
    expect(fencedCommands(codeGroup)).toEqual([["operate", "status"]])
    expect(fencedCommands("```shell\noperate status\n```")).toEqual([])
    expect(referencedFiles(["--body", "@a.json", "b.bpmn", "c.txt"])).toEqual({
      "a.json": "{}",
      "b.bpmn": processXml("b.bpmn"),
    })
  })

  it.each(GUIDE_PAGES)("runs the commands of the guide page %s in order", async (_, text) => {
    const page = fencedCommands(text)
    expect(page.length).toBeGreaterThan(0)
    expect(await failures(page, documentedRuntime(page.flat()))).toEqual([])
  })

  it.each(DOC_PAGES)("runs the commands of %s in order", async (_, text) => {
    const page = fencedCommands(text)
    expect(await failures(page, documentedRuntime(page.flat(), READER_CONFIG))).toEqual([])
  })

  it("finds the commands of the README and the docs pages", () => {
    const documented = DOC_PAGES.flatMap(([, text]) => fencedCommands(text))
    expect(documented.length).toBeGreaterThan(40)
  })

  it("runs every example of every operation with --dry-run, previewing its request", async () => {
    const examples = catalog.operations.flatMap((operation) =>
      examplesFor(operation, catalog.schemas).map(
        (example) => [operation, [...shellWords(example), "--dry-run"]] as const,
      ),
    )
    expect(examples.length).toBeGreaterThan(catalog.operations.length)
    expect(await previewFailures(examples)).toEqual([])
  })

  it("notices an example whose preview does not match its operation", async () => {
    const list = catalog.operations.find((operation) => operation.operationId === "getTasks")!
    const count = catalog.operations.find((operation) => operation.operationId === "getTasksCount")!
    const words = ["operate", "task", "count", "--dry-run"]
    expect(await previewFailures([[count, words]])).toEqual([])
    expect(await previewFailures([[list, words]])).toHaveLength(1)
    const table = ["operate", "task", "delete", "t1", "--dry-run", "-o", "table"]
    const remove = catalog.operations.find((operation) => operation.operationId === "deleteTask")!
    expect(await previewFailures([[remove, table]])).toEqual([])
  })

  it("reports the command lines that fail", async () => {
    const lines = [
      ["operate", "task", "list", "--no-such-flag"],
      ["operate", "guide"],
    ]
    expect(await failures(lines, documentedRuntime([]))).toEqual([
      `operate task list --no-such-flag: ${JSON.stringify({
        error: {
          code: "USAGE",
          exitCode: 2,
          message: 'Unknown option "--no-such-flag"',
          hint: 'Run "operate task list --help" for the usage.',
        },
      })}\n`,
    ])
  })
})
