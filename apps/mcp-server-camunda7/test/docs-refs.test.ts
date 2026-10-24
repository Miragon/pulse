import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { EXPECTED_TOOLS_ADMIN } from "./expected-tools.js"
import { REPO_ROOT } from "./source-scan.js"

/**
 * Docs and skills say what the code does (#345). A skill an agent follows
 * writes the code it shows, so a stale name there lands in the next change.
 * This guard reads every backticked reference in the docs, the READMEs, the
 * agent files and the skills (isCheckedDoc below) and checks it against the
 * repo: tool names against the full surface, repo paths against the tree
 * (from the repo root, in a nested file too), the identifiers of the skills
 * and of the nested agent files against the sources and the toolkit/mcp-use
 * typings, and each page of the docs site (every Markdown file under docs/,
 * built by VitePress to https://miragon.github.io/pulse/) against its line
 * budget (DOCS_BUDGETS below, keyed by the path under docs/).
 *
 * The product page https://miragon.ai/tools/pulse/ is built from
 * Miragon/miragon-ai-docs, which checks its own tool names against this repo
 * (scripts/check-miragon-ai-refs.mjs there).
 */

const TEMPLATE_ROOT = path.join(REPO_ROOT, "templates", "composed-server")

/** A directory's entries; one that is gone (never there, or removed mid-walk) has none. */
function entriesOf(dir: string): fs.Dirent[] {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return []
    throw error
  }
}

/**
 * Every file under `dir` that `keep` accepts (the identifier corpus). It
 * skips node_modules BEFORE descending: a recursive readdir lists every
 * workspace symlink's target first, so a sibling package's coverage run that
 * removed its coverage/.tmp meanwhile failed the walk with ENOENT. A folder
 * removed mid-walk outside node_modules (a package's own coverage/.tmp) holds
 * no doc or source to read and is skipped the same way.
 */
const walk = (dir: string, keep: (file: string) => boolean): string[] =>
  entriesOf(dir).flatMap((entry) => {
    if (entry.name === "node_modules") return []
    const file = path.join(dir, entry.name)
    if (entry.isDirectory()) return walk(file, keep)
    return keep(file) && fs.statSync(file, { throwIfNoEntry: false })?.isFile() ? [file] : []
  })

/** The docs pages: the Markdown in docs/, not the VitePress config, theme or build output. */
const isDocsPage = (rel: string) =>
  rel.startsWith("docs/") && rel.endsWith(".md") && !rel.split("/").includes(".vitepress")

/** The house skills and the template's. */
const isSkill = (rel: string) =>
  /^(?:templates\/composed-server\/)?\.claude\/skills\/.*SKILL\.md$/.test(rel)

/**
 * An agent file below the root: a CLAUDE.md or AGENTS.md anywhere under apps/
 * or packages/. Like the skills, it tells an agent what to write, so its
 * identifiers are checked too. The root CLAUDE.md is not one: it names
 * Gradle, pnpm, docs-kit and release tooling terms that no source here
 * declares.
 */
const isNestedAgentFile = (rel: string) =>
  /^(?:apps|packages)\/(?:.+\/)?(?:CLAUDE|AGENTS)\.md$/.test(rel)

/**
 * The Markdown this guard reads (`rel` is a repo-relative POSIX path): the
 * root README.md and CLAUDE.md, the docs pages, every package's README.md and
 * agent files, every Markdown file of an app (its READMEs, agent files, ADRs,
 * shipped skills, store listing), the template's README.md and CLAUDE.md and
 * the skills. Never node_modules, and never a CHANGELOG.md: release-please
 * writes it and quotes old commit text.
 */
function isCheckedDoc(rel: string): boolean {
  const parts = rel.split("/")
  if (parts.includes("node_modules") || parts.at(-1) === "CHANGELOG.md") return false
  return (
    rel === "README.md" ||
    rel === "CLAUDE.md" ||
    isDocsPage(rel) ||
    /^packages\/.*(?:README|CLAUDE|AGENTS)\.md$/.test(rel) ||
    /^apps\/.*\.md$/.test(rel) ||
    rel === "templates/composed-server/README.md" ||
    rel === "templates/composed-server/CLAUDE.md" ||
    isSkill(rel)
  )
}

/**
 * The checked docs of the repo at `root`: what git tracks or would add
 * (committed, staged, or new and not ignored), so a gitignored download or
 * build output (a VS Code test install with its bundled extensions' READMEs)
 * is never read. The GIT_* variables a hook may set are dropped, so `root`
 * alone decides the repository.
 */
function checkedDocs(root: string): string[] {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !name.startsWith("GIT_")),
  )
  return execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], {
    cwd: root,
    env,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  })
    .split("\0")
    .filter((rel) => rel !== "" && isCheckedDoc(rel))
    .filter(
      (rel) => fs.statSync(path.join(root, rel), { throwIfNoEntry: false })?.isFile() === true,
    )
}

const docFiles = checkedDocs(REPO_ROOT)
const skillFiles = docFiles.filter(isSkill)
const agentFiles = docFiles.filter(isNestedAgentFile)
const docsPages = docFiles.filter(isDocsPage)

interface Ref {
  file: string
  line: number
  token: string
}

/** Every inline-code token (`…`) with its file and line; fenced blocks are code, read separately. */
function backticked(file: string): Ref[] {
  const refs: Ref[] = []
  let fenced = false
  fs.readFileSync(path.join(REPO_ROOT, file), "utf8")
    .split("\n")
    .forEach((text, index) => {
      if (/^\s*```/.test(text)) fenced = !fenced
      if (fenced) return
      for (const match of text.matchAll(/`([^`\n]+)`/g)) {
        refs.push({ file, line: index + 1, token: match[1] ?? "" })
      }
    })
  return refs
}

const where = (ref: Ref) => `${ref.file}:${ref.line} \`${ref.token}\``

describe("tool names in the docs", () => {
  const tools = new Set(EXPECTED_TOOLS_ADMIN)
  // A short form (`show_process_list`, `bpmn_heatmap_data`) names the module's tool.
  const known = (name: string) =>
    tools.has(name) || tools.has(`camunda7_${name}`) || tools.has(`analytics_${name}`)
  const looksLikeTool = (token: string) =>
    /^[a-z0-9]+(?:_[a-z0-9]+)+$/.test(token) &&
    (/^(?:camunda7|analytics)_/.test(token) ||
      /(?:^|_)show_/.test(token) ||
      token.endsWith("_data"))

  // The template's docs also name its own module's tools (`notes_show_notes`),
  // which its own suite checks; here only the shipped modules' names count.
  const checked = (ref: Ref) =>
    ref.file.startsWith("templates/") ? /^(?:camunda7|analytics)_/.test(ref.token) : true

  it("names only tools the server registers", () => {
    const stale = docFiles
      .flatMap(backticked)
      .filter((ref) => looksLikeTool(ref.token) && checked(ref) && !known(ref.token))
    expect(stale.map(where)).toEqual([])
  })
})

describe("repo paths in the docs", () => {
  const ROOTS =
    /^(?:apps|packages|docs|scripts|playground|engine-plugins|templates|\.claude|\.github)\//
  // Written by a build or a test run, not checked in.
  const GENERATED = /(?:^|\/)(?:dist|test-results|node_modules|generated-sources)(?:\/|$)/
  const pathOf = (token: string) => token.replace(/:\d+(?:-\d+)?$/, "").replace(/\/$/, "")
  const isPath = (token: string) =>
    ROOTS.test(token) && !/\.\.\.|[*<>{}\s|]/.test(token) && !GENERATED.test(token)

  it("cites only files and directories that exist", () => {
    const missing = docFiles
      .flatMap(backticked)
      .filter((ref) => isPath(ref.token))
      .filter((ref) => {
        const target = pathOf(ref.token)
        // The template's own docs cite paths inside the template first.
        const fromTemplate = ref.file.startsWith("templates/composed-server/")
        return !(
          fs.existsSync(path.join(REPO_ROOT, target)) ||
          (fromTemplate && fs.existsSync(path.join(TEMPLATE_ROOT, target)))
        )
      })
    expect(missing.map(where)).toEqual([])
  })
})

describe("identifiers in the skills and the nested agent files", () => {
  // The app's own copies: the versions the skills' code compiles against.
  const packageDir = (name: string) =>
    fs.realpathSync(path.join(import.meta.dirname, "..", "node_modules", name))
  const isSource = (file: string) => /\.(?:tsx?|mts|mjs|cjs|kt)$/.test(file)
  const corpus = [
    ...["apps", "packages", "scripts", "templates", "engine-plugins"].flatMap((dir) =>
      walk(path.join(REPO_ROOT, dir), isSource),
    ),
    ...["@miragon/mcp-toolkit-core", "@miragon/mcp-toolkit-ui", "mcp-use"].flatMap((name) =>
      walk(path.join(packageDir(name), "dist"), (file) => file.endsWith(".d.ts")),
    ),
  ]
  const words = new Set(
    corpus.flatMap((file) => fs.readFileSync(file, "utf8").match(/[A-Za-z_$][\w$]*/g) ?? []),
  )
  // A camelCase or PascalCase name, optionally called: `useResetOnChange(…)`.
  const identifierOf = (token: string) =>
    /^([a-z]+[A-Z]\w*|[A-Z][a-z]+[A-Z]\w*)(?:\(.*\))?$/.exec(token)?.[1]
  // Names a skill invents for the reader's own code.
  const PLACEHOLDER = /Xyz|Your[A-Z]|My[A-Z]|^my[A-Z]|Foo|Example/
  // Skills that teach no code of this repo: shadcn's is vendored (its own
  // components and CLI), create-ticket names the agent's tools.
  const NOT_REPO_CODE = new Set(["shadcn", "create-ticket"])
  const teachesRepoCode = (file: string) => !NOT_REPO_CODE.has(path.basename(path.dirname(file)))

  it("name only functions, hooks and types that exist", () => {
    const unknown = [...skillFiles.filter(teachesRepoCode), ...agentFiles]
      .flatMap(backticked)
      .filter((ref) => {
        const name = identifierOf(ref.token)
        return name !== undefined && !PLACEHOLDER.test(name) && !words.has(name)
      })
    expect(unknown.map(where)).toEqual([])
  })
})

/**
 * The pages in docs/ and their line budgets, keyed by the path under docs/
 * (`cli/index.md` for docs/cli/index.md): a page that outgrows its budget
 * condenses. index.md is the site's home, README.md the index on GitHub.
 */
const DOCS_BUDGETS: Record<string, number> = {
  "index.md": 40,
  "README.md": 40,
  "getting-started.md": 60,
  "architecture.md": 150,
  "developer.md": 80,
  "operations.md": 120,
  "usage.md": 150,
}

/** A page's budget key: its path under docs/, so docs/index.md and docs/cli/index.md differ. */
const pageKey = (rel: string) => rel.slice("docs/".length)

/** The pages without a budget and the budgets without a page, both as keys. */
function budgetMismatch(pages: readonly string[], budgets: Readonly<Record<string, number>>) {
  const keys = pages.map(pageKey)
  return {
    unbudgeted: keys.filter((key) => !Object.hasOwn(budgets, key)).sort(),
    stale: Object.keys(budgets)
      .filter((key) => !keys.includes(key))
      .sort(),
  }
}

/** A page's length in lines; a final newline ends the last line and adds none. */
const lineCount = (text: string) => text.replace(/\n$/, "").split("\n").length

describe("docs page budgets", () => {
  it("every page in docs/ has a budget", () => {
    const { unbudgeted, stale } = budgetMismatch(docsPages, DOCS_BUDGETS)
    expect([
      ...unbudgeted.map(
        (key) =>
          `docs/${key} has no line budget: add "${key}": <lines> to DOCS_BUDGETS ` +
          "(keyed by the path under docs/)",
      ),
      ...stale.map((key) => `DOCS_BUDGETS names ${key}, which is no page in docs/: drop the entry`),
    ]).toEqual([])
  })

  it.each(Object.entries(DOCS_BUDGETS))("%s stays within %i lines", (page, lines) => {
    const text = fs.readFileSync(path.join(REPO_ROOT, "docs", page), "utf8")
    expect(lineCount(text)).toBeLessThanOrEqual(lines)
  })
})

describe("what the guard reads", () => {
  it.each([
    "README.md",
    "CLAUDE.md",
    "docs/index.md",
    "docs/README.md",
    "docs/cli/index.md",
    "docs/vscode/getting-started.md",
    "packages/core/widget-shell/README.md",
    "packages/connectors/camunda/camunda7-domain/README.md",
    "packages/connectors/camunda/camunda7-domain/CLAUDE.md",
    "packages/connectors/camunda/camunda7-domain/AGENTS.md",
    "apps/mcp-server-camunda7/README.md",
    "apps/mcp-server-camunda7/test-host/README.md",
    "apps/cli/README.md",
    "apps/cli/CLAUDE.md",
    "apps/vscode/AGENTS.md",
    "apps/vscode/CLAUDE.md",
    "apps/vscode/docs/adr/writes.md",
    "apps/vscode/MARKETPLACE.md",
    "apps/cli/skills/pulse-cli/SKILL.md",
    "apps/cli/skills/pulse-cli/commands/status.md",
    ".claude/skills/add-bpm-feature/SKILL.md",
    ".claude/skills/shadcn/SKILL.md",
    "templates/composed-server/.claude/skills/add-widget/SKILL.md",
    "templates/composed-server/README.md",
    "templates/composed-server/CLAUDE.md",
  ])("reads %s", (rel) => {
    expect(isCheckedDoc(rel)).toBe(true)
  })

  it.each([
    "CHANGELOG.md",
    "apps/cli/CHANGELOG.md",
    "packages/core/widget-shell/CHANGELOG.md",
    "docs/.vitepress/miragon/README.md",
    "docs/node_modules/vitepress/README.md",
    "apps/vscode/node_modules/foo/README.md",
    "packages/core/widget-shell/node_modules/x/README.md",
    "packages/core/widget-shell/src/notes.md",
    "packages/connectors/camunda/camunda7-connector/src/messages/GLOSSARY.md",
    ".claude/skills/shadcn/rules/forms.md",
    "templates/composed-server/server/README.md",
    "engine-plugins/README.md",
    "TODOS.md",
    "apps/cli/README.txt",
  ])("leaves out %s", (rel) => {
    expect(isCheckedDoc(rel)).toBe(false)
  })

  it("checks the identifiers of the agent files under apps/ and packages/, not the root's", () => {
    const nested = [
      "apps/cli/CLAUDE.md",
      "apps/vscode/AGENTS.md",
      "packages/connectors/camunda/camunda7-domain/AGENTS.md",
      "packages/core/widget-shell/CLAUDE.md",
    ]
    expect(nested.filter(isNestedAgentFile)).toEqual(nested)
    expect(
      [
        "CLAUDE.md",
        "AGENTS.md",
        "templates/composed-server/CLAUDE.md",
        "apps/cli/README.md",
        "apps/cli/skills/pulse-cli/SKILL.md",
      ].filter(isNestedAgentFile),
    ).toEqual([])
  })

  it("keys a page by its path under docs/, so two index.md pages get two budgets", () => {
    const pages = ["docs/index.md", "docs/README.md", "docs/cli/index.md", "docs/cli/commands.md"]
    expect(pages.map(pageKey).sort()).toEqual([
      "README.md",
      "cli/commands.md",
      "cli/index.md",
      "index.md",
    ])
    expect(budgetMismatch(pages, { "index.md": 40, "README.md": 40 })).toEqual({
      unbudgeted: ["cli/commands.md", "cli/index.md"],
      stale: [],
    })
    expect(
      budgetMismatch(pages, {
        "index.md": 40,
        "README.md": 40,
        "cli/index.md": 40,
        "cli/commands.md": 60,
        "cli/gone.md": 20,
      }),
    ).toEqual({ unbudgeted: [], stale: ["cli/gone.md"] })
    // A budget key inherited from Object.prototype is no budget.
    expect(budgetMismatch(["docs/constructor"], {}).unbudgeted).toEqual(["constructor"])
    expect(isDocsPage("docs/.vitepress/theme/notes.md")).toBe(false)
    expect(isDocsPage("docs/cli/index.md")).toBe(true)
    expect(isDocsPage("docs/package.json")).toBe(false)
  })

  it("counts a page's lines without the final newline", () => {
    const page = (lines: number) =>
      `${Array.from({ length: lines }, (_, i) => `line ${i}`).join("\n")}\n`
    expect(lineCount(page(40))).toBe(40)
    expect(lineCount(page(40)) <= 40).toBe(true)
    expect(lineCount(page(41)) <= 40).toBe(false)
    expect(lineCount("one\ntwo")).toBe(2)
  })

  describe("in a git checkout", () => {
    const roots: string[] = []
    afterEach(() => {
      for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
    })

    it("reads what git tracks or would add, never an ignored download or build output", () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), "docs-refs-"))
      roots.push(root)
      const files: Record<string, string> = {
        ".gitignore": ".vscode-test/\nout/\n",
        "README.md": "root",
        "apps/vscode/README.md": "extension",
        "apps/vscode/.vscode-test/extensions/git/README.md": "VS Code's own",
        "apps/vscode/out/README.md": "build output",
        "apps/vscode/CHANGELOG.md": "release notes",
        "apps/vscode/src/notes.md": "an ADR next to the code",
      }
      for (const [rel, text] of Object.entries(files)) {
        fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true })
        fs.writeFileSync(path.join(root, rel), text)
      }
      const env = Object.fromEntries(
        Object.entries(process.env).filter(([name]) => !name.startsWith("GIT_")),
      )
      execFileSync("git", ["init", "--quiet"], { cwd: root, env })
      expect(checkedDocs(root).sort()).toEqual([
        "README.md",
        "apps/vscode/README.md",
        "apps/vscode/src/notes.md",
      ])
    })
  })

  it("reads the repo's docs, READMEs, agent files and skills (the scanner is not blind)", () => {
    expect(docFiles).toEqual(
      expect.arrayContaining([
        "README.md",
        "CLAUDE.md",
        "docs/index.md",
        "packages/core/widget-shell/README.md",
        "apps/mcp-server-camunda7/README.md",
        "apps/mcp-server-camunda7/test-host/README.md",
        "templates/composed-server/CLAUDE.md",
        ".claude/skills/add-bpm-feature/SKILL.md",
        "templates/composed-server/.claude/skills/setup-server/SKILL.md",
      ]),
    )
    expect(docFiles.length).toBeGreaterThanOrEqual(28)
    expect(skillFiles.length).toBeGreaterThanOrEqual(10)
    expect(docsPages.map(pageKey)).toContain("index.md")
  })
})
