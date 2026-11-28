import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { isModelVisible, toolNamesIn, type WireTool } from "./golden.js"

/**
 * The Claude Code plugin pulse-artifact: a skill for Claude artifacts on Pulse (live pages in
 * claude.ai that read an engine through the Pulse MCP server). Its root is the skill directory
 * skills/pulse-artifact, as the CLI's pulse-cli is, so it holds no package.json (Claude Code
 * would install its dependencies into the plugin); .claude-plugin/plugin.json carries this app's
 * version and release-please bumps it with the app. The repository's marketplace
 * (.claude-plugin/marketplace.json) installs it from the tag of that release, which release-please
 * bumps too, so the skill a person installs is always the one of the tagged release whose template
 * it clones, never one on main that names what the release lacks. The skill starts a copy of the
 * template templates/claude-artifact, which an installed plugin does not hold, so it names its
 * GitHub URL at that tag too, and reaches this repository's content by no other ref; it hands over
 * to the copy's agent file (templates/claude-artifact/CLAUDE.md), which carries the rules in the
 * version the copy pins; both name only tools a page may call: model tools of the read-only floor.
 */

const REPO_ROOT = path.join(import.meta.dirname, "..", "..", "..")
const PLUGIN_DIR = "apps/mcp-server/skills/pulse-artifact"
const TEMPLATE = "templates/claude-artifact"
/** The repository the marketplace installs the plugin from, as a git URL. */
const REPOSITORY_GIT = "https://github.com/Miragon/pulse.git"
/** The copy's agent file the skill hands over to: the rules and the tools a page calls. */
const TEMPLATE_AGENT_FILE = `${TEMPLATE}/CLAUDE.md`

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
/** The tag of the release this plugin is: the one the marketplace installs it from. */
const TAG = `v${PLUGIN.version}`
const TEMPLATE_URL = `https://github.com/Miragon/pulse/tree/${TAG}/${TEMPLATE}`

/** Every Markdown file of the plugin a session reads: the skill and its references, if any. */
const REFERENCES = path.join(REPO_ROOT, PLUGIN_DIR, "references")
const SKILL_FILES = [
  `${PLUGIN_DIR}/SKILL.md`,
  ...(fs.existsSync(REFERENCES) ? fs.readdirSync(REFERENCES) : [])
    .filter((name) => name.endsWith(".md"))
    .map((name) => `${PLUGIN_DIR}/references/${name}`),
]
/** The skill and every file under its references/, whatever its kind and however deep. */
const SHIPPED_FILES = [
  `${PLUGIN_DIR}/SKILL.md`,
  ...(fs.existsSync(REFERENCES) ? fs.readdirSync(REFERENCES, { recursive: true }) : [])
    .map((name) => `${PLUGIN_DIR}/references/${String(name)}`)
    .filter((file) => fs.statSync(path.join(REPO_ROOT, file)).isFile()),
]

/** The characters that end a ref in a link: a path's `/`, a blank, an anchor, a query, a quote. */
const REF = String.raw`([^\s/)#?"'\x60<>]*)`
/** This repository in a URL, never a longer name (`Miragon/pulse-starter`). */
const REPOSITORY = String.raw`miragon\/pulse(?:\.git)?(?![\w.-])`

/**
 * Where `text` reaches this repository's content by another ref than the release `v<version>`,
 * one entry each: a GitHub link (tree, blob, raw), a raw.githubusercontent.com or jsDelivr link at
 * another ref or at none (jsDelivr's npm links of the Pulse libraries at another version), and a
 * `git clone` of the repository without `--branch v<version>`.
 */
function unpinnedRefs(text: string, version: string): string[] {
  const tag = `v${version}`
  const links: readonly (readonly [RegExp, string])[] = [
    [new RegExp(String.raw`github\.com\/miragon\/pulse\/(?:tree|blob|raw)\/${REF}`, "gi"), tag],
    [
      new RegExp(
        String.raw`raw\.githubusercontent\.com\/miragon\/pulse\/(?:refs\/tags\/)?${REF}`,
        "gi",
      ),
      tag,
    ],
    [new RegExp(String.raw`jsdelivr\.net\/gh\/${REPOSITORY}(?:@${REF})?`, "gi"), tag],
    [new RegExp(String.raw`jsdelivr\.net\/npm\/@miragon\/pulse-[\w-]+(?:@${REF})?`, "gi"), version],
  ]
  const found = links.flatMap(([link, ref]) =>
    [...text.matchAll(link)].filter((match) => match[1] !== ref).map((match) => match[0]),
  )
  const pinned = (words: readonly string[]) =>
    words.some((word, i) => (word === "--branch" || word === "-b") && words[i + 1] === tag) ||
    words.includes(`--branch=${tag}`)
  const clones = [...text.matchAll(/git clone\b[^\n]*/g)]
    .map((match) => match[0])
    .filter((line) => new RegExp(`github\\.com[/:]${REPOSITORY}`, "i").test(line))
    .filter((line) => !pinned(line.split(/\s+/)))
  return [...found, ...clones]
}

const READ_ONLY_FLOOR = JSON.parse(
  read("apps/mcp-server/test/__golden__/tools-read-only.json"),
) as WireTool[]

/** The template's file that declares `PAGE_TOOLS`, beside the other values a copy sets. */
const PAGE_CONFIG = `${TEMPLATE}/src/page.config.ts`

/** The string literals of the template's `PAGE_TOOLS`: every tool its page calls. */
function pageTools(): string[] {
  const source = read(PAGE_CONFIG)
  const list = /export const PAGE_TOOLS = \[([^\]]*)\]/.exec(source)?.[1]
  if (list === undefined) throw new Error(`${PAGE_CONFIG} declares no PAGE_TOOLS`)
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
})

describe("the marketplace's entry of pulse-artifact", () => {
  const marketplace = JSON.parse(read(".claude-plugin/marketplace.json")) as {
    readonly plugins: readonly { readonly name: string; readonly [key: string]: unknown }[]
  }
  const entry = marketplace.plugins.find((plugin) => plugin.name === PLUGIN.name)

  it("installs this directory from the tag of the release this plugin is", () => {
    expect(entry?.source).toEqual({
      source: "git-subdir",
      url: REPOSITORY_GIT,
      path: PLUGIN_DIR,
      ref: TAG,
    })
    expect(exists(PLUGIN_DIR)).toBe(true)
  })

  it("has its tag bumped by release-please with the release, the v kept", () => {
    // release-please's json updater replaces the version inside the value, so `v0.34.0` becomes
    // `v0.35.0`, and the merge of the Release PR names the tag its release creates.
    const config = JSON.parse(read("release-please-config.json")) as {
      readonly packages: Record<string, { readonly "extra-files"?: readonly ExtraFile[] }>
    }
    expect(config.packages["."]?.["extra-files"]).toContainEqual({
      type: "json",
      path: ".claude-plugin/marketplace.json",
      jsonpath: `$.plugins[?(@.name==='${PLUGIN.name}')].source.ref`,
    })
  })

  it("carries the plugin's description, which a listing shows before the plugin is fetched", () => {
    expect(entry?.description).toBe(PLUGIN.description)
  })

  it("names the release the skill clones and links, and reaches this repository by no other ref", () => {
    expect(SKILL).toContain(`--branch ${TAG} https://github.com/Miragon/pulse`)
    expect(SKILL).toContain(`/tree/${TAG}/`)
    const refused = SHIPPED_FILES.flatMap((file) =>
      unpinnedRefs(read(file), PLUGIN.version).map((ref) => `${file}: ${ref}`),
    )
    expect(refused).toEqual([])
    const versions = [...SKILL.matchAll(/@miragon\/pulse-[\w-]+@(\d+\.\d+\.\d+)/g)].map((m) => m[1])
    expect(new Set(versions)).toEqual(new Set([PLUGIN.version]))
  })

  it("refuses a link or a clone at another ref, and none at the tag, so the check above can fail", () => {
    const planted =
      "https://github.com/Miragon/pulse/tree/main/packages/core/ui#use-in-a-page-without-a-build, " +
      "and `git clone https://github.com/Miragon/pulse` (main)"
    expect(unpinnedRefs(planted, "0.34.0")).toEqual([
      "github.com/Miragon/pulse/tree/main",
      "git clone https://github.com/Miragon/pulse` (main)",
    ])
    const others = [
      "https://github.com/miragon/pulse/blob/v0.33.0/README.md",
      "https://raw.githubusercontent.com/Miragon/pulse/refs/heads/main/x.md",
      "https://cdn.jsdelivr.net/gh/Miragon/pulse/templates/x.js",
      "https://cdn.jsdelivr.net/gh/Miragon/pulse@main/x.js",
      "https://cdn.jsdelivr.net/npm/@miragon/pulse-ui@latest/dist/browser/pulse-ui.js",
      "https://cdn.jsdelivr.net/npm/@miragon/pulse-ui/dist/browser/pulse-ui.js",
      "git clone --depth 1 --branch v0.33.0 https://github.com/Miragon/pulse.git",
    ]
    for (const line of others) expect(unpinnedRefs(line, "0.34.0"), line).toHaveLength(1)
    const atTheTag = [
      "https://github.com/Miragon/pulse/tree/v0.34.0/templates/claude-artifact",
      "https://raw.githubusercontent.com/Miragon/pulse/refs/tags/v0.34.0/x.md",
      "https://cdn.jsdelivr.net/gh/Miragon/pulse@v0.34.0/x.js",
      "https://cdn.jsdelivr.net/npm/@miragon/pulse-ui@0.34.0/dist/browser/pulse-ui.js",
      "git clone --depth 1 --branch v0.34.0 https://github.com/Miragon/pulse",
      "git clone https://github.com/Miragon/pulse-starter and https://github.com/Miragon/pulse-starter/tree/main",
    ].join("\n")
    expect(unpinnedRefs(atTheTag, "0.34.0")).toEqual([])
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

  it("hands over to the copy's agent file, which the template holds", () => {
    expect(SKILL).toContain("`CLAUDE.md`")
    expect(exists(TEMPLATE_AGENT_FILE)).toBe(true)
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

  // The copy's agent file carries the data rules and the tool table the skill hands over.
  const written = [...SKILL_FILES, TEMPLATE_AGENT_FILE]

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

/** The template's page as it ships, which `pnpm build` copies into dist/index.html. */
const PAGE = `${TEMPLATE}/src/page.html`
/** Every host a page's markup names, by `https://`, `http://` or `//`, a stylesheet's too. */
const hostsIn = (html: string) =>
  [...html.matchAll(/(?:https?:)?\/\/([^/"'\s)]+)/gi)].map((match) => match[1] ?? "")

describe(`the template's page as it ships, ${PAGE}`, () => {
  it("links no font host, nor any other: it renders in the viewer's system font", () => {
    // Geist from Google Fonts is a copy's opt-in (the template's README, "Geist"), since it sends
    // every viewer's IP address to Google, and the copy's own bundle test lets that link through:
    // the page the template ships links none (owner decision 2026-11-26, N10 of #693).
    expect(hostsIn(read(PAGE))).toEqual([])
  })

  it("reads a host by a scheme or none, in a link or a stylesheet, so the check above can fail", () => {
    const geist =
      '<link rel="preconnect" href="https://fonts.googleapis.com" />\n' +
      "<style>@import url(//fonts.gstatic.com/s/geist.woff2);</style>\n" +
      '<link rel="stylesheet" href="HTTP://fonts.googleapis.com/css2?family=Geist" />'
    expect(hostsIn(geist)).toEqual([
      "fonts.googleapis.com",
      "fonts.gstatic.com",
      "fonts.googleapis.com",
    ])
  })
})
