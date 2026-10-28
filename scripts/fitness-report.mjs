#!/usr/bin/env node
/**
 * `pnpm fitness` — the repo's fitness-function dashboard. Aggregates what the
 * gates already measure into one report: architecture graph (dependency-
 * cruiser), per-package coverage (from the
 * last `pnpm test` run's coverage-summary.json) and mutation scores (from
 * reports/mutation-report.json where a mutation run has happened: in CI only
 * the nightly "Mutation summary", so a pull request's report reads "(no run)").
 *
 * Read-only over existing artifacts except the architecture check, which is
 * fast enough to run inline. Appends the report to $GITHUB_STEP_SUMMARY in CI.
 */
import { execSync } from "node:child_process"
import { appendFileSync, existsSync, readFileSync, readdirSync } from "node:fs"

const lines = []
const put = (s = "") => lines.push(s)

// ── Architecture gates ──────────────────────────────────────────────────────
/** One line per dependency-cruiser run: its module/dependency counts or its violations. */
function architectureLine(command) {
  try {
    const out = execSync(command, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
    const counts = /no dependency violations found \((.+)\)/.exec(out)?.[1] ?? out.trim()
    return `0 violations (${counts})`
  } catch (err) {
    const out = `${err.stdout ?? ""}${err.stderr ?? ""}`
    const summary = /(\d+) dependency violations/.exec(out)?.[0] ?? "violations present"
    return `❌ ${summary}`
  }
}

const archLine = architectureLine(
  "pnpm exec depcruise apps/*/src packages/core/*/src packages/connectors/*/*/src --config .dependency-cruiser.cjs",
)
// The VS Code extension's own closed-world rules: the root script, so the command stays one.
const vscodeArchLine = architectureLine("pnpm --silent run lint:architecture:vscode")

put("## Fitness report")
put()
put(`- Architecture (dependency-cruiser): ${archLine}`)
put(`- Architecture, VS Code extension (apps/vscode/.dependency-cruiser.cjs): ${vscodeArchLine}`)
put()

// ── Per-package coverage + mutation ─────────────────────────────────────────
// Package roots: apps/*, packages/core/*, packages/connectors/<family>/*.
const listDirs = (root) =>
  existsSync(root)
    ? readdirSync(root, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => `${root}/${d.name}`)
    : []
const pkgDirs = [
  ...listDirs("apps"),
  ...listDirs("packages/core"),
  ...listDirs("packages/connectors").flatMap(listDirs),
]

const pct = (n) => (typeof n === "number" ? `${n.toFixed(1)}%` : "—")

function mutationScore(reportPath) {
  if (!existsSync(reportPath)) return null
  const report = JSON.parse(readFileSync(reportPath, "utf8"))
  let detected = 0
  let undetected = 0
  for (const file of Object.values(report.files ?? {})) {
    for (const mutant of file.mutants ?? []) {
      if (mutant.status === "Killed" || mutant.status === "Timeout") detected += 1
      else if (mutant.status === "Survived" || mutant.status === "NoCoverage") undetected += 1
    }
  }
  const valid = detected + undetected
  // The file count travels with the score: a local run may cover fewer files.
  return valid === 0
    ? null
    : { pct: (detected / valid) * 100, files: Object.keys(report.files).length }
}

put("| Package | Lines | Branches | Functions | Mutation score |")
put("| --- | --- | --- | --- | --- |")
for (const dir of pkgDirs) {
  const covPath = `${dir}/coverage/coverage-summary.json`
  const mutPath = `${dir}/reports/mutation-report.json`
  if (!existsSync(covPath) && !existsSync(mutPath)) continue
  const name = JSON.parse(readFileSync(`${dir}/package.json`, "utf8")).name
  const cov = existsSync(covPath) ? JSON.parse(readFileSync(covPath, "utf8")).total : null
  const score = mutationScore(mutPath)
  put(
    `| ${name} | ${pct(cov?.lines?.pct)} | ${pct(cov?.branches?.pct)} | ${pct(cov?.functions?.pct)} | ${
      score === null ? "— (no run)" : `${pct(score.pct)} (${score.files} file(s))`
    } |`,
  )
}
put()
put(
  "_Coverage from the last `pnpm test`. Mutation scores from the last Stryker run per package, over the file count next to each: in CI only the nightly run (`mutation-nightly.yml`, its Mutation summary job), over the package's whole `mutate` allowlist, so a pull request's rows read (no run). Missing rows: no artifacts yet._",
)

const report = lines.join("\n")
console.log(report)
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, report + "\n")
