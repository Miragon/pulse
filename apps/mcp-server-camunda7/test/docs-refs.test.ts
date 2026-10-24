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
 * typings (a nested agent file's also against its package's own
 * tsconfig*.json), and each page of the docs site (every Markdown file under docs/,
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
 * The files of the repo at `root` this guard reads: what git tracks or would
 * add (committed, staged, or new and not ignored), so a gitignored download or
 * build output (a VS Code test install with its bundled extensions' READMEs
 * and tsconfigs) is never read. The GIT_* variables a hook may set are
 * dropped, so `root` alone decides the repository.
 */
function listedFiles(root: string): string[] {
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
    .filter(
      (rel) =>
        rel !== "" &&
        fs.statSync(path.join(root, rel), { throwIfNoEntry: false })?.isFile() === true,
    )
}

/** The checked docs among the listed files of the repo at `root`. */
const checkedDocs = (root: string) => listedFiles(root).filter(isCheckedDoc)

// Skills that teach no code of this repo: shadcn's is vendored (its own
// components and CLI), create-ticket names the agent's tools.
const NOT_REPO_CODE = new Set(["shadcn", "create-ticket"])
const teachesRepoCode = (file: string) => !NOT_REPO_CODE.has(path.basename(path.dirname(file)))

/** The docs whose identifiers are checked: the skills that teach repo code and the nested agent files. */
const identifierDocs = (docs: readonly string[]) => [
  ...docs.filter(isSkill).filter(teachesRepoCode),
  ...docs.filter(isNestedAgentFile),
]

const repoFiles = listedFiles(REPO_ROOT)
const docFiles = repoFiles.filter(isCheckedDoc)
const skillFiles = docFiles.filter(isSkill)
const docsPages = docFiles.filter(isDocsPage)

interface Ref {
  file: string
  line: number
  token: string
}

/** Every inline-code token (`…`) with its file and line; fenced blocks are code, read separately. */
function backticked(file: string, root = REPO_ROOT): Ref[] {
  const refs: Ref[] = []
  let fenced = false
  fs.readFileSync(path.join(root, file), "utf8")
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
      .flatMap((file) => backticked(file))
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
      .flatMap((file) => backticked(file))
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

/** Every identifier-shaped word of `files`. */
const wordsOf = (files: readonly string[]) =>
  new Set(files.flatMap((file) => fs.readFileSync(file, "utf8").match(/[A-Za-z_$][\w$]*/g) ?? []))

// A camelCase or PascalCase name, optionally called: `useResetOnChange(…)`.
const identifierOf = (token: string) =>
  /^([a-z]+[A-Z]\w*|[A-Z][a-z]+[A-Z]\w*)(?:\(.*\))?$/.exec(token)?.[1]
// Names a skill invents for the reader's own code.
const PLACEHOLDER = /Xyz|Your[A-Z]|My[A-Z]|^my[A-Z]|Foo|Example/

/** The workspace package a nested agent file sits in, as a repo-relative directory. */
const packageOf = (rel: string) =>
  /^(?:apps\/[^/]+|packages\/core\/[^/]+|packages\/connectors\/[^/]+\/[^/]+)/.exec(rel)?.[0]

/**
 * The words of the tsconfig*.json files (among `files`, the repo's listed
 * files) of the package a nested agent file sits in: its compiler options
 * (`exactOptionalPropertyTypes`) are true statements about that package,
 * though no source names them. A skill gets none of them; its corpus stays
 * the sources and the typings.
 */
function tsconfigWords(root: string, rel: string, files: readonly string[]): Set<string> {
  const dir = packageOf(rel)
  if (dir === undefined) return new Set()
  return wordsOf(
    files
      .filter((file) => file.startsWith(`${dir}/`))
      .filter((file) => /^tsconfig.*\.json$/.test(path.posix.basename(file)))
      .map((file) => path.join(root, file)),
  )
}

/**
 * The backticked identifiers of `docs` (repo-relative under `root`) that no
 * word of `words` declares, as `file:line \`token\``; a nested agent file also
 * accepts the words of its package's own tsconfig*.json files among `files`.
 */
function unknownIdentifiers(
  root: string,
  docs: readonly string[],
  words: ReadonlySet<string>,
  files: readonly string[],
): string[] {
  return docs.flatMap((doc) => {
    const own = isNestedAgentFile(doc) ? tsconfigWords(root, doc, files) : new Set<string>()
    return backticked(doc, root)
      .filter((ref) => {
        const name = identifierOf(ref.token)
        return name !== undefined && !PLACEHOLDER.test(name) && !words.has(name) && !own.has(name)
      })
      .map(where)
  })
}

describe("identifiers in the skills and the nested agent files", () => {
  // The app's own copies: the versions the skills' code compiles against.
  const packageDir = (name: string) =>
    fs.realpathSync(path.join(import.meta.dirname, "..", "node_modules", name))
  const isSource = (file: string) => /\.(?:tsx?|mts|mjs|cjs|kt)$/.test(file)
  const words = wordsOf([
    ...["apps", "packages", "scripts", "templates", "engine-plugins"].flatMap((dir) =>
      walk(path.join(REPO_ROOT, dir), isSource),
    ),
    ...["@miragon/mcp-toolkit-core", "@miragon/mcp-toolkit-ui", "mcp-use"].flatMap((name) =>
      walk(path.join(packageDir(name), "dist"), (file) => file.endsWith(".d.ts")),
    ),
  ])

  it("name only functions, hooks and types that exist", () => {
    expect(unknownIdentifiers(REPO_ROOT, identifierDocs(docFiles), words, repoFiles)).toEqual([])
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
  // The CLI's pages (docs/cli/).
  "cli/index.md": 40,
  "cli/getting-started.md": 90,
  "cli/quick-start.md": 90,
  "cli/installation.md": 150,
  "cli/workflow-commands.md": 70,
  "cli/commands.md": 150,
  "cli/recipes.md": 110,
  "cli/output-and-errors.md": 90,
  "cli/safety.md": 40,
  "cli/configuration.md": 160,
  "cli/authentication.md": 180,
  "cli/engines.md": 60,
  "cli/agents.md": 90,
  "cli/architecture.md": 100,
  "cli/development.md": 130,
  "cli/releasing.md": 70,
  "cli/adr/index.md": 20,
  "cli/adr/001-engines-as-adapters.md": 70,
  "cli/adr/002-camunda-8-is-a-separate-api.md": 50,
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

  it("checks the identifiers of the skills that teach repo code and of the nested agent files", () => {
    expect(
      identifierDocs([
        "CLAUDE.md",
        "README.md",
        "templates/composed-server/CLAUDE.md",
        "apps/vscode/AGENTS.md",
        "apps/vscode/CLAUDE.md",
        "apps/cli/README.md",
        "packages/connectors/camunda/camunda7-domain/AGENTS.md",
        ".claude/skills/add-bpm-feature/SKILL.md",
        ".claude/skills/shadcn/SKILL.md",
        ".claude/skills/create-ticket/SKILL.md",
        "templates/composed-server/.claude/skills/add-widget/SKILL.md",
      ]),
    ).toEqual([
      ".claude/skills/add-bpm-feature/SKILL.md",
      "templates/composed-server/.claude/skills/add-widget/SKILL.md",
      "apps/vscode/AGENTS.md",
      "apps/vscode/CLAUDE.md",
      "packages/connectors/camunda/camunda7-domain/AGENTS.md",
    ])
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

  describe("the identifier check over a fixture tree", () => {
    const roots: string[] = []
    afterEach(() => {
      for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
    })

    it("reports an unknown name in a nested agent file, and takes its package's compiler options", () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), "docs-idents-"))
      roots.push(root)
      const strict = "Strict TypeScript (`exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`)."
      const files: Record<string, string> = {
        "apps/vscode/AGENTS.md": `${strict}\nCall \`useNoSuchHook()\` and \`knownHook()\`.\n`,
        "apps/vscode/tsconfig.base.json":
          '{ "compilerOptions": { "exactOptionalPropertyTypes": true, // strict\n "noUncheckedIndexedAccess": true, } }',
        "apps/vscode/src/webview/tsconfig.json": '{ "compilerOptions": { "noEmitOnError": true } }',
        "apps/cli/CLAUDE.md": "Set `noEmitOnError` and `exactOptionalPropertyTypes`.\n",
        "apps/cli/tsconfig.json": '{ "compilerOptions": { "strict": true } }',
        // A download git ignores (a VS Code test install) names options of its own.
        ".gitignore": ".vscode-test/\n",
        "apps/cli/.vscode-test/ext/tsconfig.json":
          '{ "compilerOptions": { "noEmitOnError": true } }',
        ".claude/skills/x/SKILL.md": `${strict}\n`,
        "CLAUDE.md": "Run `noSuchRootTool`.\n",
      }
      for (const [rel, text] of Object.entries(files)) {
        fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true })
        fs.writeFileSync(path.join(root, rel), text)
      }
      const env = Object.fromEntries(
        Object.entries(process.env).filter(([name]) => !name.startsWith("GIT_")),
      )
      execFileSync("git", ["init", "--quiet"], { cwd: root, env })
      const listed = listedFiles(root)
      const docs = identifierDocs(listed.filter(isCheckedDoc))
      expect(unknownIdentifiers(root, docs, new Set(["knownHook"]), listed)).toEqual([
        // A skill keeps the plain corpus: a compiler option is no identifier of the code.
        ".claude/skills/x/SKILL.md:1 `exactOptionalPropertyTypes`",
        ".claude/skills/x/SKILL.md:1 `noUncheckedIndexedAccess`",
        // Another package's tsconfig is not this package's, and an ignored one counts for none.
        "apps/cli/CLAUDE.md:1 `noEmitOnError`",
        "apps/cli/CLAUDE.md:1 `exactOptionalPropertyTypes`",
        "apps/vscode/AGENTS.md:2 `useNoSuchHook()`",
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
