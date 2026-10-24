import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import fc from "fast-check"
import { format, resolveConfig } from "prettier"
import { describe, expect, it } from "vitest"
import { GLOBAL_FLAGS } from "../../scripts/catalog/flags.js"
import { GUIDE_PAGES } from "../../test/support/guide-pages.js"
import { DEFAULT_PAGE_SIZE } from "../catalog/rules.js"
import { EXIT_CODES } from "../errors.js"
import { VARIABLE_TYPES } from "../operation/variables.js"
import { findGuideTopic, GUIDE, GUIDE_TOPICS, topicSuggestions } from "./guide.js"

const SKILL_URL = new URL("../../skills/operate/SKILL.md", import.meta.url)
const SKILL = readFileSync(SKILL_URL, "utf8")
const FRONTMATTER = /^---\n([\s\S]*?)\n---\n\n([\s\S]*)$/
const README = readFileSync(new URL("../../README.md", import.meta.url), "utf8")
const AGENTS_PAGE = readFileSync(new URL("../../docs/agents.md", import.meta.url), "utf8")

/**
 * Size budgets per page, with headroom: an edit that adds a few lines to a page must not break
 * main when another one did the same (one 250-line guide did). New material goes to the topic it
 * belongs to, or into a new topic.
 */
const MAX_CORE_LINES = 180
const MAX_TOPIC_LINES = 200
const MAX_PROSE_WIDTH = 100

const ALL = GUIDE_PAGES.map(([, text]) => text).join("\n")

function topicText(name: string): string {
  return findGuideTopic(name)?.text ?? ""
}

/** Lines outside code blocks that are not table rows. */
function proseLines(markdown: string): string[] {
  let fenced = false
  return markdown.split("\n").filter((line) => {
    if (line.startsWith("```")) fenced = !fenced
    return !fenced && !line.startsWith("```") && !line.startsWith("|")
  })
}

function expectAll(text: string, parts: readonly string[]): void {
  for (const part of parts) expect(text).toContain(part)
}

describe.each(GUIDE_PAGES)("guide page %s", (_, text) => {
  const lines = text.split("\n")

  it("is a markdown document with one final newline and closed code blocks", () => {
    expect(text.startsWith("# operate")).toBe(true)
    expect(text.endsWith("\n")).toBe(true)
    expect(text.endsWith("\n\n")).toBe(false)
    expect(text.split("```").length % 2).toBe(1)
    expect(lines.filter((line) => line.startsWith("# "))).toHaveLength(1)
    expect(lines.filter((line) => line.startsWith("## ")).length).toBeGreaterThanOrEqual(3)
  })

  it(`wraps its prose at ${MAX_PROSE_WIDTH} columns, never inside inline code`, () => {
    const prose = proseLines(text)
    expect(prose.filter((line) => line.length > MAX_PROSE_WIDTH)).toEqual([])
    expect(prose.filter((line) => line.split("`").length % 2 === 0)).toEqual([])
  })

  it("is formatted with Prettier", async () => {
    const options = await resolveConfig(fileURLToPath(SKILL_URL))
    expect(await format(text, { ...options, parser: "markdown" })).toBe(text)
  })
})

describe("the core guide (operate guide)", () => {
  const lines = GUIDE.split("\n")

  it(`stays within ${MAX_CORE_LINES} lines`, () => {
    expect(lines.length).toBeLessThanOrEqual(MAX_CORE_LINES)
  })

  it("has the sections an agent needs, the topics last", () => {
    expect(GUIDE.startsWith("# operate: ")).toBe(true)
    expect(lines.filter((line) => line.startsWith("## "))).toEqual([
      "## Setup",
      "## Discover, describe, preview, run",
      "## Workflow commands",
      "## Invocation conventions",
      "## Output",
      "## Errors and exit codes",
      "## Safety",
      "## Topics",
    ])
  })

  it("ends with the index of every topic, one line each", () => {
    const topics = GUIDE.slice(GUIDE.indexOf("## Topics"))
    expect(topics).toContain("`operate guide <topic>`")
    expect(topics).toContain("`operate guide --list`")
    for (const topic of GUIDE_TOPICS) {
      expect(topics).toContain(`\n- \`${topic.name}\`: ${topic.summary}\n`)
    }
  })

  it("names the supported engines, the setup and how to run operate without installing it", () => {
    expectAll(GUIDE, [
      "Operaton",
      "CIB seven",
      "Camunda 7",
      "OPERATE_URL",
      "operate config set",
      "operate ping",
      "`npx -y @miragon/operate` in its place",
      "`npm i -g @miragon/operate`",
      "flag > environment variable > profile > default",
    ])
  })

  it("keeps a shell URL away from the profiles: it would override them, credentials included", () => {
    const start = GUIDE.indexOf("\n## Setup\n")
    const setup = GUIDE.slice(start, GUIDE.indexOf("\n## ", start + 1))
    expect(setup).toContain("`--url` and `OPERATE_URL` override")
    expect(setup).toContain("its credentials go along")
    const unset = setup.indexOf("\nunset OPERATE_URL\n")
    expect(unset).toBeGreaterThan(setup.indexOf("\nexport OPERATE_URL="))
    expect(unset).toBeLessThan(setup.indexOf("\noperate ping --profile prod\n"))
  })

  it("says how to read a topic with an operate older than the skill", () => {
    expect(GUIDE).toContain("\"Too many arguments for 'guide'\"")
    expect(GUIDE).toContain("`npx -y @miragon/operate@latest guide <topic>`")
  })

  it("keeps discover, describe, preview, run and the dev loop of the workflow commands", () => {
    expectAll(GUIDE, [
      "Never guess commands or flags",
      "operate commands --search",
      "operate describe process-definition start",
      "--dry-run",
      "instead of `sleep`",
      "exit code 9, which still prints the view",
      ...["inspect", "wait", "advance", "retry", "deploy", "status"].map(
        (name) => `operate ${name}`,
      ),
    ])
    expect(GUIDE).toContain(
      [
        "operate deploy bpmn --start --business-key B-1 --var amount=250",
        "operate inspect --business-key B-1",
        "operate advance --business-key B-1 --var approved=true --wait",
        "operate retry --business-key B-1 --now",
        "operate wait --business-key B-1 --until ended",
        "operate status",
      ].join("\n"),
    )
  })

  it("keeps the conventions in brief and points to the topics for the details", () => {
    expectAll(GUIDE, [
      "`businessKey` → `--business-key`",
      "--var name=value",
      "name:Type=value",
      "--body @file.json",
      "--all",
      "Done: <METHOD> <path>",
      ...GUIDE_TOPICS.filter((topic) => topic.name !== "recipes").map(
        (topic) => `\`operate guide ${topic.name}\``,
      ),
    ])
  })

  it("documents every exit code, how to read errors and the safety rules", () => {
    for (const code of Object.values(EXIT_CODES)) {
      expect(GUIDE).toMatch(new RegExp(`^\\| ${code} +\\| \\S`, "m"))
    }
    expectAll(GUIDE, [
      "Read `hint` first",
      "HTTP_REDIRECT",
      "engineMessage",
      "LOGIN_REQUIRED",
      "LOGIN_FAILED",
      "TOKEN_EXPIRED",
      "--yes",
      "CONFIRMATION_REQUIRED",
      "READ_ONLY",
      "OPERATE_READ_ONLY",
    ])
  })
})

describe("the topics (operate guide <topic>)", () => {
  it("have unique lowercase names, one-line summaries and a title naming their command", () => {
    const names = GUIDE_TOPICS.map((topic) => topic.name)
    expect(new Set(names).size).toBe(names.length)
    for (const topic of GUIDE_TOPICS) {
      expect(topic.name).toMatch(/^[a-z]+(?:-[a-z]+)*$/)
      expect(topic.summary).toMatch(/^\S[^\n]{10,85}[^.\s]$/)
      expect(topic.text.startsWith(`# operate guide ${topic.name}: `)).toBe(true)
      expect(findGuideTopic(topic.name)).toBe(topic)
    }
    expect(findGuideTopic("core")).toBeUndefined()
  })

  it.each(GUIDE_TOPICS.map((topic) => [topic.name, topic.text] as const))(
    `%s stays within ${MAX_TOPIC_LINES} lines and has command lines`,
    (_, text) => {
      expect(text.split("\n").length).toBeLessThanOrEqual(MAX_TOPIC_LINES)
      expect(text).toMatch(/```sh\n(?:.*\n)*?operate /)
    },
  )

  it("workflow: selection, options and the rules agents need", () => {
    expectAll(topicText("workflow"), [
      "--business-key <key>",
      "--process-definition-key <key> --latest",
      "--history",
      "--wait-timeout",
      "--batch <id>",
      "--execute-jobs",
      "external task (locked first)",
      "--bpmn-error <code>",
      "--fail <message>",
      "--now",
      "needs `--yes`",
      "--start-key <key>",
      "--fail-on warning|critical",
      "instead of `sleep`",
      "`advance` needs `--activity-id`",
      "still send their reads",
      "Exit code 9",
      "still prints the view",
    ])
  })

  it("input: arguments, booleans, arrays, dates, variables, bodies, files and global options", () => {
    expectAll(topicText("input"), [
      "operate process-instance get-variable <id> <var-name>",
      "`--no-with-incident` sends `false`",
      "--process-instance-ids a,b --process-instance-ids c",
      "2024-05-01T10:00:00.000+0200",
      "Times without an offset are UTC",
      `default ${DEFAULT_PAGE_SIZE}`,
      "name:Type=value",
      "--local-var",
      "--triggered-scope-var",
      "--value <raw>",
      "--body -",
      "--body @file.json",
      "flags win, `--var` entries win per name",
      "--no-validate",
      "--base-dir <dir>",
      "--data <path>",
    ])
  })

  it("output: formats, projection, non-JSON responses, previews and traces", () => {
    expectAll(topicText("output"), [
      "--pretty",
      "lists the existing fields",
      "-o table",
      "2^53",
      "raw XML",
      "--out-file <path>",
      '{"outFile", "bytes", "contentType"}',
      "Done: <METHOD> <path> → 204 No Content",
      "`curl`",
      "--verbose",
      "--show-secrets",
    ])
  })

  it("config: profiles, the config file, the environment, engines and headers", () => {
    expectAll(topicText("config"), [
      "operate config set local --url http://localhost:8080/engine-rest --default",
      "operate config show --profile prod",
      "operate config path",
      "--config <path>",
      "config set` creates it",
      "only formats the output",
      "--engine <name>",
      "OPERATE_HEADERS",
      "OPERATE_TOKEN",
      "OPERATE_OAUTH_*",
      "read-only profiles",
    ])
  })

  it("auth: Basic auth, bearer tokens and OAuth without logging in itself", () => {
    expectAll(topicText("auth"), [
      "OPERATE_USERNAME",
      "OPERATE_PASSWORD",
      "--auth-password-env <VAR>",
      "OPERATE_AUTH=none",
      "--auth-token-env <VAR>",
      "TOKEN_EXPIRED",
      "OPERATE_OAUTH_*",
      "operate auth login --profile <name>",
      "Never run `auth login` yourself",
      "LOGIN_REQUIRED",
      "operate auth status",
      "`UNAUTHORIZED`/`FORBIDDEN` despite a login",
      "do not ask for a new login",
      "--show-secrets",
    ])
  })

  it("recipes: everyday tasks, incidents and raw requests", () => {
    expectAll(topicText("recipes"), [
      "The worker id must match the one that locked the task",
      "`incident resolve` only resolves custom incidents",
      "operate api GET",
      "The effect is taken from the matching catalog operation (the query\n`POST /process-instance` is a read)",
    ])
  })
})

describe("all guide pages together", () => {
  it("mention every global option and every variable type", () => {
    for (const flag of GLOBAL_FLAGS.filter((name) => name !== "help")) {
      expect(ALL).toContain(`--${flag}`)
    }
    for (const type of VARIABLE_TYPES) {
      expect(ALL).toMatch(new RegExp(`\\b${type}\\b`))
    }
  })

  it("point only to topics that exist", () => {
    // `operate guide <name>` in prose is not checked by the command line tests
    const named = [...ALL.matchAll(/`operate guide ([a-z][a-z-]*)`/g)].map((match) => match[1]!)
    expect(named).toContain("config")
    for (const name of named) expect(findGuideTopic(name), name).toBeDefined()
  })

  it("know that Basic auth and OAuth are built in", () => {
    // no workaround header and no links to their issues
    expect(ALL).not.toContain("https://github.com/Miragon/operate/issues/1")
    expect(ALL).not.toContain("https://github.com/Miragon/operate/issues/2")
    expect(ALL).not.toContain("planned")
    expect(ALL).not.toContain("Authorization: Basic")
  })
})

describe("topicSuggestions", () => {
  it("suggests close spellings, else topics whose name or summary has the word", () => {
    expect(topicSuggestions("oauth")).toEqual(["auth"])
    expect(topicSuggestions("recipe")).toEqual(["recipes"])
    expect(topicSuggestions("bearer")).toEqual(["auth"])
    expect(topicSuggestions("Dates")).toEqual(["input"])
    expect(topicSuggestions("variables")).toEqual(["input", "config"])
    expect(topicSuggestions("profiles")).toEqual(["config"])
    expect(topicSuggestions("xy")).toEqual([])
    expect(topicSuggestions("kubernetes")).toEqual([])
  })

  it("only suggests existing topics", () => {
    const names = GUIDE_TOPICS.map((topic) => topic.name)
    fc.assert(
      fc.property(fc.string({ maxLength: 20 }), (word) => {
        for (const name of topicSuggestions(word)) expect(names).toContain(name)
      }),
    )
  })
})

describe("docs/agents.md", () => {
  it("points agents to the core guide, its topics and --list", () => {
    expect(AGENTS_PAGE.startsWith("# Using operate from AI agents\n")).toBe(true)
    expectAll(AGENTS_PAGE, [
      "`operate guide`",
      "`operate guide <topic>`",
      "`operate guide --list`",
      ...GUIDE_TOPICS.map((topic) => `\`${topic.name}\``),
    ])
  })
})

describe("README", () => {
  it("points agents to the guide and to docs/agents.md", () => {
    expectAll(README, ["`operate guide`", "(docs/agents.md)"])
  })
})

describe("skills/operate/SKILL.md", () => {
  const match = FRONTMATTER.exec(SKILL)

  it("has a YAML frontmatter with name and description", () => {
    expect(match).not.toBeNull()
    const frontmatter = match![1]!.split("\n")
    expect(frontmatter[0]).toBe("name: operate")
    expect(frontmatter).toHaveLength(2)
    const description = frontmatter[1]!
    expect(description).toMatch(/^description: \S/)
    for (const text of [
      "Camunda 7",
      "Operaton",
      "CIB seven",
      "REST API",
      "external tasks",
      "incidents",
      "workflow commands",
    ]) {
      expect(description).toContain(text)
    }
    expect(description.slice("description: ".length)).not.toMatch(/: |^['"]/)
  })

  it("is followed by exactly the core guide with its topic index", () => {
    expect(match![2]).toBe(GUIDE)
  })
})
