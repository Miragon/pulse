#!/usr/bin/env node
/**
 * Package-scripts gate: `pnpm lint`, `pnpm typecheck` and `pnpm test` are
 * `turbo run <task>`, and turbo silently SKIPS a workspace package that does
 * not define the script. A package without `lint` therefore falls out of
 * every ESLint gate and complexity/max-lines budget while `pnpm lint` stays
 * green: the fail-open that kept both client packages unlinted until an
 * ESLint error had already landed there (#333).
 *
 * Every workspace package with a `src/` directory must define `lint` (ESLint
 * over src), `typecheck` (tsc) and `test` (vitest), each in its CANONICAL
 * shape: a command that merely mentions the tool can still switch its gate
 * off (`vitest run --coverage.enabled=false`, `eslint src || true`,
 * `eslint src --rule 'complexity: off'`). `typecheck` must cover every extra
 * `tsconfig.<x>.json` project of the package (the widget/UI/test sources only
 * those projects type-check).
 * Packages without `src/` (the docs site) carry no source the gates could
 * cover. An EXISTING package's gate scripts are additionally pinned to the
 * merge base by scripts/check-ratchets.mjs.
 *
 * The same source packages must also carry a `vitest.config.ts`: vitest runs
 * with coverage off by default, so no coverage floor would hold the package.
 *
 * Mutation testing covers exactly the packages MUTATED_PACKAGES names, each
 * with the reason the owner chose it: each carries a stryker.config.json, and
 * a stryker.config.json in any other package fails, since the nightly run
 * mutates every package that has one. Every stryker.config.json needs a
 * numeric `thresholds.break` above 0 (Stryker's default null never fails a
 * run), a `mutate` allowlist that selects files, and the json report at
 * reports/mutation-report.json, the one path the CI artifact and
 * scripts/fitness-report.mjs read.
 *
 * Editors read only files named tsconfig.json, so a tree only an extra project checks carries a
 * nested tsconfig.json that extends it, in the workspace's packages and the template's
 * (scripts/editor-projects.mjs says why and what holds).
 *
 * A pnpm filter that matches nothing exits 0 (pnpm 10), so a stale name turns a gate green
 * without running it, and `--fail-if-no-match` fails only when NO filter of the command
 * matches. So every filter in a tracked text file (docs included) that names a package names
 * one of its workspace, and every pnpm filter on a gate path carries the flag (checkFilters).
 *
 * Runs as `pnpm lint:package-scripts` (chained into the root `pnpm lint`).
 */
import { execFileSync } from "node:child_process"
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { editorProjectFindings, extraTsconfigs } from "./editor-projects.mjs"
import { MUTATION_PAUSED } from "./mutation-pause.mjs"

/**
 * The scripts every source package must define, each anchored to the command
 * it must actually run (no flags, no shell operators): `"lint": "true"` would
 * satisfy turbo and lint nothing, and so would `"lint": "eslint src || true"`.
 */
export const REQUIRED_SCRIPTS = {
  lint: {
    // `*.config.ts` (the one glob, last) also lints the package's root configs.
    pattern: /^eslint src(?: \w[\w-]*)*(?: \*\.config\.ts)?$/,
    expect:
      "`eslint src` (further source dirs and a final `*.config.ts` allowed; no flags or shell operators)",
  },
  typecheck: {
    pattern: /^tsc --noEmit(?: && tsc -p tsconfig\.[\w-]+\.json)*$/,
    expect: "`tsc --noEmit`, then `&& tsc -p tsconfig.<x>.json` per extra project",
  },
  test: {
    pattern: /^vitest run$/,
    expect:
      "`vitest run` (a flag such as --coverage.enabled=false switches the package's coverage ratchet off)",
  },
}

/**
 * The source packages mutation testing covers, each with the reason the owner
 * chose it, and no other: each must carry a valid stryker.config.json, and a
 * stryker.config.json in a package missing here fails the gate. An entry whose
 * dir is gone or has no src/ fails too, so the map cannot outlive its reason.
 * A package joins only by an owner decision.
 */
export const MUTATED_PACKAGES = {
  "packages/connectors/c7/c7-core":
    "owner decision 2026-11-04: c7-core (engine-core until 0.27) holds the pure engine rules the " +
    "CLI, the MCP server and the VS Code extension share, where a surviving mutant is a wrong " +
    "rule in all three; in a package without such rules a full run costs more than it finds",
  "packages/core/http":
    "owner decision 2026-11-08: the transport the MCP server, the CLI and the " +
    "VS Code extension send through (deadline, redirects, cap, credentials, failure reasons, " +
    "masking), where a surviving mutant is a wrong wire rule in all three",
  "packages/connectors/engine/engine-core":
    "owner decision 2026-11-09: the root-cause, value-kind and move-reason rules every dialect " +
    "and every interface share, where a surviving mutant is a wrong rule everywhere; only those " +
    "three files are mutated",
}

/** The one path the CI mutation artifact and scripts/fitness-report.mjs read. */
export const MUTATION_REPORT = "reports/mutation-report.json"

/** Whitespace-normalized command, or undefined when absent/empty. */
const normalizedCommand = (command) =>
  typeof command === "string" && command.trim() !== ""
    ? command.trim().replace(/\s+/g, " ")
    : undefined

/**
 * Violations for one package.json's `scripts` block (pure; unit-tested).
 * `tsconfigs`: the package's extra `tsconfig.<x>.json` files.
 */
export function checkPackageScripts(dir, scripts, { tsconfigs = [] } = {}) {
  const errors = []
  for (const [name, { pattern, expect }] of Object.entries(REQUIRED_SCRIPTS)) {
    const command = normalizedCommand(scripts?.[name])
    if (command === undefined) {
      errors.push(
        `${dir}: missing "${name}" script: turbo skips the package, so \`pnpm ${name}\` ` +
          `never covers its src/ (expected: ${expect})`,
      )
    } else if (!pattern.test(command)) {
      errors.push(`${dir}: "${name}" script is "${command}", expected it to run ${expect}`)
    }
  }
  const typecheck = normalizedCommand(scripts?.typecheck) ?? ""
  for (const tsconfig of tsconfigs) {
    if (!typecheck.split(" && ").includes(`tsc -p ${tsconfig}`)) {
      errors.push(
        `${dir}: "typecheck" does not run \`tsc -p ${tsconfig}\`: the sources only that ` +
          `project covers (widgets, UI, tests) would go unchecked`,
      )
    }
  }
  return errors
}

const MUTATE_EXAMPLE = '["src/**/*.ts", "!src/**/*.test.ts"]'

/**
 * Violations for one parsed stryker.config.json (pure; unit-tested). Each rule
 * closes a default that keeps a run green or its score invisible.
 */
export function checkStrykerConfig(dir, config) {
  const where = `${dir}/stryker.config.json`
  const errors = []
  const threshold = config?.thresholds?.break
  if (typeof threshold !== "number" || !(threshold > 0 && threshold <= 100)) {
    errors.push(
      `${where}: thresholds.break is ${JSON.stringify(threshold) ?? "missing"}; Stryker then ` +
        `never fails the run, so the nightly run passes any score. Set it to the package's floor, ` +
        `a number above 0 and at most 100 (raise it as the score rises, never lower it)`,
    )
  }
  const mutate = config?.mutate
  if (!Array.isArray(mutate) || mutate.some((p) => typeof p !== "string" || p.trim() === "")) {
    errors.push(
      `${where}: "mutate" is not a list of glob strings; without one Stryker mutates its ` +
        `default globs. List the files the tests cover, ` +
        `e.g. ${MUTATE_EXAMPLE}`,
    )
  } else if (!mutate.some((p) => !p.startsWith("!"))) {
    errors.push(
      `${where}: "mutate" selects nothing (it is empty or only negations), so no change to ` +
        `the package is ever mutation-tested. List the files the tests cover, e.g. ${MUTATE_EXAMPLE}`,
    )
  }
  if (!Array.isArray(config?.reporters) || !config.reporters.includes("json")) {
    errors.push(
      `${where}: "reporters" does not include "json"; without the json report the score never ` +
        `reaches the CI artifact or the fitness report. Add "json" to "reporters"`,
    )
  }
  const reportPath = config?.jsonReporter?.fileName
  if (reportPath !== MUTATION_REPORT) {
    errors.push(
      `${where}: jsonReporter.fileName is ` +
        `${reportPath === undefined ? "unset (Stryker writes reports/mutation/mutation.json)" : JSON.stringify(reportPath)}; ` +
        `the CI artifact and scripts/fitness-report.mjs read only ${MUTATION_REPORT}, so the ` +
        `score would vanish silently. Set "jsonReporter": { "fileName": "${MUTATION_REPORT}" }`,
    )
  }
  return errors
}

/**
 * Violations for the configs one source package must carry (pure; unit-tested).
 * `stryker`: `{ exists, config, parseError }` as read from its
 * stryker.config.json; `mutatedReason`: its MUTATED_PACKAGES entry, if any;
 * `mutationPaused`: skip the Stryker rules (scripts/mutation-pause.mjs).
 */
export function checkPackageConfigs(
  dir,
  { hasVitestConfig, stryker, mutatedReason, mutationPaused = false },
) {
  const errors = []
  if (!hasVitestConfig) {
    errors.push(
      `${dir}: no vitest.config.ts; vitest's default runs with coverage off, so \`vitest run\` ` +
        `never measures the package and no coverage floor holds it. Add one that merges ` +
        `sharedConfig from vitest.shared.ts and sets the package's coverage thresholds`,
    )
  }
  if (mutationPaused) return errors
  if (mutatedReason === undefined) {
    if (stryker.exists) {
      errors.push(
        `${dir}: carries a stryker.config.json but is not in MUTATED_PACKAGES, and the nightly ` +
          `run mutates every package with one. Mutation testing covers only the packages the ` +
          `owner chose: remove the config, or add the package to MUTATED_PACKAGES in ` +
          `scripts/check-package-scripts.mjs with the owner's reason`,
      )
    }
    return errors
  }
  if (!stryker.exists) {
    errors.push(
      `${dir}: listed in MUTATED_PACKAGES but has no stryker.config.json, so the nightly ` +
        `mutation run never covers it. Add one with a "mutate" allowlist, a numeric ` +
        `thresholds.break and the json report at ${MUTATION_REPORT}`,
    )
    return errors
  }
  if (stryker.parseError !== undefined) {
    errors.push(
      `${dir}/stryker.config.json is not valid JSON (${stryker.parseError}); Stryker cannot ` +
        `load it and no gate can read it. Fix the syntax`,
    )
  } else {
    errors.push(...checkStrykerConfig(dir, stryker.config))
  }
  return errors
}

/**
 * Violations of the mutation map itself (pure; unit-tested): every entry is
 * still a source package and carries a reason.
 */
export function checkMutatedPackages(sourceDirs, mutated) {
  const where = "MUTATED_PACKAGES in scripts/check-package-scripts.mjs"
  const errors = []
  for (const [dir, reason] of Object.entries(mutated)) {
    if (!sourceDirs.includes(dir)) {
      errors.push(
        `${where}: "${dir}" is not a workspace package with src/ (gone or renamed); move the ` +
          `entry to the package's new dir or remove it`,
      )
    }
    if (typeof reason !== "string" || reason.trim() === "") {
      errors.push(
        `${where}: "${dir}" carries no reason; name the owner decision that put the package ` +
          `under mutation testing, or remove the entry`,
      )
    }
  }
  return errors
}

/** A package's stryker.config.json as `{ exists, config, parseError }`. */
function readStrykerConfig(abs) {
  const file = path.join(abs, "stryker.config.json")
  if (!existsSync(file)) return { exists: false }
  try {
    return { exists: true, config: JSON.parse(readFileSync(file, "utf8")) }
  } catch (error) {
    return { exists: true, parseError: error instanceof Error ? error.message : String(error) }
  }
}

/** The `packages:` globs of pnpm-workspace.yaml (plain list form). */
export function workspaceGlobs(yamlText) {
  const globs = []
  let inPackages = false
  for (const line of yamlText.split("\n")) {
    if (/^packages:\s*$/.test(line)) {
      inPackages = true
      continue
    }
    if (inPackages) {
      const item = /^\s+-\s+["']?([^"'#\s]+)["']?/.exec(line)
      if (item) globs.push(item[1])
      else if (/^\S/.test(line)) break
    }
  }
  return globs
}

/**
 * Expand `a/*` / `a/*\/*` / `docs` style workspace globs into package dirs. Only literal segments
 * and a whole `*` segment are understood; any other glob throws, so a new workspace tier never
 * drops silently out of the gates that read the workspace.
 */
export function expandWorkspaceGlobs(root, globs) {
  const dirs = []
  for (const glob of globs) {
    let current = [""]
    for (const segment of glob.split("/")) {
      if (segment !== "*" && (/[*?![\]{}]/.test(segment) || ["", ".", ".."].includes(segment))) {
        throw new Error(
          `pnpm-workspace.yaml lists "${glob}": the gates expand literal segments and a whole ` +
            `"*" segment only. Write the glob that way or teach expandWorkspaceGlobs it.`,
        )
      }
      const next = []
      for (const base of current) {
        const abs = path.join(root, base)
        if (segment === "*") {
          if (!existsSync(abs)) continue
          for (const entry of readdirSync(abs, { withFileTypes: true })) {
            if (entry.isDirectory() && entry.name !== "node_modules") {
              next.push(path.posix.join(base, entry.name))
            }
          }
        } else if (existsSync(path.join(abs, segment))) {
          next.push(path.posix.join(base, segment))
        }
      }
      current = next
    }
    dirs.push(...current.filter((dir) => existsSync(path.join(root, dir, "package.json"))))
  }
  return [...new Set(dirs)].sort()
}

/**
 * Every violation in the workspace under `root` (reads the tree; tested over
 * tmpdir fixtures and the real repo). `sourceDirs`: the packages with src/.
 */
export function checkWorkspace(
  root,
  globs,
  { mutatedPackages = MUTATED_PACKAGES, mutationPaused = false } = {},
) {
  const errors = []
  const sourceDirs = []
  for (const dir of expandWorkspaceGlobs(root, globs)) {
    const abs = path.join(root, dir)
    if (!existsSync(path.join(abs, "src"))) continue
    sourceDirs.push(dir)
    const { scripts } = JSON.parse(readFileSync(path.join(abs, "package.json"), "utf8"))
    const stryker = readStrykerConfig(abs)
    errors.push(
      ...checkPackageScripts(dir, scripts, { tsconfigs: extraTsconfigs(abs) }),
      ...checkPackageConfigs(dir, {
        hasVitestConfig: existsSync(path.join(abs, "vitest.config.ts")),
        stryker,
        mutatedReason: Object.hasOwn(mutatedPackages, dir) ? mutatedPackages[dir] : undefined,
        mutationPaused,
      }),
    )
  }
  if (!mutationPaused) errors.push(...checkMutatedPackages(sourceDirs, mutatedPackages))
  return { errors, sourceDirs }
}

/** The template's workspace: it ships the packages' layout to customers. */
export const TEMPLATE_WORKSPACE = "templates/composed-server"

/**
 * Editor findings (scripts/editor-projects.mjs) for the workspace's source packages and the
 * template's. `ts` is the TypeScript module, which the caller loads.
 */
export function checkEditorProjects(ts, root, sourceDirs) {
  const template = path.join(root, TEMPLATE_WORKSPACE)
  const templateDirs = expandWorkspaceGlobs(
    template,
    workspaceGlobs(readFileSync(path.join(template, "pnpm-workspace.yaml"), "utf8")),
  )
    .filter((dir) => existsSync(path.join(template, dir, "src")))
    .map((dir) => path.posix.join(TEMPLATE_WORKSPACE, dir))
  return [...sourceDirs, ...templateDirs].flatMap((dir) =>
    editorProjectFindings(ts, path.join(root, dir), dir),
  )
}

const FILTER = /(?:--filter(?:=|\s+)|\s-F\s+)\\?["']?([^\s"'`)\\]+)/g

/**
 * The package a filter target names, selectors stripped (`!x`, `...x`, `x...`, `x^...`): a
 * scoped `@scope/name` or an unscoped `pulse-<name>` (a VS Code extension). A path selector
 * (`./apps/x`, `{apps/x}`) and a glob name no package; --fail-if-no-match covers them.
 */
const filterTarget = (raw) =>
  /^(?:@[\w.-]+\/[\w.-]+|pulse-[a-z0-9-]+)$/.exec(
    raw
      .replace(/^!/, "")
      .replace(/^\.\.\.\^?/, "")
      .replace(/\^?\.\.\.$/, ""),
  )?.[0]

/** `file:line --filter name` for every package a filter in `text` names that `known` lacks. */
export const unknownFilters = (file, text, known) =>
  text.split("\n").flatMap((line, index) =>
    [...line.matchAll(FILTER)]
      .map((match) => filterTarget(match[1] ?? ""))
      .filter((name) => name !== undefined && !known.has(name))
      .map((name) => `${file}:${index + 1} --filter ${name}`),
  )

/**
 * Where a command runs as a gate: the root and every workspace package's scripts, the
 * Dockerfile, the workflows and their composite actions, the gate shell scripts.
 */
export const GATE_PATH =
  /^(?:package\.json|(?:apps|packages)\/(?:[^/]+\/)+package\.json|docs\/package\.json|Dockerfile|\.github\/workflows\/[^/]+\.ya?ml|\.github\/actions\/(?:[^/]+\/)*[^/]+\.ya?ml|scripts\/[^/]+\.sh)$/

/** A pnpm command whose filter is pnpm's (not one turbo receives after `pnpm turbo`). */
const pnpmFilters = (command) => {
  const filter = command.search(/--filter\b|\s-F\s/)
  const turbo = command.search(/\bturbo\b/)
  return /\bpnpm\b/.test(command) && filter >= 0 && (turbo < 0 || turbo > filter)
}

/** `file:line command` for every pnpm filter in `text` that exits 0 when it matches nothing. */
export const laxFilters = (file, text) =>
  text.split("\n").flatMap((line, index) =>
    line.trim().startsWith("#")
      ? []
      : line
          .split(/&&|\|\||;|\|/)
          .filter((command) => pnpmFilters(command) && !command.includes("--fail-if-no-match"))
          .map((command) => `${file}:${index + 1} ${command.trim()}`),
  )

/**
 * Filter violations over `files` ([{ file, text }], repo-relative). A file under templates/
 * may also name the template's own packages.
 */
export function checkFilters(files) {
  const names = (inTemplate) =>
    files
      .filter(({ file }) => /(?:^|\/)package\.json$/.test(file))
      .filter(({ file }) => file.startsWith("templates/") === inTemplate)
      .map(({ text }) => JSON.parse(text).name)
  const workspace = new Set(names(false))
  const template = new Set([...workspace, ...names(true)])
  return files.flatMap(({ file, text }) => [
    ...unknownFilters(file, text, file.startsWith("templates/") ? template : workspace).map(
      (hit) => `${hit}: names no workspace package, so the filter matches nothing`,
    ),
    ...(GATE_PATH.test(file) ? laxFilters(file, text) : []).map(
      (hit) => `${hit}: a pnpm filter on a gate path needs --fail-if-no-match`,
    ),
  ])
}

/** Release history, generated and vendored files: no filter in them runs or is copied. */
const UNFILTERED = /^(?:CHANGELOG\.md|pnpm-lock\.yaml|docs\/\.vitepress\/miragon\/)/

/** Every text file git tracks or would add, as { file, text }. */
export function repoTextFiles(root) {
  return execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  })
    .split("\0")
    .filter((file) => file !== "" && !UNFILTERED.test(file))
    .flatMap((file) => {
      const abs = path.join(root, file)
      if (!existsSync(abs) || !statSync(abs).isFile()) return []
      const bytes = readFileSync(abs)
      return bytes.subarray(0, 8000).includes(0) ? [] : [{ file, text: bytes.toString("utf8") }]
    })
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
if (isMain) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
  const globs = workspaceGlobs(readFileSync(path.join(root, "pnpm-workspace.yaml"), "utf8"))
  if (globs.length === 0) {
    console.error("check-package-scripts: no workspace globs found in pnpm-workspace.yaml")
    process.exit(1)
  }
  const { errors, sourceDirs } = checkWorkspace(root, globs, { mutationPaused: MUTATION_PAUSED })
  errors.push(...checkFilters(repoTextFiles(root)))
  // Loaded here, never at the top: ci-scopes.mjs imports this module before any install.
  const { default: ts } = await import("typescript")
  errors.push(...checkEditorProjects(ts, root, sourceDirs))
  if (errors.length > 0) {
    console.error(
      "Workspace packages with missing or non-canonical gate scripts, configs, filters or " +
        "editor projects:\n",
    )
    for (const error of errors) console.error(`  - ${error}`)
    console.error(
      "\nFix the package, never the gate: a source package outside " +
        "`turbo run lint|typecheck|test` or without a vitest.config.ts is invisible to the " +
        "gates, and a stryker.config.json belongs in exactly the packages MUTATED_PACKAGES " +
        "lists (CLAUDE.md, Verification); a file only a tsconfig.<x>.json checks opens in a " +
        "nested tsconfig.json that extends that project (scripts/editor-projects.mjs).",
    )
    process.exit(1)
  }
  const mutated = Object.keys(MUTATED_PACKAGES).join(", ")
  const mutation = MUTATION_PAUSED
    ? "(mutation testing paused, stryker.config.json not checked: scripts/mutation-pause.mjs)"
    : `(a gated stryker.config.json in ${mutated} and in no other package)`
  console.log(
    `Package scripts: all ${sourceDirs.length} source packages run the canonical lint, typecheck and test, carry a vitest.config.ts ${mutation}, and every pnpm filter names a workspace package; editors open every file with the settings of the project that checks it (with the template's packages).`,
  )
}
