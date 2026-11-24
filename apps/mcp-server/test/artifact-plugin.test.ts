import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { isModelVisible, toolNamesIn, type WireTool } from "./golden.js"

/**
 * The Claude Code plugin pulse-artifact: a skill for Claude artifacts on Pulse (live pages in
 * claude.ai that read an engine through the Pulse MCP server). Its root is the skill directory
 * skills/pulse-artifact, as the CLI's pulse-cli is, so it holds no package.json (Claude Code
 * would install its dependencies into the plugin); .claude-plugin/plugin.json carries this app's
 * version and release-please bumps it with the app; the repository's marketplace
 * (.claude-plugin/marketplace.json) lists it. The skill teaches the template
 * templates/claude-artifact, which an installed plugin does not hold, so it names its GitHub URL
 * too, and it names only tools a page may call: model tools of the read-only floor.
 */

const REPO_ROOT = path.join(import.meta.dirname, "..", "..", "..")
const PLUGIN_DIR = "apps/mcp-server/skills/pulse-artifact"
const TEMPLATE = "templates/claude-artifact"
const TEMPLATE_URL = `https://github.com/Miragon/pulse/tree/main/${TEMPLATE}`

const read = (rel: string) => fs.readFileSync(path.join(REPO_ROOT, rel), "utf8")
const exists = (rel: string) => fs.existsSync(path.join(REPO_ROOT, rel))

interface PluginManifest {
  readonly name: string
  readonly version: string
  readonly description: string
  readonly author: { readonly name: string; readonly url: string }
  readonly homepage: string
  readonly repository: string
  readonly license: string
  readonly keywords: readonly string[]
}

interface ExtraFile {
  readonly type: string
  readonly path: string
  readonly jsonpath?: string
}

const PLUGIN_TEXT = read(`${PLUGIN_DIR}/.claude-plugin/plugin.json`)
const PLUGIN = JSON.parse(PLUGIN_TEXT) as PluginManifest
const APP = JSON.parse(read("apps/mcp-server/package.json")) as {
  readonly version: string
  readonly license: string
}
const SKILL = read(`${PLUGIN_DIR}/SKILL.md`)

/** Every Markdown file of the plugin that a session reads: the skill and its references. */
const SKILL_FILES = [
  `${PLUGIN_DIR}/SKILL.md`,
  ...fs
    .readdirSync(path.join(REPO_ROOT, PLUGIN_DIR, "references"))
    .filter((name) => name.endsWith(".md"))
    .map((name) => `${PLUGIN_DIR}/references/${name}`),
]

const READ_ONLY_FLOOR = JSON.parse(
  read("apps/mcp-server/test/__golden__/tools-read-only.json"),
) as WireTool[]

/** The string literals of the template's `PAGE_TOOLS`: every tool its page calls. */
function pageTools(): string[] {
  const source = read(`${TEMPLATE}/src/engine/tools.ts`)
  const list = /export const PAGE_TOOLS = \[([^\]]*)\]/.exec(source)?.[1]
  if (list === undefined) throw new Error(`${TEMPLATE}/src/engine/tools.ts declares no PAGE_TOOLS`)
  return [...list.matchAll(/"([a-z0-9_]+)"/g)].map((match) => match[1] ?? "")
}

describe(`${PLUGIN_DIR}/.claude-plugin/plugin.json`, () => {
  it("has the version of the MCP server app", () => {
    expect(PLUGIN.version).toBe(APP.version)
  })

  it("is bumped by release-please together with the app", () => {
    const config = JSON.parse(read("release-please-config.json")) as {
      readonly packages: Record<string, { readonly "extra-files"?: readonly ExtraFile[] }>
    }
    expect(config.packages["."]?.["extra-files"]).toContainEqual({
      type: "json",
      path: `${PLUGIN_DIR}/.claude-plugin/plugin.json`,
      jsonpath: "$.version",
    })
  })

  it("is formatted the way release-please writes it (JSON.stringify, two spaces)", () => {
    expect(PLUGIN_TEXT).toBe(`${JSON.stringify(PLUGIN, null, 2)}\n`)
  })

  it("names the plugin pulse-artifact, its docs page and the repository", () => {
    expect(PLUGIN.name).toBe("pulse-artifact")
    expect(PLUGIN.author.name).toBe("Miragon GmbH")
    expect(PLUGIN.homepage).toBe("https://miragon.github.io/pulse/mcp/claude-artifacts")
    expect(PLUGIN.repository).toBe("https://github.com/Miragon/pulse")
    expect(PLUGIN.license).toBe(APP.license)
    for (const text of ["Claude artifacts", "Camunda 7", "Operaton", "CIB seven", "MCP server"]) {
      expect(PLUGIN.description).toContain(text)
    }
  })
})

describe(`the plugin root ${PLUGIN_DIR}`, () => {
  it("holds the skill and no package.json, so Claude Code installs no dependencies into it", () => {
    expect(exists(`${PLUGIN_DIR}/SKILL.md`)).toBe(true)
    expect(exists(`${PLUGIN_DIR}/package.json`)).toBe(false)
    // a skills/ folder beside a root SKILL.md would hide the root skill
    expect(exists(`${PLUGIN_DIR}/skills`)).toBe(false)
  })

  it("is listed in the repository's marketplace from this directory", () => {
    const marketplace = JSON.parse(read(".claude-plugin/marketplace.json")) as {
      readonly plugins: readonly { readonly name: string; readonly source: string }[]
    }
    const entry = marketplace.plugins.find((plugin) => plugin.name === PLUGIN.name)
    expect(entry?.source).toBe(`./${PLUGIN_DIR}`)
    expect(exists(entry?.source ?? "")).toBe(true)
  })
})

describe(`${PLUGIN_DIR}/SKILL.md`, () => {
  const frontmatter = /^---\n([\s\S]*?)\n---\n/.exec(SKILL)?.[1]?.split("\n") ?? []

  it("has exactly a name and a one-line description that YAML reads as a plain scalar", () => {
    expect(frontmatter).toHaveLength(2)
    expect(frontmatter[0]).toBe("name: pulse-artifact")
    const description = frontmatter[1] ?? ""
    expect(description.startsWith("description: ")).toBe(true)
    const text = description.slice("description: ".length)
    // a quote, an indicator or a ": " inside would make YAML read another value, or fail
    expect(text).not.toMatch(/^["'`[{>|*&!%@#-]/)
    expect(text).not.toContain(": ")
    expect(text).not.toContain(" #")
    for (const words of ["Claude artifact", "Pulse MCP server", "dashboard"]) {
      expect(text).toContain(words)
    }
  })

  it("links the template by its repository path and by its URL", () => {
    expect(SKILL).toContain(`\`${TEMPLATE}\``)
    expect(SKILL).toContain(TEMPLATE_URL)
    expect(exists(TEMPLATE)).toBe(true)
  })

  it("names every reference it ships, and ships every reference it names", () => {
    const named = [...SKILL.matchAll(/`(references\/[\w.-]+\.md)`/g)].map((match) => match[1])
    const shipped = SKILL_FILES.filter((file) => file.includes("/references/")).map((file) =>
      file.slice(PLUGIN_DIR.length + 1),
    )
    expect([...new Set(named)].sort()).toEqual([...shipped].sort())
  })
})

describe("the tools the skill names", () => {
  const floor = new Map(READ_ONLY_FLOOR.map((tool) => [tool.name, tool]))

  // The generated component sheet carries the packages' JSDoc, written for their own readers.
  const written = SKILL_FILES.filter((file) => !file.endsWith("/references/components.md"))

  it("are model tools of the read-only floor, which every toolset serves", () => {
    const named = written.flatMap((file) => toolNamesIn(read(file)).map((name) => ({ file, name })))
    expect(named.length).toBeGreaterThan(0)
    const refused = named.filter(({ name }) => {
      const tool = floor.get(name)
      return tool === undefined || !isModelVisible(tool)
    })
    expect(refused).toEqual([])
  })

  it("include every tool the template's page calls, and the page calls only such tools", () => {
    const tools = pageTools()
    expect(tools.length).toBeGreaterThan(0)
    const recipes = written.map(read).join("\n")
    expect(tools.filter((name) => !toolNamesIn(recipes).includes(name))).toEqual([])
    const outside = tools.filter((name) => {
      const tool = floor.get(name)
      return tool === undefined || !isModelVisible(tool)
    })
    expect(outside).toEqual([])
  })
})

describe(`${PLUGIN_DIR}/evals`, () => {
  const EVALS = path.join(REPO_ROOT, PLUGIN_DIR, "evals")
  const cases = fs
    .readdirSync(EVALS, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== "results")
    .map((entry) => entry.name)

  it("asks when the skill loads and when it stays unloaded, each case with its graders", () => {
    const tags = cases.map((name) => {
      const prompt = fs.readFileSync(path.join(EVALS, name, "prompt.md"), "utf8")
      expect(prompt, name).toMatch(/^---\ndescription: .+\ntags: \[(?:no-)?trigger\]\n/)
      expect(fs.readdirSync(path.join(EVALS, name, "graders")).length, name).toBeGreaterThan(0)
      return /tags: \[(no-trigger|trigger)\]/.exec(prompt)?.[1]
    })
    expect(tags.filter((tag) => tag === "trigger").length).toBeGreaterThanOrEqual(3)
    expect(tags.filter((tag) => tag === "no-trigger").length).toBeGreaterThanOrEqual(2)
  })
})
