import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, it } from "node:test"
import { fileURLToPath } from "node:url"
import { TEST_FILE } from "./pack-contents.mjs"
import { REPO_ROOT } from "./source-scan.mjs"
import { fullSurface } from "./tool-surface.mjs"
import { publishedLibraries } from "./workspace-packages.mjs"

/**
 * Docs and skills say what the code does (#345). A skill an agent follows
 * writes the code it shows, so a stale name there lands in the next change.
 * This guard reads every backticked reference in the docs, the READMEs, the
 * agent files and the skills (isCheckedDoc below) and checks it against the
 * repo: tool names against the full surface (the admin golden), repo paths against the tree
 * (from the repo root, in a nested file too), the template docs' paths into an installed
 * package against what that package ships and where pnpm links it, the identifiers of the skills
 * and of the nested agent files against the sources and the typings of the official MCP SDK
 * (OFFICIAL_TYPINGS; a nested agent file's also against its package's own
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
function entriesOf(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
  } catch (error) {
    if (error.code === "ENOENT") return []
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
const walk = (dir, keep) =>
  entriesOf(dir).flatMap((entry) => {
    if (entry.name === "node_modules") return []
    const file = path.join(dir, entry.name)
    if (entry.isDirectory()) return walk(file, keep)
    return keep(file) && fs.statSync(file, { throwIfNoEntry: false })?.isFile() ? [file] : []
  })

/** The docs pages: the Markdown in docs/, not the VitePress config, theme or build output. */
const isDocsPage = (rel) =>
  rel.startsWith("docs/") && rel.endsWith(".md") && !rel.split("/").includes(".vitepress")

/** The house skills and the template's. */
const isSkill = (rel) =>
  /^(?:templates\/composed-server\/)?\.claude\/skills\/.*SKILL\.md$/.test(rel)

/**
 * An agent file below the root: a CLAUDE.md or AGENTS.md anywhere under apps/
 * or packages/. Like the skills, it tells an agent what to write, so its
 * identifiers are checked too. The root CLAUDE.md is not one: it names
 * Gradle, pnpm, docs-kit and release tooling terms that no source here
 * declares.
 */
const isNestedAgentFile = (rel) => /^(?:apps|packages)\/(?:.+\/)?(?:CLAUDE|AGENTS)\.md$/.test(rel)

/**
 * The Markdown this guard reads (`rel` is a repo-relative POSIX path): the
 * root README.md and CLAUDE.md, the docs pages, every package's README.md and
 * agent files, every Markdown file of an app (its READMEs, agent files, ADRs,
 * shipped skills, store listing), the template's README.md and CLAUDE.md and
 * the skills. Never node_modules, and never a CHANGELOG.md: release-please
 * writes it and quotes old commit text.
 */
function isCheckedDoc(rel) {
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
function listedFiles(root) {
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
const checkedDocs = (root) => listedFiles(root).filter(isCheckedDoc)

// Skills that teach no code of this repo: shadcn's is vendored (its own
// components and CLI), create-ticket names the agent's tools.
const NOT_REPO_CODE = new Set(["shadcn", "create-ticket"])
const teachesRepoCode = (file) => !NOT_REPO_CODE.has(path.basename(path.dirname(file)))

/** The docs whose identifiers are checked: the skills that teach repo code and the nested agent files. */
const identifierDocs = (docs) => [
  ...docs.filter(isSkill).filter(teachesRepoCode),
  ...docs.filter(isNestedAgentFile),
]

const repoFiles = listedFiles(REPO_ROOT)
const docFiles = repoFiles.filter(isCheckedDoc)
const skillFiles = docFiles.filter(isSkill)
const docsPages = docFiles.filter(isDocsPage)

/**
 * Every inline-code token (`…`) with its file and line; fenced blocks are code, read separately.
 * @returns {{ file: string, line: number, token: string }[]}
 */
function backticked(file, root = REPO_ROOT) {
  const refs = []
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

const where = (ref) => `${ref.file}:${ref.line} \`${ref.token}\``

/** A backticked token shaped like a tool: the module prefix, a `show_`, a `_data` feed. */
const looksLikeTool = (token) =>
  /^[a-z0-9]+(?:_[a-z0-9]+)+$/.test(token) &&
  (/^engine_/.test(token) || /(?:^|_)show_/.test(token) || token.endsWith("_data"))

describe("tool names in the docs", () => {
  const tools = new Set(fullSurface().map((tool) => tool.name))
  // A short form (`open_cockpit`, `bpmn_xml_data`) names the module's tool.
  const known = (name) => tools.has(name) || tools.has(`engine_${name}`)

  // The template's docs also name its own module's tools (`notes_show_notes`),
  // which its own suite checks; here only the shipped modules' names count.
  const checked = (ref) => (ref.file.startsWith("templates/") ? /^engine_/.test(ref.token) : true)

  it("names only tools the server registers", () => {
    const stale = docFiles
      .flatMap((file) => backticked(file))
      .filter((ref) => looksLikeTool(ref.token) && checked(ref) && !known(ref.token))
    assert.deepEqual(stale.map(where), [])
  })
})

describe("repo paths in the docs", () => {
  const ROOTS = /^(?:apps|packages|docs|scripts|playground|templates|\.claude|\.github)\//
  // Written by a build or a test run, not checked in.
  const GENERATED = /(?:^|\/)(?:dist|test-results|node_modules|generated-sources)(?:\/|$)/
  const pathOf = (token) => token.replace(/:\d+(?:-\d+)?$/, "").replace(/\/$/, "")
  const isPath = (token) =>
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
    assert.deepEqual(missing.map(where), [])
  })
})

/**
 * The template docs' paths into an installed Pulse package
 * (`server/node_modules/@miragon/pulse-engine-connector/src/…`), which the repo paths check
 * skips with the rest of node_modules. pnpm links a package only under the folder whose
 * package.json declares it (`server/`, `modules/<dir>/`), never at a root node_modules/@miragon,
 * and the copy there holds only what npm ships. So each path maps to its workspace library: a
 * `dist/` path names an entry of its manifest (pack-contents.mjs checks the entries ship), any
 * other path exists in the library and its `files` ship it.
 */
const INSTALLED_PATH =
  /^(server|modules\/[\w.-]+)\/node_modules\/(@miragon\/pulse-[a-z0-9-]+)(?:\/(.+))?$/
const CITES_INSTALLED = /node_modules\/@miragon\/pulse-/
// npm packs these whatever `files` lists.
const ALWAYS_PACKED = /^(?:package\.json|(?:README|LICEN[CS]E)(?:\.[^/]*)?)$/i

/** `a{b,c}d` as `abd` and `acd`, every brace group in turn. */
function expandBraces(token) {
  const group = /\{([^{}]*)\}/.exec(token)
  if (group === null) return [token]
  const before = token.slice(0, group.index)
  const after = token.slice(group.index + group[0].length)
  return (group[1] ?? "").split(",").flatMap((alt) => expandBraces(`${before}${alt}${after}`))
}

/** Every string target of an `exports` value, whatever its conditions. */
const exportTargets = (value) => {
  if (typeof value === "string") return [value]
  if (value === null || typeof value !== "object") return []
  return Object.values(value).flatMap(exportTargets)
}

/** The package-relative files a manifest names as its entries: `main`, `types`, `exports`. */
const entryFiles = (manifest) =>
  [manifest.main, manifest.types, ...exportTargets(manifest.exports)]
    .filter((target) => typeof target === "string")
    .map((target) => path.posix.normalize(target))

/** Whether a manifest's `files` ship `rest`, a package-relative path: an entry or below one. */
const ships = (manifest, rest) =>
  ALWAYS_PACKED.test(rest) ||
  ((manifest.files ?? []).some(
    (entry) => !entry.startsWith("!") && (rest === entry || rest.startsWith(`${entry}/`)),
  ) &&
    !TEST_FILE.test(rest))

/** The packages the package.json of a template folder (`server`, `modules/<dir>`) installs. */
function templateDeclares(folder) {
  const file = path.join(TEMPLATE_ROOT, folder, "package.json")
  if (!fs.existsSync(file)) return new Set()
  const manifest = JSON.parse(fs.readFileSync(file, "utf8"))
  return new Set(
    ["dependencies", "devDependencies", "optionalDependencies"].flatMap((field) =>
      Object.keys(manifest[field] ?? {}),
    ),
  )
}

/** What is wrong with `cited`, one path without braces (see installedPathProblems), if anything. */
function installedPathProblem(cited, { root, libraries, declared }) {
  const match = INSTALLED_PATH.exec(cited)
  if (match === null) {
    return (
      "pnpm links a package under the folder that declares it (server/node_modules/@miragon/…, " +
      "modules/<dir>/node_modules/@miragon/…), never at a root node_modules/@miragon"
    )
  }
  const [, folder = "", name = "", rest] = match
  const library = libraries.get(name)
  if (library === undefined) return `${name} is no library this workspace publishes`
  if (!declared(folder).has(name)) {
    return `${folder}/package.json does not declare ${name}, so pnpm links it elsewhere`
  }
  if (rest === undefined) return undefined
  if (rest === "dist" || rest.startsWith("dist/")) {
    const isEntry = (entry) => entry === rest || entry.startsWith(`${rest}/`)
    return entryFiles(library.manifest).some(isEntry)
      ? undefined
      : `${rest} is no entry of ${name} (main, types, exports), so nothing builds it`
  }
  if (!fs.existsSync(path.join(root, library.dir, rest))) {
    return `${library.dir}/${rest} does not exist`
  }
  return ships(library.manifest, rest)
    ? undefined
    : `${name} does not ship ${rest} (the files of its package.json)`
}

/**
 * What is wrong with `token`, a backticked path of a template doc, as a path into an installed
 * package; none when it is right or names no such package. `libraries` maps an npm name to its
 * workspace `{ dir, manifest }` (`dir` relative to `root`), `declared(folder)` names the packages
 * a template folder installs. A brace group (`pulse-{ui,widget-shell}`) is checked
 * per alternative, and each problem names the path it is about.
 */
function installedPathProblems(token, context) {
  if (!CITES_INSTALLED.test(token)) return []
  const paths = expandBraces(token.replace(/:\d+(?:-\d+)?$/, "").replace(/\/$/, ""))
  return paths.flatMap((cited) => {
    const problem = installedPathProblem(cited, context)
    if (problem === undefined) return []
    return [paths.length > 1 ? `${cited}: ${problem}` : problem]
  })
}

describe("installed package paths in the template docs", () => {
  const libraries = new Map(
    publishedLibraries(REPO_ROOT).map((library) => [library.manifest.name, library]),
  )
  const context = { root: REPO_ROOT, libraries, declared: templateDeclares }
  const problemsOf = (token) => installedPathProblems(token, context)
  const templateRefs = docFiles
    .filter((file) => file.startsWith("templates/composed-server/"))
    .flatMap((file) => backticked(file))

  it("cite only files the installed packages ship, where pnpm links them", () => {
    const wrong = templateRefs.flatMap((ref) =>
      problemsOf(ref.token).map((problem) => `${where(ref)}: ${problem}`),
    )
    assert.deepEqual(wrong, [])
  })

  it("reads the template docs' installed paths (the check is not blind)", () => {
    const citing = templateRefs
      .filter((ref) => CITES_INSTALLED.test(ref.token))
      .map((ref) => ref.file)
    assert.deepEqual([...new Set(citing)].sort(), [
      "templates/composed-server/.claude/skills/add-widget/SKILL.md",
      "templates/composed-server/.claude/skills/create-module/SKILL.md",
      "templates/composed-server/CLAUDE.md",
    ])
  })

  it("accepts a shipped source, a README, an entry's typings and a module's own install", () => {
    for (const token of [
      "server/node_modules/@miragon/pulse-engine-connector/src/lib/mcp/toolsets.ts",
      "server/node_modules/@miragon/pulse-{ui,widget-shell}/README.md",
      "server/node_modules/@miragon/pulse-widget-shell/README.md",
      "server/node_modules/@miragon/pulse-widget-shell/dist/ui/index.d.ts",
      "server/node_modules/@miragon/pulse-ui/dist/index.d.ts",
      "server/node_modules/@miragon/pulse-ui/src/theme.css",
      "modules/mcp-notes/node_modules/@miragon/pulse-ui/README.md",
      "node_modules/@miragon/",
    ]) {
      assert.deepEqual(problemsOf(token), [], token)
    }
  })

  it("reports a root install, a missing file, an unshipped file and an undeclared package", () => {
    const cases = [
      ["node_modules/@miragon/pulse-engine-connector/src/lib/mcp/toolsets.ts", /never at a root/],
      ["server/node_modules/@miragon/pulse-engine-connector/src/lib/no-such.ts", /does not exist/],
      ["server/node_modules/@miragon/pulse-{ui,widget-shell}/src/nope/", /not exist/],
      // Files no `files` entry names: they stay unshipped once a library ships its `src` too.
      [
        "server/node_modules/@miragon/pulse-widget-shell/vitest.config.ts",
        /does not ship vitest\.config\.ts/,
      ],
      ["server/node_modules/@miragon/pulse-ui/tsconfig.json", /does not ship tsconfig\.json/],
      [
        "server/node_modules/@miragon/pulse-engine-connector/src/lib/mcp/toolsets.test.ts",
        /does not ship src/,
      ],
      ["server/node_modules/@miragon/pulse-widget-shell/dist/no-such.d.ts", /is no entry/],
      ["server/node_modules/@miragon/pulse-c7-core/README.md", /does not declare/],
      ["modules/mcp-notes/node_modules/@miragon/pulse-engine-connector/src", /does not declare/],
      ["server/node_modules/@miragon/pulse-nope/README.md", /is no library/],
    ]
    for (const [token, problem] of cases) {
      const problems = problemsOf(token)
      assert.ok(problems.length > 0, token)
      for (const found of problems) assert.match(found, problem, token)
    }
  })
})

/** Every identifier-shaped word of `files`. */
const wordsOf = (files) =>
  new Set(files.flatMap((file) => fs.readFileSync(file, "utf8").match(/[A-Za-z_$][\w$]*/g) ?? []))

// A camelCase or PascalCase name, optionally called: `useResetOnChange(…)`.
const identifierOf = (token) => /^([a-z]+[A-Z]\w*|[A-Z][a-z]+[A-Z]\w*)(?:\(.*\))?$/.exec(token)?.[1]
// Names a skill invents for the reader's own code.
const PLACEHOLDER = /Xyz|Your[A-Z]|My[A-Z]|^my[A-Z]|Foo|Example/

/** The workspace package a nested agent file sits in, as a repo-relative directory. */
const packageOf = (rel) =>
  /^(?:apps\/[^/]+|packages\/core\/[^/]+|packages\/connectors\/[^/]+\/[^/]+)/.exec(rel)?.[0]

/**
 * The words of the tsconfig*.json files (among `files`, the repo's listed
 * files) of the package a nested agent file sits in: its compiler options
 * (`exactOptionalPropertyTypes`) are true statements about that package,
 * though no source names them. A skill gets none of them; its corpus stays
 * the sources and the typings.
 */
function tsconfigWords(root, rel, files) {
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
function unknownIdentifiers(root, docs, words, files) {
  return docs.flatMap((doc) => {
    const own = isNestedAgentFile(doc) ? tsconfigWords(root, doc, files) : new Set()
    return backticked(doc, root)
      .filter((ref) => {
        const name = identifierOf(ref.token)
        return name !== undefined && !PLACEHOLDER.test(name) && !words.has(name) && !own.has(name)
      })
      .map(where)
  })
}

/**
 * The official MCP SDK's packages whose typings the skills may name, each as linked for the
 * package that compiles against it: the server, its Node adapter and MCP Apps for widget-shell
 * (the version every module and the skills' code build on), the client for the server app's
 * tests. `core` holds the protocol types the server re-exports; pnpm links it next to the server.
 */
const OFFICIAL_TYPINGS = [
  ["packages/core/widget-shell", "@modelcontextprotocol/server"],
  ["packages/core/widget-shell", "@modelcontextprotocol/server", "../core"],
  ["packages/core/widget-shell", "@modelcontextprotocol/node"],
  ["packages/core/widget-shell", "@modelcontextprotocol/ext-apps"],
  ["apps/mcp-server", "@modelcontextprotocol/client"],
]

/** The declaration files under a package's dist (`.d.ts`, `.d.mts`, `.d.cts`). */
const isDeclaration = (file) => /\.d\.[cm]?ts$/.test(file)

describe("identifiers in the skills and the nested agent files", () => {
  const typingsDirs = OFFICIAL_TYPINGS.map(([from, name, sibling = "."]) =>
    path.join(fs.realpathSync(path.join(REPO_ROOT, from, "node_modules", name)), sibling, "dist"),
  )
  const typings = typingsDirs.flatMap((dir) => walk(dir, isDeclaration))
  // This guard's own fixtures name identifiers on purpose (`useNoSuchHook`), and old-names' name
  // retired ones (`useCallTool`, `MCPServer`): they declare none.
  const FIXTURE_SOURCES = new Set([
    fileURLToPath(import.meta.url),
    path.join(REPO_ROOT, "scripts", "old-names.test.mjs"),
  ])
  const isSource = (file) => /\.(?:tsx?|mts|mjs|cjs)$/.test(file) && !FIXTURE_SOURCES.has(file)
  const words = wordsOf([
    ...["apps", "packages", "scripts", "templates"].flatMap((dir) =>
      walk(path.join(REPO_ROOT, dir), isSource),
    ),
    ...typings,
  ])

  it("reads the typings of every official package it names", () => {
    const empty = typingsDirs.filter((dir) => walk(dir, isDeclaration).length === 0)
    assert.deepEqual(empty, [], "a package without declarations under dist/ checks nothing")
    const declared = wordsOf(typings)
    const missing = [
      "McpServer",
      "registerTool",
      "CallToolResult",
      "toNodeHandler",
      "registerAppTool",
      "Client",
      "StreamableHTTPClientTransport",
    ].filter((name) => !declared.has(name))
    assert.deepEqual(missing, [])
  })

  it("name only functions, hooks and types that exist", () => {
    assert.deepEqual(unknownIdentifiers(REPO_ROOT, identifierDocs(docFiles), words, repoFiles), [])
  })
})

/**
 * The pages in docs/ and their line budgets, keyed by the path under docs/
 * (`cli/index.md` for docs/cli/index.md): a page that outgrows its budget
 * condenses. index.md is the site's home, README.md the index on GitHub.
 */
const DOCS_BUDGETS = {
  "index.md": 40,
  "README.md": 40,
  "overview.md": 40,
  // The MCP server's pages (docs/mcp/).
  "mcp/index.md": 30,
  "mcp/getting-started.md": 60,
  "mcp/architecture.md": 150,
  "mcp/build-your-own.md": 50,
  "mcp/developer.md": 80,
  "mcp/operations.md": 120,
  "mcp/usage.md": 150,
  "mcp/reference.md": 160,
  // The CLI's pages (docs/cli/).
  "cli/index.md": 40,
  "cli/getting-started.md": 140,
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
  // The VS Code extension's pages (docs/vscode/).
  "vscode/index.md": 50,
  "vscode/installation.md": 50,
  "vscode/configuration.md": 80,
  "vscode/usage.md": 80,
  "vscode/boards.md": 70,
  "vscode/architecture.md": 50,
  // Every difference between the MCP cockpit and the webview, a row each: it grows with a
  // feature built on one side and shrinks with one that closes a row.
  "vscode/parity.md": 210,
}

/** A page's budget key: its path under docs/, so docs/index.md and docs/cli/index.md differ. */
const pageKey = (rel) => rel.slice("docs/".length)

/** The pages without a budget and the budgets without a page, both as keys. */
function budgetMismatch(pages, budgets) {
  const keys = pages.map(pageKey)
  return {
    unbudgeted: keys.filter((key) => !Object.hasOwn(budgets, key)).sort(),
    stale: Object.keys(budgets)
      .filter((key) => !keys.includes(key))
      .sort(),
  }
}

/** A page's length in lines; a final newline ends the last line and adds none. */
const lineCount = (text) => text.replace(/\n$/, "").split("\n").length

describe("docs page budgets", () => {
  it("every page in docs/ has a budget", () => {
    const { unbudgeted, stale } = budgetMismatch(docsPages, DOCS_BUDGETS)
    assert.deepEqual(
      [
        ...unbudgeted.map(
          (key) =>
            `docs/${key} has no line budget: add "${key}": <lines> to DOCS_BUDGETS ` +
            "(keyed by the path under docs/)",
        ),
        ...stale.map(
          (key) => `DOCS_BUDGETS names ${key}, which is no page in docs/: drop the entry`,
        ),
      ],
      [],
    )
  })

  for (const [page, lines] of Object.entries(DOCS_BUDGETS)) {
    it(`${page} stays within ${lines} lines`, () => {
      const text = fs.readFileSync(path.join(REPO_ROOT, "docs", page), "utf8")
      const count = lineCount(text)
      assert.ok(count <= lines, `docs/${page} has ${count} lines, its budget is ${lines}`)
    })
  }
})

describe("what the guard reads", () => {
  for (const rel of [
    "README.md",
    "CLAUDE.md",
    "docs/index.md",
    "docs/README.md",
    "docs/cli/index.md",
    "docs/vscode/getting-started.md",
    "packages/core/widget-shell/README.md",
    "packages/connectors/engine/engine-domain/README.md",
    "packages/connectors/engine/engine-domain/CLAUDE.md",
    "packages/connectors/engine/engine-domain/AGENTS.md",
    "apps/mcp-server/README.md",
    "apps/mcp-server/test-host/README.md",
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
  ]) {
    it(`reads ${rel}`, () => {
      assert.equal(isCheckedDoc(rel), true)
    })
  }

  for (const rel of [
    "CHANGELOG.md",
    "apps/cli/CHANGELOG.md",
    "packages/core/widget-shell/CHANGELOG.md",
    "docs/.vitepress/miragon/README.md",
    "docs/node_modules/vitepress/README.md",
    "apps/vscode/node_modules/foo/README.md",
    "packages/core/widget-shell/node_modules/x/README.md",
    "packages/core/widget-shell/src/notes.md",
    "packages/connectors/engine/engine-connector/src/messages/GLOSSARY.md",
    ".claude/skills/shadcn/rules/forms.md",
    "templates/composed-server/server/README.md",
    "playground/README.md",
    "TODOS.md",
    "apps/cli/README.txt",
  ]) {
    it(`leaves out ${rel}`, () => {
      assert.equal(isCheckedDoc(rel), false)
    })
  }

  it("checks the identifiers of the skills that teach repo code and of the nested agent files", () => {
    assert.deepEqual(
      identifierDocs([
        "CLAUDE.md",
        "README.md",
        "templates/composed-server/CLAUDE.md",
        "apps/vscode/AGENTS.md",
        "apps/vscode/CLAUDE.md",
        "apps/cli/README.md",
        "packages/connectors/engine/engine-domain/AGENTS.md",
        ".claude/skills/add-bpm-feature/SKILL.md",
        ".claude/skills/shadcn/SKILL.md",
        ".claude/skills/create-ticket/SKILL.md",
        "templates/composed-server/.claude/skills/add-widget/SKILL.md",
      ]),
      [
        ".claude/skills/add-bpm-feature/SKILL.md",
        "templates/composed-server/.claude/skills/add-widget/SKILL.md",
        "apps/vscode/AGENTS.md",
        "apps/vscode/CLAUDE.md",
        "packages/connectors/engine/engine-domain/AGENTS.md",
      ],
    )
  })

  it("checks the identifiers of the agent files under apps/ and packages/, not the root's", () => {
    const nested = [
      "apps/cli/CLAUDE.md",
      "apps/vscode/AGENTS.md",
      "packages/connectors/engine/engine-domain/AGENTS.md",
      "packages/core/widget-shell/CLAUDE.md",
    ]
    assert.deepEqual(nested.filter(isNestedAgentFile), nested)
    assert.deepEqual(
      [
        "CLAUDE.md",
        "AGENTS.md",
        "templates/composed-server/CLAUDE.md",
        "apps/cli/README.md",
        "apps/cli/skills/pulse-cli/SKILL.md",
      ].filter(isNestedAgentFile),
      [],
    )
  })

  it("keys a page by its path under docs/, so two index.md pages get two budgets", () => {
    const pages = ["docs/index.md", "docs/README.md", "docs/cli/index.md", "docs/cli/commands.md"]
    assert.deepEqual(pages.map(pageKey).sort(), [
      "README.md",
      "cli/commands.md",
      "cli/index.md",
      "index.md",
    ])
    assert.deepEqual(budgetMismatch(pages, { "index.md": 40, "README.md": 40 }), {
      unbudgeted: ["cli/commands.md", "cli/index.md"],
      stale: [],
    })
    assert.deepEqual(
      budgetMismatch(pages, {
        "index.md": 40,
        "README.md": 40,
        "cli/index.md": 40,
        "cli/commands.md": 60,
        "cli/gone.md": 20,
      }),
      { unbudgeted: [], stale: ["cli/gone.md"] },
    )
    // A budget key inherited from Object.prototype is no budget.
    assert.deepEqual(budgetMismatch(["docs/constructor"], {}).unbudgeted, ["constructor"])
    assert.equal(isDocsPage("docs/.vitepress/theme/notes.md"), false)
    assert.equal(isDocsPage("docs/cli/index.md"), true)
    assert.equal(isDocsPage("docs/package.json"), false)
  })

  it("counts a page's lines without the final newline", () => {
    const page = (lines) => `${Array.from({ length: lines }, (_, i) => `line ${i}`).join("\n")}\n`
    assert.equal(lineCount(page(40)), 40)
    assert.equal(lineCount(page(41)), 41)
    assert.equal(lineCount("one\ntwo"), 2)
  })

  describe("in a git checkout", () => {
    const roots = []
    afterEach(() => {
      for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
    })

    it("reads what git tracks or would add, never an ignored download or build output", () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), "docs-refs-"))
      roots.push(root)
      const files = {
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
      assert.deepEqual(checkedDocs(root).sort(), [
        "README.md",
        "apps/vscode/README.md",
        "apps/vscode/src/notes.md",
      ])
    })
  })

  describe("the identifier check over a fixture tree", () => {
    const roots = []
    afterEach(() => {
      for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
    })

    it("reports an unknown name in a nested agent file, and takes its package's compiler options", () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), "docs-idents-"))
      roots.push(root)
      const strict = "Strict TypeScript (`exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`)."
      const files = {
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
      assert.deepEqual(unknownIdentifiers(root, docs, new Set(["knownHook"]), listed), [
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
    for (const doc of [
      "README.md",
      "CLAUDE.md",
      "docs/index.md",
      "packages/core/widget-shell/README.md",
      "apps/mcp-server/README.md",
      "apps/mcp-server/test-host/README.md",
      "templates/composed-server/CLAUDE.md",
      ".claude/skills/add-bpm-feature/SKILL.md",
      "templates/composed-server/.claude/skills/setup-server/SKILL.md",
    ]) {
      assert.ok(docFiles.includes(doc), doc)
    }
    assert.ok(docFiles.length >= 28)
    // Every skill by name: the scanner reads each one, not just enough of them.
    assert.deepEqual([...skillFiles].sort(), [
      ".claude/skills/add-bpm-feature/SKILL.md",
      ".claude/skills/create-ticket/SKILL.md",
      ".claude/skills/mcp-apps-builder/SKILL.md",
      ".claude/skills/shadcn/SKILL.md",
      "templates/composed-server/.claude/skills/add-widget/SKILL.md",
      "templates/composed-server/.claude/skills/create-module/SKILL.md",
      "templates/composed-server/.claude/skills/setup-server/SKILL.md",
    ])
    assert.ok(docsPages.map(pageKey).includes("index.md"))
  })
})
