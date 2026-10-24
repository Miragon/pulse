/**
 * The program is pulse-cli. Up to 0.10.0 it was called operate, and the text it ships (code,
 * help, guide, skill, README, docs, image and formula) names it pulse-cli now. The repository's
 * old-names guard (apps/mcp-server-camunda7/test/old-names.test.ts) bans operate's technical names
 * but lets the word pass on purpose, since Pulse uses the verb; a leftover such as "operate sends
 * the token" would ship silently. So this test reads the shipped text and fails on the word in
 * lower case (`Operate`, Camunda 8's product, and `OperateError` pass) outside ALLOWED. ALLOWED is
 * shrink-only: an entry that covers no hit fails.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join, relative } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

const ROOT = new URL("../../../", import.meta.url)
const ROOT_DIR = fileURLToPath(ROOT)

const OLD_NAME = /(?<![\w.-])operate(?!\w)/

/** The files under `directory` (repository-relative), recursively. */
function filesIn(directory: string): string[] {
  return readdirSync(new URL(directory, ROOT), { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relative(ROOT_DIR, join(entry.parentPath, entry.name)).replaceAll("\\", "/"))
}

/** What pulse-cli ships or publishes: its code, skill, README, image, formula and docs. */
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
    file: "apps/cli/src/workflow/deploy.ts",
    line: /^const (?:DEPLOYMENT_SOURCE|DEFAULT_NAME) = "operate"$/,
    reason:
      "engines store the deployment source and name; a new value redeploys every unchanged resource",
  },
  {
    file: "apps/cli/src/workflow/advance-plan.ts",
    line: /^const DEFAULT_WORKER = "operate"$/,
    reason: "engines hold external-task locks under the default worker id",
  },
  {
    file: "apps/cli/src/docs/workflow-options.ts",
    line: /\(default operate\)/,
    reason: "the help states the default worker id and deployment name",
  },
  {
    file: "apps/cli/src/docs/workflow.ts",
    line: /deployment-source operate/,
    reason: "describe states the deployment source",
  },
  {
    file: "apps/cli/src/docs/guide-topics/workflow.ts",
    line: /default \\`operate\\`/,
    reason: "the guide states the default worker id and deployment name",
  },
  {
    file: /^(?:apps\/cli\/(?:README\.md|skills\/pulse-cli\/(?:SKILL\.md|\.claude-plugin\/plugin\.json))|docs\/cli\/index\.md)$/,
    line: /\*\*operate a Camunda 7|, operate a Camunda 7|[Ii]nspect and operate/,
    reason: "the English verb",
  },
  {
    file: /^apps\/cli\/src\/cli\/commands\/(?:auth-logout|auth-shared|auth-view|config-login)\.ts$/,
    line: /\boperate 0\.[67]\b/,
    reason:
      "the logins that operate 0.7.0 and earlier cached under the profile's name, which auth logout and config delete still remove",
  },
  {
    file: "apps/cli/scripts/homebrew-formula.sh",
    line: /=> "operate"|bin\}\/operate|# operate, the command/,
    reason: "the Homebrew alias operate until the first release after 2027-01-31",
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

const HITS: readonly Hit[] = [...TEXTS].flatMap(([file, lines]) =>
  lines.flatMap((text, index) =>
    OLD_NAME.test(text) ? [{ file, line: index + 1, text: text.trim() }] : [],
  ),
)

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

  it("is pulse-cli: no operate outside ALLOWED", () => {
    const stale = HITS.filter((hit) => !ALLOWED.some((entry) => allows(entry, hit))).map(
      (hit) => `${hit.file}:${hit.line} ${hit.text.slice(0, 160)}`,
    )
    expect(stale).toEqual([])
  })

  it.each(ALLOWED.map((entry) => [entry.reason, entry] as const))(
    "the allowance still covers a hit: %s",
    (_reason, entry) => {
      expect(HITS.some((hit) => allows(entry, hit))).toBe(true)
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
    "pulse-cli sends the token as it is",
    "Camunda 8 Operate",
    "OperateError",
    "cooperate",
    "the .operate suffix",
    "operated",
  ])("lets %s pass", (text) => {
    expect(OLD_NAME.test(text)).toBe(false)
  })
})
