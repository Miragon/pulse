/**
 * The program is pulse. Up to 0.10.0 it was called operate, and the text it ships (code,
 * help, guide, skill, README, docs, image and formula) names it pulse now. The repository's
 * old-names guard (scripts/old-names.test.mjs) bans operate's technical names
 * but lets the word pass on purpose, since Pulse uses the verb; a leftover such as "operate sends
 * the token" would ship silently. So this test reads the shipped text and fails on the word in
 * lower case (`Operate`, Camunda 8's product, and `OperateError` pass) outside ALLOWED. ALLOWED is
 * shrink-only: an entry that covers no hit fails.
 *
 * Up to 0.25 the command was pulse-cli, and it stays as the second name of the same program
 * (package.json `bin`), so scripts and agents that call it keep working. Every text that tells a
 * person or an agent what to type says pulse; the second name stands only where SECOND_NAME_ALLOWED
 * says why. The names that keep the old spelling are no program name and pass the pattern: the npm
 * package @miragon/pulse-cli, .pulse-cli.json, the config directory path, the image
 * ghcr.io/miragon/pulse-cli, the release assets pulse-cli-<os>-<arch>, the bundle pulse-cli.js and
 * the plugin command /pulse-cli:status.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join, relative } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

const ROOT = new URL("../../../", import.meta.url)
const ROOT_DIR = fileURLToPath(ROOT)

const OLD_NAME = /(?<![\w.-])operate(?!\w)/

/** pulse-cli as a word of its own: not a path, a file, an asset, a package or a plugin command. */
const SECOND_NAME = /(?<![\w./@\\-])pulse-cli(?![\w-]|\.\w|:\w|@|\/)/

/** The files under `directory` (repository-relative), recursively. */
function filesIn(directory: string): string[] {
  return readdirSync(new URL(directory, ROOT), { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relative(ROOT_DIR, join(entry.parentPath, entry.name)).replaceAll("\\", "/"))
}

/** What pulse ships or publishes: its code, skill, README, image, formula and docs. */
const SHIPPED: readonly string[] = [
  ...filesIn("apps/cli/src/").filter(
    (file) => file.endsWith(".ts") && !file.endsWith(".test.ts") && !file.includes("/generated/"),
  ),
  ...filesIn("apps/cli/skills/pulse-cli/").filter((file) => !file.includes("/evals/")),
  "apps/cli/README.md",
  "apps/cli/package.json",
  "apps/cli/Dockerfile",
  "apps/cli/scripts/homebrew-formula.sh",
  ...filesIn("docs/cli/").filter((file) => file.endsWith(".md")),
].sort()

interface Allowance {
  /** Repository-relative path, or a pattern over it. */
  readonly file: string | RegExp
  /** Only on lines that match. */
  readonly line?: RegExp
  /** Only under a Markdown heading that matches, up to the next heading of its level or above. */
  readonly section?: RegExp
  readonly reason: string
}

/** Where the word is right. Shrink-only: an entry that covers no hit fails. */
const ALLOWED: readonly Allowance[] = [
  {
    file: /^(?:apps\/cli\/(?:README\.md|skills\/pulse-cli\/(?:SKILL\.md|\.claude-plugin\/plugin\.json))|docs\/cli\/index\.md)$/,
    line: /\*\*operate a Camunda 7|, operate a Camunda 7|[Ii]nspect and operate/,
    reason: "the English verb",
  },
]

/** Where the second name is right. Shrink-only: an entry that covers no hit fails. */
const SECOND_NAME_ALLOWED: readonly Allowance[] = [
  {
    file: /^(?:apps\/cli\/(?:README\.md|src\/docs\/guide\.ts|skills\/pulse-cli\/(?:SKILL|commands\/status)\.md)|docs\/cli\/installation\.md)$/,
    line: /second name|is missing, try|call `pulse-cli`|links `pulse` to it|older pulse-cli without topics|^- Bash\(pulse-cli (?:status|ping)\)$/,
    reason: "the second name and the old installs that know only it",
  },
  {
    file: /^apps\/cli\/src\/(?:workflow\/(?:advance-plan|deploy)|docs\/(?:workflow|workflow-options))\.ts$/,
    line: /DEFAULT_WORKER|DEPLOYMENT_SOURCE|DEFAULT_NAME|\(default pulse-cli\)|deployment-source pulse-cli/,
    reason: "the worker id and the deployment name and source the engine stores stay unchanged",
  },
  {
    file: /^(?:apps\/cli\/src\/config\/oauth\.ts|docs\/cli\/(?:authentication|configuration)\.md)$/,
    line: /client[ _-]?id/i,
    reason: "an OAuth client registered as pulse-cli, a value of the authorization server",
  },
  {
    file: "apps/cli/src/config/file.ts",
    line: /CONFIG_DIRECTORY/,
    reason: "the config directory keeps its name",
  },
  {
    file: /^(?:apps\/cli\/(?:Dockerfile|scripts\/homebrew-formula\.sh)|docs\/cli\/(?:development|releasing)\.md)$/,
    line: /docker (?:build|run)|image\.title|bin\.install(?:_symlink bin\/)? ?"pulse-cli"|executable `?pulse-cli/,
    reason: "the image, the local image tag and the executable the formula installs keep the name",
  },
  {
    file: "apps/cli/package.json",
    line: /^\s*"pulse-cli": "dist\/pulse-cli\.js"/,
    reason: "the second bin, the name npx runs for the scoped package",
  },
  {
    file: /^(?:apps\/cli\/skills\/pulse-cli\/(?:SKILL\.md|\.claude-plugin\/plugin\.json)|docs\/cli\/agents\.md)$/,
    line: /^name: pulse-cli$|"name": "pulse-cli"|plugin, `pulse-cli`|skill `pulse-cli`/,
    reason: "the Claude Code plugin and its skill keep their names",
  },
  {
    file: "apps/cli/README.md",
    line: /^!\[pulse-cli status/,
    reason: "the recording of the README shows the command under its old name",
  },
]

interface Hit {
  readonly file: string
  /** 1-based. */
  readonly line: number
  readonly text: string
}

const matches = (file: string, spec: string | RegExp) =>
  typeof spec === "string" ? file === spec : spec.test(file)

/** The level of the section after a heading of `depth`: its own when it matches, else the open one. */
function levelAfter(open: number | undefined, depth: number, matching: boolean) {
  if (matching) return depth
  return open !== undefined && depth <= open ? undefined : open
}

/** The 1-based lines under each heading that matches `heading`, fenced code skipped as headings. */
function sectionLines(lines: readonly string[], heading: RegExp): Set<number> {
  const inside = new Set<number>()
  let level: number | undefined
  let fenced = false
  lines.forEach((text, index) => {
    if (/^\s*```/.test(text)) fenced = !fenced
    const depth = fenced ? undefined : /^(#{1,6})\s/.exec(text)?.[1]?.length
    if (depth !== undefined) level = levelAfter(level, depth, heading.test(text))
    if (level !== undefined) inside.add(index + 1)
  })
  return inside
}

const TEXTS = new Map(
  SHIPPED.map((file) => [file, readFileSync(new URL(file, ROOT), "utf8").split("\n")] as const),
)

function allows(entry: Allowance, hit: Hit): boolean {
  if (!matches(hit.file, entry.file)) return false
  if (entry.line !== undefined && !entry.line.test(hit.text)) return false
  const lines = TEXTS.get(hit.file) ?? []
  return entry.section === undefined || sectionLines(lines, entry.section).has(hit.line)
}

function hitsOf(pattern: RegExp): readonly Hit[] {
  return [...TEXTS].flatMap(([file, lines]) =>
    lines.flatMap((text, index) =>
      pattern.test(text) ? [{ file, line: index + 1, text: text.trim() }] : [],
    ),
  )
}

const HITS = hitsOf(OLD_NAME)
const SECOND_NAME_HITS = hitsOf(SECOND_NAME)

const outside = (hits: readonly Hit[], allowed: readonly Allowance[]) =>
  hits
    .filter((hit) => !allowed.some((entry) => allows(entry, hit)))
    .map((hit) => `${hit.file}:${hit.line} ${hit.text.slice(0, 160)}`)

describe("the program name in the shipped text", () => {
  it("reads the code, the skill, the README, the image, the formula and the docs", () => {
    for (const file of [
      "apps/cli/src/cli/program.ts",
      "apps/cli/skills/pulse-cli/SKILL.md",
      "apps/cli/skills/pulse-cli/commands/status.md",
      "apps/cli/README.md",
      "apps/cli/Dockerfile",
      "apps/cli/scripts/homebrew-formula.sh",
      "docs/cli/installation.md",
    ]) {
      expect(SHIPPED).toContain(file)
      expect(existsSync(new URL(file, ROOT)), file).toBe(true)
    }
    expect(SHIPPED.some((file) => file.endsWith(".test.ts"))).toBe(false)
    expect(SHIPPED.some((file) => file.includes("/generated/") || file.includes("/evals/"))).toBe(
      false,
    )
  })

  it("is pulse: no operate outside ALLOWED", () => {
    expect(outside(HITS, ALLOWED)).toEqual([])
  })

  it("is pulse: no pulse-cli outside SECOND_NAME_ALLOWED", () => {
    expect(outside(SECOND_NAME_HITS, SECOND_NAME_ALLOWED)).toEqual([])
  })

  it.each(ALLOWED.map((entry) => [entry.reason, entry] as const))(
    "the allowance still covers a hit: %s",
    (_reason, entry) => {
      expect(HITS.some((hit) => allows(entry, hit))).toBe(true)
    },
  )

  it.each(SECOND_NAME_ALLOWED.map((entry) => [entry.reason, entry] as const))(
    "the second name's allowance still covers a hit: %s",
    (_reason, entry) => {
      expect(SECOND_NAME_HITS.some((hit) => allows(entry, hit))).toBe(true)
    },
  )
})

describe("the old program name", () => {
  it.each([
    "operate sends the token as it is",
    "Run `operate guide` first",
    "echo ok && operate ping",
    "/operate:status",
  ])("finds %s", (text) => {
    expect(OLD_NAME.test(text)).toBe(true)
  })

  it.each([
    "pulse sends the token as it is",
    "Camunda 8 Operate",
    "OperateError",
    "cooperate",
    "the .operate suffix",
    "operated",
  ])("lets %s pass", (text) => {
    expect(OLD_NAME.test(text)).toBe(false)
  })
})

describe("the second name", () => {
  it.each([
    "pulse-cli sends the token as it is",
    "Run `pulse-cli guide` first",
    "echo ok && pulse-cli ping",
    "printf '%s\\n' \"$PASSWORD\" | pulse-cli ... --auth-password-stdin",
    "This is likely a bug in pulse-cli.",
  ])("finds %s", (text) => {
    expect(SECOND_NAME.test(text)).toBe(true)
  })

  it.each([
    "pulse sends the token as it is",
    "npm i -g @miragon/pulse-cli",
    "ghcr.io/miragon/pulse-cli:0.25.0",
    "reads ./.pulse-cli.json first",
    "~/.config/pulse-cli/config.json",
    "%APPDATA%\\pulse-cli\\config.json",
    "curl -O $base/pulse-cli-linux-x64",
    "dist/pulse-cli.js",
    "/pulse-cli:status",
    "claude plugin install pulse-cli@pulse",
    "skills/pulse-cli/SKILL.md",
  ])("lets %s pass", (text) => {
    expect(SECOND_NAME.test(text)).toBe(false)
  })
})
