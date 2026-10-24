#!/usr/bin/env node
/**
 * PR-diff mutation gate: runs Stryker only over source files the branch
 * actually changed, per package. Full-repo mutation is too slow for a PR
 * check; the diff scope keeps the loop honest — changed logic must kill its
 * mutants (enforced by each package's `thresholds.break` in
 * stryker.config.json).
 *
 * A workspace package participates by having a stryker.config.json. The
 * package roots are the ones the other gates know (PACKAGE_FILE below):
 * apps/<app>, packages/core/<pkg> and packages/connectors/<family>/<pkg>, so
 * an app under apps/ is gated the moment it brings a config, and
 * scripts/check-package-scripts.mjs requires one for every source package
 * except the apps it exempts by name (NO_MUTATION_APPS). A stryker package
 * outside these roots fails the gate instead of being skipped. Only changed
 * files inside the config's `mutate` allowlist count (widgets are deliberately
 * outside it: they have no render tests, so mutating them would only produce
 * no-coverage noise). A config without a `mutate` list fails the gate too:
 * Stryker would mutate its default globs, which the gate cannot mirror.
 *
 * A package with more than FILE_CAP in-scope changed files FAILS the gate
 * (it used to be skipped with exit 0 — a large refactor then got no mutation
 * check at all). Split the change, or opt out explicitly and reviewably with
 * a commit trailer in the branch range:
 *
 *   Mutation-Cap-Exception: <reason, e.g. the full local run's score>
 *
 * Usage: node scripts/mutation-diff.mjs [baseRef]   (default origin/main)
 */
import { execFileSync, spawnSync } from "node:child_process"
import { existsSync, readFileSync, rmSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import picomatch from "picomatch"
import { expandWorkspaceGlobs, workspaceGlobs } from "./check-package-scripts.mjs"

/** Gitignored, per-package, wiped before every gate run — see below. */
const GATE_INCREMENTAL_FILE = ".stryker-tmp/diff-gate-incremental.json"

/** Guard against unbounded runtime on huge diffs — loudly, never silently. */
export const FILE_CAP = 25

export const CAP_EXCEPTION_TRAILER = /^Mutation-Cap-Exception: .+/m

/**
 * The package roots, the same set check-ratchets.mjs (PKG) and
 * fitness-report.mjs know: apps/<app>, packages/core/<pkg> and
 * packages/connectors/<family>/<pkg>. A changed file outside them is never
 * mutated, so a new root form (a new workspace glob, a new tier) must be added
 * here AND to check-ratchets.mjs PKG: mutation-diff.test.mjs holds every
 * workspace dir with src/ or a stryker.config.json to this list, and main()
 * refuses to run while a stryker package sits outside it.
 */
const PACKAGE_FILE = /^(apps\/[^/]+|packages\/(?:core\/[^/]+|connectors\/[^/]+\/[^/]+))\/(.+)$/

/**
 * The package root of a repo-relative file and the file's path inside it, or
 * null for a file outside every package root (pure, no IO).
 */
export function packageOf(file) {
  const match = PACKAGE_FILE.exec(file)
  return match ? { pkg: match[1], rel: match[2] } : null
}

/**
 * Mirror Stryker's own `mutate` semantics. picomatch instead of a hand-rolled
 * glob→RegExp: a home-grown converter silently under-scoped `**` to a single
 * path segment, which quietly dropped nested files (e.g. widget-shell's
 * src/ui/bpmn-heatmap/) out of the gate. Positives and negatives are matched
 * separately on purpose — picomatch ORs an array, so passing `mutate` verbatim
 * would make a single `!…` entry match everything else.
 */
export function inMutateScope(relFile, mutatePatterns) {
  const positives = mutatePatterns.filter((p) => !p.startsWith("!"))
  const negatives = mutatePatterns.filter((p) => p.startsWith("!")).map((p) => p.slice(1))
  return picomatch.isMatch(relFile, positives) && !picomatch.isMatch(relFile, negatives)
}

/** A package's `mutate` allowlist as read, or a throw when it is not a list of globs. */
function mutateAllowlist(pkg, mutate) {
  if (mutate === null) return null
  if (!Array.isArray(mutate) || mutate.some((pattern) => typeof pattern !== "string")) {
    throw new Error(
      `mutation-diff: ${pkg}/stryker.config.json has no "mutate" allowlist; the gate cannot ` +
        `mirror Stryker's default globs. Declare one: a list of glob strings such as ` +
        `["src/**/*.ts", "!src/**/*.test.ts"].`,
    )
  }
  return mutate
}

/**
 * The changed files each package's Stryker run must mutate: a Map from package
 * root to the in-scope paths inside it (IO injected; unit-tested). Files
 * outside every package root and deleted files (`fileExists` false) drop out.
 * `mutateOf(pkg)` returns null when the package has no stryker.config.json
 * and the config's `mutate` value otherwise; it is called once per package.
 * A config whose `mutate` is not a list of glob strings THROWS: skipping it
 * would pass the gate without a run.
 */
export function changedFilesByPackage(changed, { fileExists, mutateOf }) {
  const allowlists = new Map()
  const byPackage = new Map()
  for (const file of changed) {
    const owner = packageOf(file)
    if (!owner || !fileExists(file)) continue
    const { pkg, rel } = owner
    if (!allowlists.has(pkg)) allowlists.set(pkg, mutateAllowlist(pkg, mutateOf(pkg)))
    const mutate = allowlists.get(pkg)
    if (mutate === null || !inMutateScope(rel, mutate)) continue
    if (!byPackage.has(pkg)) byPackage.set(pkg, [])
    byPackage.get(pkg).push(rel)
  }
  return byPackage
}

/**
 * Which packages run and which hit the cap (pure; unit-tested). Over the cap
 * a package FAILS the gate unless `exceptionReason` (the trailer line) is set
 * — then it is skipped with a loud warning instead.
 */
export function planMutationRuns(byPackage, { cap = FILE_CAP, exceptionReason } = {}) {
  const runs = []
  const capped = []
  for (const [pkg, files] of byPackage) {
    if (files.length > cap) capped.push({ pkg, count: files.length })
    else runs.push({ pkg, files })
  }
  return { runs, capped, failed: capped.length > 0 && !exceptionReason }
}

/**
 * The pnpm arguments of one package's diff-scoped run (pure; unit-tested).
 * `--fail-if-no-match` stands before `run`, where pnpm reads its own options:
 * pnpm 10 exits 0 on a filter that matches no workspace package (a stryker
 * dir that is not a workspace member, say), which would pass the gate unrun.
 */
export function strykerArgs(pkg, files, incrementalFile = GATE_INCREMENTAL_FILE) {
  return [
    "--fail-if-no-match",
    "--filter",
    `./${pkg}`,
    "run",
    "test:mutation",
    "--mutate",
    files.join(","),
    "--incrementalFile",
    incrementalFile,
  ]
}

/** The workspace dirs (pnpm-workspace.yaml under `root`) that carry a stryker.config.json. */
export function strykerPackages(root) {
  const globs = workspaceGlobs(readFileSync(path.join(root, "pnpm-workspace.yaml"), "utf8"))
  return expandWorkspaceGlobs(root, globs).filter((dir) =>
    existsSync(path.join(root, dir, "stryker.config.json")),
  )
}

/** The dirs that are not a package root of their own (pure): their changes are never gated. */
export function unknownPackageRoots(dirs) {
  return dirs.filter((dir) => packageOf(`${dir}/stryker.config.json`)?.pkg !== dir)
}

/** The `mutate` value of a stryker.config.json, null when the file does not exist. */
function readMutate(configPath) {
  if (!existsSync(configPath)) return null
  const { mutate } = JSON.parse(readFileSync(configPath, "utf8"))
  // A literal `"mutate": null` is a config without an allowlist, not a missing config.
  return mutate ?? undefined
}

function main() {
  // Every path below is repo-relative (git prints them so), whatever the cwd.
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" })
  const base = process.argv[2] ?? "origin/main"
  const mergeBase = git("merge-base", base, "HEAD").trim()
  const changed = git("diff", "--name-only", mergeBase, "HEAD").split("\n").filter(Boolean)

  const outside = unknownPackageRoots(strykerPackages(root))
  if (outside.length > 0) {
    for (const dir of outside) {
      console.error(
        `::error::mutation-diff: ${dir} carries a stryker.config.json but is not a package root ` +
          `this gate knows (apps/<app>, packages/core/<pkg>, packages/connectors/<family>/<pkg>), ` +
          `so its changes would never be mutation-tested. Move the package to one of those roots, ` +
          `or add its form to PACKAGE_FILE in scripts/mutation-diff.mjs and to PKG in ` +
          `scripts/check-ratchets.mjs.`,
      )
    }
    process.exit(1)
  }

  const byPackage = changedFilesByPackage(changed, {
    fileExists: (file) => existsSync(path.join(root, file)),
    mutateOf: (pkg) => readMutate(path.join(root, pkg, "stryker.config.json")),
  })

  if (byPackage.size === 0) {
    console.log(`mutation-diff: no changed files inside any mutation scope vs ${base} — skipping.`)
    process.exit(0)
  }

  const exceptionReason = CAP_EXCEPTION_TRAILER.exec(
    git("log", `${mergeBase}..HEAD`, "--format=%B"),
  )?.[0]
  const plan = planMutationRuns(byPackage, { exceptionReason })
  for (const { pkg, count } of plan.capped) {
    const local = `pnpm --fail-if-no-match --filter ./${pkg} run test:mutation`
    if (exceptionReason) {
      console.log(
        `::warning::mutation-diff: ${pkg} changed ${count} in-scope files (cap ${FILE_CAP}) — ` +
          `NOT mutation-tested, waved through by "${exceptionReason}". Reviewers: check that ` +
          `the reason names a full local run (${local}).`,
      )
    } else {
      console.error(
        `::error::mutation-diff: ${pkg} changed ${count} in-scope files (cap ${FILE_CAP}) — the ` +
          `diff gate cannot cover it. Split the change, or run \`${local}\` locally and add a ` +
          `commit trailer "Mutation-Cap-Exception: <reason + score>" (reviewed like any commit).`,
      )
    }
  }

  let failed = plan.failed
  for (const { pkg, files } of plan.runs) {
    console.log(`mutation-diff: ${pkg} → ${files.length} file(s)\n  ${files.join("\n  ")}`)
    // Off the package's incremental cache, on a throwaway file wiped every run:
    // that cache would fold the OTHER files' cached results back into the score
    // and the gate would pass locally on a file that fails on CI's fresh
    // checkout. Also keeps reports/mutation-report.json scoped to the diff.
    rmSync(path.join(root, pkg, GATE_INCREMENTAL_FILE), { force: true })
    const result = spawnSync("pnpm", strykerArgs(pkg, files), { cwd: root, stdio: "inherit" })
    if (result.status !== 0) failed = true
  }
  process.exit(failed ? 1 : 0)
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
if (isMain) main()
