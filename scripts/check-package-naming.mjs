#!/usr/bin/env node
/**
 * Layout + naming gate (CLAUDE.md invariant 8). The dependency-cruiser rules,
 * check-ratchets, mutation-diff and the ESLint budgets key on WHERE a package
 * lives and WHAT it is called. A package that breaks the convention does not
 * fail them: it silently falls out of them while it is still built and
 * shipped. This gate fails on it instead:
 *
 * - Every workspace package sits at apps/<dir>, packages/core/<dir> or
 *   packages/connectors/<family>/<dir> (plus the docs site at docs/), its
 *   directory is lowercase kebab-case and never repeats the product prefix
 *   ("pulse-"), and no pnpm-workspace.yaml glob reaches another layout.
 * - A connector-family package ends in a role suffix (CONNECTOR_ROLES:
 *   -connector, -client, -domain); apps and foundation packages carry none,
 *   because the dependency-cruiser rules match the suffix by name.
 * - The npm name is @miragon/pulse-<dir>. The one exception is a VS Code
 *   extension, an app whose package.json declares engines.vscode: vsce takes no
 *   scope, so it is named pulse-cockpit (Marketplace id
 *   miragon-gmbh.pulse-cockpit; Marketplace names are global and "pulse" is
 *   taken; a filter on pulse-cockpit names the extension alone), its engines.vscode is a non-empty
 *   string, and the lowest @types/vscode it allows never exceeds the lowest VS
 *   Code engines.vscode allows (vsce refuses that package). engines.vscode
 *   outside apps/ fails: every npm gate skips an extension, so a package that
 *   declared it would escape them.
 * - A generated/ directory under apps/ or packages/ is exempt from ESLint,
 *   prettier and the app's source scans (dependency-cruiser excludes only the
 *   CIB seven SDK and cruises every other generated/ tree), so it exists only
 *   where GENERATED_DIRS lists it with its reason.
 * - No .mts/.cts/.js/.mjs/.cjs/.jsx source under a package's src/: the ESLint
 *   complexity/max-lines budgets and pattern gates (globbed *.{ts,tsx}) and
 *   widget-shell's brand-gate scans (scanGlyphs, scanColors, scanIconSizes,
 *   scanTypeScale) read .ts and .tsx only.
 * - No package.json declares an app (the npm name of an apps/<dir>) in dependencies, devDependencies, peerDependencies or
 *   optionalDependencies: not by its name, not as an npm: or workspace: alias,
 *   not as a file:/link:/portal: path into its directory. That holds for the
 *   root package.json too (Node resolves what the root declares from every
 *   directory below it); an app's own package.json names it in `name` only.
 *   Under pnpm a workspace app is reachable from another package (an import,
 *   require.resolve, its bin, a spawned process) only through such a
 *   declaration, and dependency-cruiser sees imports only.
 * - No package.json, lockfile or pnpm-workspace.yaml anywhere else under apps/
 *   or packages/: a nested package falls out of every gate keyed on the layout.
 *
 * The package walk reads the file system, so a directory left behind without a
 * package.json fails too. The layout rules read the files git tracks or would
 * add (`git ls-files --cached --others --exclude-standard`).
 *
 * Runs as `pnpm lint:naming` (chained into the root `pnpm lint`).
 */
import { execFileSync } from "node:child_process"
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { expandWorkspaceGlobs, workspaceGlobs } from "./check-package-scripts.mjs"

/**
 * The role suffixes of a connector-family package. Every role needs its
 * dependency-cruiser rule (the lockstep test in check-package-naming.test.mjs
 * fails otherwise): add a role there in the same change as here.
 */
export const CONNECTOR_ROLES = ["connector", "client", "domain"]

/**
 * The only generated/ directories under apps/ or packages/, each with the
 * reason it may skip ESLint, prettier and the app's source scans
 * (dependency-cruiser keeps its own exclude list, today only the CIB seven SDK).
 * An entry names output a tool regenerates and nobody edits by hand; an entry
 * whose directory is gone fails as stale.
 */
export const GENERATED_DIRS = {
  "packages/connectors/camunda/camunda7-client/src/generated":
    "the hey-api SDK `pnpm generate` regenerates from the CIB seven OpenAPI spec; never edited by hand",
  "apps/cli/src/generated":
    "the CLI's command catalog (catalog.json) of every engine, which `pnpm --fail-if-no-match --filter @miragon/pulse-cli catalog` renders from apps/cli/spec; never edited by hand (scripts/catalog/render.test.ts fails on a stale one)",
}

/** The package.json fields that make another package reachable under pnpm. */
const DEPENDENCY_FIELDS = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
]

const SCOPE = "@miragon/pulse-"
const EXTENSION_NAME = "pulse-cockpit"
const KEBAB_CASE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const PRODUCT_PREFIX = /^pulse(?:-|$)/
const ROLE_LIST = CONNECTOR_ROLES.map((role) => `-${role}`)
  .join(", ")
  .replace(/, ([^,]+)$/, " or $1")
const LAYOUTS = "apps/<dir>, packages/core/<dir> or packages/connectors/<family>/<dir> (plus docs)"
const GATES_ON_LAYOUT =
  "dependency-cruiser, check-ratchets, mutation-diff and the ESLint budgets key on " + LAYOUTS
/** A glob the gates can expand: literal segments and a single-level `*`. */
const PLAIN_GLOB = /^(?:\*|[A-Za-z0-9_.-]+)(?:\/(?:\*|[A-Za-z0-9_.-]+))*$/
const PACKAGE_ROOT = "(?:apps/[^/]+|packages/core/[^/]+|packages/connectors/[^/]+/[^/]+)"
const SRC_SCRIPT = new RegExp(`^${PACKAGE_ROOT}/src/.*\\.(mts|cts|js|mjs|cjs|jsx)$`, "i")
/** Files that make a directory its own install root: a nested workspace. */
const INSTALL_ROOT_FILES = new Set([
  "pnpm-workspace.yaml",
  "pnpm-lock.yaml",
  "package-lock.json",
  "npm-shrinkwrap.json",
  "yarn.lock",
  "bun.lock",
  "bun.lockb",
])

/** The layout a workspace directory belongs to, or undefined when no rule covers it. */
export function packageKind(dir) {
  if (dir === "docs") return "docs"
  if (/^apps\/[^/]+$/.test(dir)) return "app"
  if (/^packages\/core\/[^/]+$/.test(dir)) return "core"
  if (/^packages\/connectors\/[^/]+\/[^/]+$/.test(dir)) return "connector-family"
  return undefined
}

const roleSuffix = (base) => CONNECTOR_ROLES.find((role) => base.endsWith(`-${role}`))

const describeName = (name) =>
  name === undefined ? "package.json has no 'name'" : `the name is ${JSON.stringify(name)}`

/**
 * The lowest version a dependency or engines range allows, or undefined when
 * the range is not one this gate can read: a plain version, or one with `^`,
 * `~`, `>=` or `=`, with `x`/`*` wildcards for the trailing parts. Compound
 * ranges (`a - b`, `a || b`, `>a <b`), `>`/`<` and protocols (`workspace:`,
 * `npm:`) fail closed.
 */
export function versionFloor(range) {
  if (typeof range !== "string") return undefined
  const match =
    /^(?:\^|~|>=|=)?\s*v?(0|[1-9]\d*|[xX*])(?:\.(0|[1-9]\d*|[xX*]))?(?:\.(0|[1-9]\d*|[xX*]))?(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.exec(
      range.trim(),
    )
  if (!match) return undefined
  const parts = match.slice(1, 4)
  const open = parts.findIndex((part) => part === undefined || /^[xX*]$/.test(part))
  if (open !== -1) {
    // `1.x.3` or `1.x-beta` name no single lowest version.
    if (parts.slice(open).some((part) => part !== undefined && !/^[xX*]$/.test(part))) {
      return undefined
    }
    if (match[4] !== undefined) return undefined
  }
  return {
    version: parts.map((part, index) => (open !== -1 && index >= open ? 0 : Number(part))),
    prerelease: match[4] === undefined ? [] : match[4].split("."),
  }
}

/** Semver precedence of two versionFloor() results: negative, 0 or positive. */
export function compareVersions(a, b) {
  for (let index = 0; index < 3; index += 1) {
    if (a.version[index] !== b.version[index]) return a.version[index] - b.version[index]
  }
  // A prerelease sorts below its release (1.2.3-beta < 1.2.3).
  if (a.prerelease.length === 0 || b.prerelease.length === 0) {
    return b.prerelease.length - a.prerelease.length
  }
  for (let index = 0; index < Math.max(a.prerelease.length, b.prerelease.length); index += 1) {
    const [x, y] = [a.prerelease[index], b.prerelease[index]]
    if (x === undefined) return -1
    if (y === undefined) return 1
    if (x === y) continue
    const [xNumeric, yNumeric] = [/^\d+$/.test(x), /^\d+$/.test(y)]
    if (xNumeric && yNumeric) return Number(x) - Number(y)
    if (xNumeric !== yNumeric) return xNumeric ? -1 : 1
    return x < y ? -1 : 1
  }
  return 0
}

const formatVersion = ({ version, prerelease }) =>
  version.join(".") + (prerelease.length > 0 ? `-${prerelease.join(".")}` : "")

/**
 * The API level vsce compares: major.minor of a versionFloor() result. vsce ignores the
 * patch and any prerelease because DefinitelyTyped bumps the patch of @types/vscode on its
 * own (and Dependabot lets those patch bumps through), so `^1.101.0` against
 * `@types/vscode` 1.101.1 is fine, 1.102.0 is not.
 */
const apiLevel = ({ version }) => ({ version: [version[0], version[1], 0], prerelease: [] })

/** engines.vscode against every @types/vscode the manifest declares (vsce's own check). */
function checkVsCodeTypes(dir, manifest, engine) {
  const declared = ["dependencies", "devDependencies"]
    .map((field) => [field, manifest[field]?.["@types/vscode"]])
    .filter(([, range]) => range !== undefined)
  if (declared.length === 0) return []
  const engineFloor = versionFloor(engine)
  if (engineFloor === undefined) {
    return [
      `${dir}: engines.vscode ${JSON.stringify(engine)} is not a range this gate can read, so ` +
        `it cannot prove that vsce accepts the declared @types/vscode; write it as a plain ` +
        `range such as '^1.101.0'`,
    ]
  }
  const errors = []
  for (const [field, range] of declared) {
    const typesFloor = versionFloor(range)
    if (typesFloor === undefined) {
      errors.push(
        `${dir}: ${field}["@types/vscode"] is ${JSON.stringify(range)}, not a range this gate ` +
          `can read, so it cannot prove that vsce accepts the package; write it as a plain ` +
          `version or range such as '1.101.0' or '^1.101.0'`,
      )
    } else if (compareVersions(apiLevel(typesFloor), apiLevel(engineFloor)) > 0) {
      errors.push(
        `${dir}: ${field}["@types/vscode"] ${JSON.stringify(range)} allows nothing below ` +
          `${formatVersion(typesFloor)} (API ${apiLevel(typesFloor).version.slice(0, 2).join(".")}), ` +
          `but engines.vscode ${JSON.stringify(engine)} admits VS Code ` +
          `${formatVersion(engineFloor)} (API ${apiLevel(engineFloor).version.slice(0, 2).join(".")}): ` +
          `vsce refuses to package that, and the code ` +
          `would compile against API the oldest supported VS Code lacks; lower @types/vscode ` +
          `or raise engines.vscode`,
      )
    }
  }
  return errors
}

/** The rules of an app that declares engines.vscode: a VS Code extension. */
function checkExtension(dir, manifest, expected) {
  const errors = []
  if (manifest.name !== expected) {
    errors.push(
      `${dir}: a VS Code extension (an app whose package.json declares engines.vscode) must ` +
        `be named '${expected}', but ${describeName(manifest.name)}: vsce takes an unscoped ` +
        `name only, and <publisher>.<name> becomes the permanent Marketplace id`,
    )
  }
  const engine = manifest.engines.vscode
  if (typeof engine !== "string" || engine.trim() === "") {
    errors.push(
      `${dir}: engines.vscode must be a non-empty VS Code version range such as '^1.101.0', ` +
        `got ${JSON.stringify(engine)}`,
    )
  } else {
    errors.push(...checkVsCodeTypes(dir, manifest, engine))
  }
  return errors
}

/** The docs site: a private workspace package the root docs:* scripts filter on. */
function checkDocs(manifest) {
  const errors = []
  if (manifest.name !== "@miragon/pulse-docs") {
    errors.push(
      `docs: the npm name must be '@miragon/pulse-docs' (the root docs:* scripts filter on ` +
        `it), but ${describeName(manifest.name)}`,
    )
  }
  if (manifest.private !== true) {
    errors.push(`docs: must set "private": true; the site publishes to GitHub Pages, never to npm`)
  }
  return errors
}

/** The directory rules every app, foundation and connector-family package follows. */
function checkDirectory(dir, kind, base, expected) {
  const errors = []
  if (!KEBAB_CASE.test(base)) {
    errors.push(
      `${dir}: directory '${base}' must be lowercase kebab-case (words of a-z and 0-9 joined ` +
        `by '-'), since it becomes the package name '${expected}'; rename the directory`,
    )
  }
  if (PRODUCT_PREFIX.test(base)) {
    errors.push(
      `${dir}: directory '${base}' repeats the product prefix, so the package would be named ` +
        `'${expected}'; drop 'pulse' from the directory (the package name adds it)`,
    )
  }
  const role = roleSuffix(base)
  if (kind === "connector-family" && role === undefined) {
    errors.push(
      `${dir}: a connector-family package must end in ${ROLE_LIST} (the dependency-cruiser ` +
        `rules key on that suffix; a package without it falls out of them); rename it`,
    )
  }
  if (kind !== "connector-family" && role !== undefined) {
    errors.push(
      `${dir}: the role suffix -${role} belongs to packages/connectors/<family>/ only: the ` +
        `dependency-cruiser rules match @miragon/pulse-*-${role} by name and would treat this ` +
        `${kind === "app" ? "app" : "foundation package"} as a connector-family package; ` +
        `rename the directory`,
    )
  }
  return errors
}

/**
 * Naming violations of one workspace package (pure): `dir` is repo-relative
 * and POSIX, `manifest` its parsed package.json.
 */
export function checkPackageName(dir, manifest) {
  const kind = packageKind(dir)
  if (kind === undefined) {
    return [`${dir}: no naming rule covers this workspace package; move it to ${LAYOUTS}`]
  }
  const pkg = manifest ?? {}
  const extension = pkg.engines?.vscode !== undefined
  const errors = []
  if (extension && kind !== "app") {
    errors.push(
      `${dir}: engines.vscode marks a VS Code extension, and only an app under apps/ can be ` +
        `one: every npm gate skips an extension, so a package here that declared it would ` +
        `escape them; remove engines.vscode`,
    )
  }
  if (kind === "docs") return [...errors, ...checkDocs(pkg)]
  const base = path.posix.basename(dir)
  const expected = extension && kind === "app" ? EXTENSION_NAME : `${SCOPE}${base}`
  errors.push(...checkDirectory(dir, kind, base, expected))
  if (extension && kind === "app") return [...errors, ...checkExtension(dir, pkg, expected)]
  if (pkg.name !== expected) {
    errors.push(
      `${dir}: the npm name must be '${expected}' (directory and npm name carry the ` +
        `convention the rules match on), but ${describeName(pkg.name)}` +
        (kind === "app"
          ? "; only a VS Code extension (an app whose package.json declares engines.vscode) " +
            "goes without the scope"
          : ""),
    )
  }
  return errors
}

/** The package an `npm:` or `workspace:` alias names (`npm:@miragon/pulse-cli@^1`), else undefined. */
const aliasTarget = (spec) => /^(?:npm|workspace):((?:@[^/@]+\/)?[^/@]+)(?:@|$)/.exec(spec)?.[1]

/**
 * The repo-relative directory a relative `file:`, `link:` or `portal:` path or a
 * `workspace:./path` points to, else undefined (`workspace:*` is a range).
 */
function pathTarget(dir, spec) {
  const match = /^(?:(?:file|link|portal):(?!\/)(.+)|workspace:(\.{1,2}(?:\/.*)?))$/.exec(spec)
  const target = match?.[1] ?? match?.[2]
  return target === undefined ? undefined : path.posix.join(dir, target)
}

/**
 * Declarations of an app (pure). `packages` are [repo-relative dir, parsed
 * package.json] pairs ("." is the root); the app names are those of every
 * apps/<dir> among them. No package declares an app, its own name included (an
 * app imports its own modules by relative path): an app's own package.json
 * names it in `name` only.
 */
export function checkAppDependencies(packages) {
  const apps = new Map()
  for (const [dir, manifest] of packages) {
    if (packageKind(dir) === "app" && typeof manifest?.name === "string") {
      apps.set(manifest.name, dir)
    }
  }
  /** The app whose directory `target` lies in, else undefined. */
  const appAt = (target) => [...apps].find(([, dir]) => `${target}/`.startsWith(`${dir}/`))?.[0]
  const errors = []
  for (const [dir, manifest] of packages) {
    for (const field of DEPENDENCY_FIELDS) {
      const declared = manifest?.[field]
      if (declared === null || typeof declared !== "object") continue
      for (const [key, spec] of Object.entries(declared)) {
        const text = typeof spec === "string" ? spec.trim() : ""
        const target = pathTarget(dir, text)
        const app =
          [key, aliasTarget(text)].find((name) => apps.has(name)) ??
          (target === undefined ? undefined : appAt(target))
        if (app === undefined) continue
        const how = app === key ? "" : ` as ${JSON.stringify(key)}: ${JSON.stringify(text)}`
        errors.push(
          `${dir === "." ? "" : `${dir}/`}package.json: ${field} declares the app ${app} ` +
            `(${apps.get(app)})${how}. Under pnpm a workspace app is reachable from another package ` +
            `(an import, require.resolve, its bin, a spawned process) only through such a ` +
            `declaration, and the apps stay apart: no CLI inside the MCP server (no argv tool, ` +
            `no process), no extension wired to the CLI, no package on top of an app. Move ` +
            `what two of them share into a package (engine use cases into a -domain package, ` +
            `MCP plumbing into packages/core) and drop the declaration`,
        )
      }
    }
  }
  return errors
}

const isDirectory = (abs) => existsSync(abs) && statSync(abs).isDirectory()

/** Mirror of a `<rel>/*` workspace glob: the direct child directories. */
const childDirs = (root, rel) =>
  isDirectory(path.join(root, rel))
    ? readdirSync(path.join(root, rel), { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => path.posix.join(rel, entry.name))
        .sort()
    : []

/** pnpm-workspace.yaml reaches only the layouts above, and every package dir is in it. */
function checkWorkspace(root, packageDirs) {
  const file = path.join(root, "pnpm-workspace.yaml")
  const globs = existsSync(file) ? workspaceGlobs(readFileSync(file, "utf8")) : []
  if (globs.length === 0) {
    return [
      "pnpm-workspace.yaml: no packages: globs found (a plain block list under `packages:`), " +
        "so this gate cannot tell which packages pnpm and turbo build; restore the list",
    ]
  }
  const errors = []
  const plain = []
  for (const glob of globs) {
    if (!PLAIN_GLOB.test(glob) || glob.split("/").some((part) => part === "." || part === "..")) {
      errors.push(
        `pnpm-workspace.yaml: glob '${glob}' uses syntax the gates do not expand (only literal ` +
          `segments and a single-level '*'), so the packages it adds would escape them`,
      )
    } else if (packageKind(glob) === undefined) {
      errors.push(
        `pnpm-workspace.yaml: glob '${glob}' adds workspace packages outside ${LAYOUTS}; ` +
          `${GATES_ON_LAYOUT}, so a package there would fall out of every gate. Move the ` +
          `package into one of those layouts instead of adding a glob`,
      )
    } else {
      plain.push(glob)
    }
  }
  const workspace = new Set(expandWorkspaceGlobs(root, plain))
  for (const dir of packageDirs) {
    if (!workspace.has(dir)) {
      errors.push(
        `${dir}: has a package.json, but no pnpm-workspace.yaml glob includes it, so pnpm, ` +
          `turbo and check-package-scripts never see it; add its layout's glob back`,
      )
    }
  }
  return errors
}

/**
 * Walks apps/*, packages/core/* and packages/connectors/<family>/* (plus docs)
 * on disk and checks each package's name and the workspace globs.
 */
export function checkPackageNaming(root) {
  const errors = []
  for (const tier of ["apps", "packages/core", "packages/connectors"]) {
    if (!isDirectory(path.join(root, tier))) {
      errors.push(`${tier}/: missing; the layout expects ${LAYOUTS}`)
    }
  }
  const dirs = [
    ...childDirs(root, "apps"),
    ...childDirs(root, "packages/core"),
    ...childDirs(root, "packages/connectors").flatMap((family) => childDirs(root, family)),
    ...(existsSync(path.join(root, "docs", "package.json")) ? ["docs"] : []),
  ]
  const packageDirs = []
  const manifests = []
  const rootManifest = path.join(root, "package.json")
  if (existsSync(rootManifest)) {
    try {
      manifests.push([".", JSON.parse(readFileSync(rootManifest, "utf8"))])
    } catch (error) {
      errors.push(`package.json: not valid JSON (${error.message}); fix the file`)
    }
  }
  for (const dir of dirs) {
    const file = path.join(root, dir, "package.json")
    if (!existsSync(file)) {
      errors.push(
        `${dir}: missing package.json (a directory left behind by another branch, holding ` +
          `only ignored files such as node_modules/? remove it)`,
      )
      continue
    }
    let manifest
    try {
      manifest = JSON.parse(readFileSync(file, "utf8"))
    } catch (error) {
      errors.push(`${dir}: package.json is not valid JSON (${error.message}); fix the file`)
      continue
    }
    packageDirs.push(dir)
    manifests.push([dir, manifest])
    errors.push(...checkPackageName(dir, manifest))
  }
  errors.push(...checkAppDependencies(manifests))
  errors.push(...checkWorkspace(root, packageDirs))
  return { errors, checked: packageDirs.length }
}

/**
 * Layout violations over the repo's file list (pure): `files` are
 * repo-relative POSIX paths, as `git ls-files` prints them.
 */
export function checkLayout(files, { generatedDirs = GENERATED_DIRS } = {}) {
  const generated = new Set()
  const scripts = []
  const nested = []
  for (const file of files) {
    if (!/^(?:apps|packages)\//.test(file)) continue
    const segments = file.split("/")
    segments.slice(0, -1).forEach((segment, index) => {
      if (segment.toLowerCase() === "generated") {
        generated.add(segments.slice(0, index + 1).join("/"))
      }
    })
    if (SRC_SCRIPT.test(file)) scripts.push(file)
    const name = segments.at(-1)
    const dir = segments.slice(0, -1).join("/")
    if (name === "package.json" ? packageKind(dir) === undefined : INSTALL_ROOT_FILES.has(name)) {
      nested.push(file)
    }
  }
  const errors = []
  for (const dir of [...generated].sort()) {
    if (Object.hasOwn(generatedDirs, dir)) continue
    errors.push(
      `${dir}: a generated/ directory is exempt from ESLint, prettier and the app's source ` +
        `scans, so code in it escapes lint, formatting and the tool-name and hand-off guards ` +
        `(dependency-cruiser still reads it). Rename the directory, or, when ` +
        `a tool regenerates it and nobody edits it, list it in GENERATED_DIRS ` +
        `(scripts/check-package-naming.mjs) with the command that regenerates it`,
    )
  }
  for (const dir of Object.keys(generatedDirs).sort()) {
    if (generated.has(dir)) continue
    errors.push(
      `${dir}: GENERATED_DIRS lists it, but no file lives there any more; remove the stale ` +
        `entry (it would exempt whatever lands there next without review)`,
    )
  }
  for (const file of scripts.sort()) {
    errors.push(
      `${file}: a ${path.posix.extname(file)} source under src/ escapes the ESLint ` +
        `complexity and max-lines budgets and pattern gates (globbed *.{ts,tsx}) and ` +
        `widget-shell's brand-gate scans, which read .ts and .tsx only; write it as .ts or ` +
        `.tsx (a build script lives at the package root, outside src/)`,
    )
  }
  for (const file of nested.sort()) {
    errors.push(
      `${file}: a package.json, lockfile or pnpm-workspace.yaml here makes a nested package, ` +
        `but ${GATES_ON_LAYOUT}, so it falls out of every one of them. Merge it into its ` +
        `enclosing package or move it to one of those layouts (a test fixture is built at ` +
        `runtime under os.tmpdir(), never committed)`,
    )
  }
  return errors
}

/** The listed files that exist on disk as files (a deleted, unstaged one does not). */
export function existingFiles(root, files) {
  return files.filter((file) => {
    const abs = path.join(root, file)
    return existsSync(abs) && statSync(abs).isFile()
  })
}

/** Every file git tracks or would add: committed, staged or new and not ignored. */
export function listRepoFiles(root) {
  const listed = execFileSync(
    "git",
    ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
    { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  )
  return existingFiles(root, listed.split("\0").filter(Boolean))
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
if (isMain) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
  let files
  try {
    files = listRepoFiles(root)
  } catch (error) {
    console.error(
      `check-package-naming: could not list the repo's files with git ls-files ` +
        `(${String(error.message).trim()}); run it inside the git checkout`,
    )
    process.exit(1)
  }
  const naming = checkPackageNaming(root)
  const errors = [...naming.errors, ...checkLayout(files)]
  if (errors.length > 0) {
    console.error("Package layout and naming convention violations:\n")
    for (const error of errors) console.error(`  - ${error}`)
    console.error(
      "\nLayout + naming are load-bearing (CLAUDE.md invariant 8): rename or move the package " +
        "to the convention instead of adjusting this check.",
    )
    process.exit(1)
  }
  console.log(
    `Package naming: all ${naming.checked} workspace packages follow the app/core/connector/docs ` +
      `conventions, and the layout of ${files.length} repo files holds.`,
  )
}
