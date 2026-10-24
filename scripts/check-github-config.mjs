#!/usr/bin/env node
/**
 * GitHub-config gate: the workflows, the Dependabot config and the release config are code no
 * pull request runs. A release job runs only on a release, a nightly only at night, Dependabot
 * only after the merge, and a required check that no job reports leaves every PR waiting. So
 * what they must hold is pinned here, against the workspace as it is, which also covers
 * packages that do not exist yet (a public CLI under apps/, a VS Code extension, a -domain
 * package) the moment they land:
 *
 * - publish-npm-package.yml packs without id-token and publishes in a job that holds ONLY
 *   `id-token: write` (checkPublishWorkflow);
 * - release-please.yml's publish-npm matrix lists exactly the workspace packages npm receives
 *   (checkPublishMatrix), and release-please-config.json bumps every workspace package
 *   (checkReleaseExtraFiles);
 * - dependabot.yml groups never shadow each other and name only directories that exist
 *   (checkDependabot);
 * - every check the main-branch ruleset requires is a job a pull request runs
 *   (checkRequiredChecks);
 * - the mutation artifacts and the nightly full run cover every package form
 *   (checkArtifactGlobs, checkNightlyMutation).
 *
 * The test (check-github-config.test.mjs) also RUNS the bash steps of the publish workflow
 * (against stub npm and curl executables) and of the nightly run in fixture trees.
 *
 * Runs as `pnpm lint:github` (chained into the root `pnpm lint`).
 */
import { existsSync, readdirSync, readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { isDeepStrictEqual } from "node:util"
import { parse } from "yaml"
import { expandWorkspaceGlobs, workspaceGlobs } from "./check-package-scripts.mjs"

export const PUBLISH_WORKFLOW = ".github/workflows/publish-npm-package.yml"
export const RELEASE_WORKFLOW = ".github/workflows/release-please.yml"
export const CI_WORKFLOW = ".github/workflows/ci.yml"
export const NIGHTLY_WORKFLOW = ".github/workflows/mutation-nightly.yml"

/**
 * The status checks ruleset 15024440 (branch main) requires. A MIRROR of a GitHub setting that
 * no file in the repo holds (read it with `gh api repos/Miragon/pulse/rulesets/15024440`): keep
 * the two equal by hand. A job renamed, split into a matrix or moved behind a paths filter never
 * reports its check, and every pull request then waits for it forever.
 */
export const REQUIRED_CHECKS = [
  "TypeScript (Build + Test + Lint)",
  "Lint + Format",
  "Mutation (changed files)",
  "Fitness report",
  "Composed-server template (Build + Test)",
  "Kotlin (Build + Test)",
  "CIB Seven Example (Build + Test)",
  "Validate Conventional Commit title",
  "Dependency Review",
]

/** The directories the Resolve package step of the publish workflow accepts. */
export const PUBLISHABLE_DIR =
  /^(apps\/[a-z0-9][a-z0-9-]*|packages\/core\/[a-z0-9][a-z0-9-]*|packages\/connectors\/[a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9-]*)$/

/** A VS Code extension: an app whose package.json declares engines.vscode. */
export const isVscodeExtension = (manifest) => manifest?.engines?.vscode !== undefined

/** Published to npm: not private and no VS Code extension, which ships as a .vsix instead. */
export const isNpmPublished = (manifest) =>
  manifest?.private !== true && !isVscodeExtension(manifest)

/** Every workspace package as `{ dir, manifest }`, sorted by directory. */
export function readWorkspace(root) {
  const globs = workspaceGlobs(readFileSync(path.join(root, "pnpm-workspace.yaml"), "utf8"))
  return expandWorkspaceGlobs(root, globs).map((dir) => ({
    dir,
    manifest: JSON.parse(readFileSync(path.join(root, dir, "package.json"), "utf8")),
  }))
}

/** The wildcard globs of pnpm-workspace.yaml: the forms a package directory can take. */
export const packageForms = (globs) => globs.filter((glob) => glob.includes("*"))

const asList = (value) => (value === undefined || value === null ? [] : [value].flat())
const jobsOf = (doc) => Object.entries(doc?.jobs ?? {})
const stepsOf = (job) => (Array.isArray(job?.steps) ? job.steps : [])
const usesAction = (step, action) =>
  typeof step?.uses === "string" && step.uses.split("@")[0] === action
const runOf = (step) => (typeof step?.run === "string" ? step.run : "")
const lines = (text) =>
  String(text ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
const environmentOf = (job) =>
  typeof job?.environment === "object" ? job.environment?.name : job?.environment

/** The events a workflow runs on, whatever form its `on` takes. */
export function triggersOf(doc) {
  const on = doc?.on
  if (typeof on === "string") return { [on]: null }
  if (Array.isArray(on)) return Object.fromEntries(on.map((event) => [event, null]))
  return on && typeof on === "object" ? on : {}
}

// ── publish-npm-package.yml ─────────────────────────────────────────────────

const INSTALLS = /\b(?:pnpm|yarn|npx|corepack|bun)\b|\bnpm\s+(?:ci|install|i|exec|x|run|rebuild)\b/

/** Violations of the two-job publish shape (pure; the doc is the parsed workflow). */
export function checkPublishWorkflow(doc) {
  const errors = []
  const where = PUBLISH_WORKFLOW
  const inputs = doc?.on?.workflow_call?.inputs ?? {}
  if (inputs.package !== undefined) {
    errors.push(
      `${where}: the input "package" (a directory under packages/) is retired; the input is ` +
        `"directory", repo-relative`,
    )
  }
  for (const name of ["directory", "version"]) {
    if (inputs[name]?.required !== true || inputs[name]?.type !== "string") {
      errors.push(`${where}: needs the required string input "${name}"`)
    }
  }
  if (!isDeepStrictEqual(doc?.permissions, {})) {
    errors.push(
      `${where}: top-level permissions must be {}: each job names its own, and only the ` +
        `publish job may hold id-token`,
    )
  }
  if (doc?.defaults?.run?.shell !== "bash") {
    errors.push(
      `${where}: defaults.run.shell must be bash (-eo pipefail, the flags its test runs the ` +
        `steps with)`,
    )
  }

  const jobs = jobsOf(doc)
  const tokenJobs = jobs.filter(([, job]) => job?.permissions?.["id-token"] === "write")
  if (tokenJobs.length !== 1) {
    errors.push(
      `${where}: exactly one job may hold id-token: write (the publish job), found ${tokenJobs.length}`,
    )
  }
  for (const [id, job] of tokenJobs) {
    const at = `${where}: job ${id}`
    if (!isDeepStrictEqual(job.permissions, { "id-token": "write" })) {
      errors.push(`${at} must hold exactly { id-token: write }, nothing next to the token`)
    }
    if (environmentOf(job) !== "npm") {
      errors.push(`${at} must run in the environment npm: the trusted publisher binds it`)
    }
    if (!String(job.if ?? "").includes("inputs.dry_run")) {
      errors.push(`${at} must skip itself on a dry run (if: inputs.dry_run)`)
    }
    const needs = asList(job.needs)
    if (needs.length === 0) {
      errors.push(`${at} must need the pack job, which builds the tarball without the token`)
    }
    for (const step of stepsOf(job)) {
      for (const action of ["actions/checkout", "pnpm/action-setup", "actions/cache"]) {
        if (usesAction(step, action)) {
          errors.push(`${at} uses ${action}: the token job checks out, installs and caches nothing`)
        }
      }
      const install = INSTALLS.exec(runOf(step))?.[0]
      if (install) {
        errors.push(
          `${at} runs "${install}": no package manager runs next to the token (only npm publish)`,
        )
      }
    }
    const publish = stepsOf(job).filter((step) => /\bnpm publish\b/.test(runOf(step)))
    if (publish.length === 0) {
      errors.push(`${at} must run npm publish <tgz> --provenance`)
    }
    for (const step of publish) {
      if (!/\bnpm publish\b.*--provenance/.test(runOf(step))) {
        errors.push(`${at}: npm publish must pass --provenance`)
      }
    }
    for (const packId of needs) {
      const pack = doc.jobs?.[packId]
      const packAt = `${where}: job ${packId}`
      if (pack === undefined) {
        errors.push(`${at} needs ${packId}, which does not exist`)
        continue
      }
      if (!isDeepStrictEqual(pack.permissions, { contents: "read" })) {
        errors.push(`${packAt} (the pack job) must hold exactly { contents: read }`)
      }
      if (environmentOf(pack) !== undefined) {
        errors.push(`${packAt} (the pack job) runs in no environment`)
      }
      if (!stepsOf(pack).some((step) => /\bpnpm pack\b/.test(runOf(step)))) {
        errors.push(`${packAt} (the pack job) must run pnpm pack`)
      }
      for (const step of stepsOf(pack)) {
        if (usesAction(step, "actions/checkout") && step.with?.["persist-credentials"] !== false) {
          errors.push(`${packAt}: actions/checkout must set persist-credentials: false`)
        }
      }
    }
  }

  for (const [id, job] of jobs) {
    for (const step of stepsOf(job)) {
      const at = `${where}: job ${id}`
      const run = runOf(step)
      if (/\bnpm pack\b/.test(run)) {
        errors.push(`${at}: npm pack ships workspace:* verbatim; use pnpm pack`)
      }
      if (/\bpnpm publish\b/.test(run)) {
        errors.push(
          `${at}: pnpm publish needs the workspace next to the token; publish the packed ` +
            `tarball with npm publish`,
        )
      }
      if (run.includes("${{")) {
        errors.push(
          `${at}: a run script holds a \${{ }} expression (template injection); pass it through env`,
        )
      }
      if (usesAction(step, "actions/cache")) {
        errors.push(`${at} uses actions/cache: a release job restores no cache into the tarball`)
      }
      if (step?.with?.cache !== undefined) {
        errors.push(`${at}: ${step.uses} sets cache: a release job restores no dependency cache`)
      }
      if (
        usesAction(step, "actions/setup-node") &&
        step.with?.["package-manager-cache"] !== false
      ) {
        errors.push(`${at}: actions/setup-node must set package-manager-cache: false`)
      }
      if (usesAction(step, "actions/upload-artifact") && !String(step.with?.name).includes("${{")) {
        errors.push(
          `${at}: the artifact name "${step.with?.name}" is constant, but every matrix call ` +
            `uploads into the caller's run, where a name exists once`,
        )
      }
    }
  }
  return errors
}

// ── release-please.yml + release-please-config.json ─────────────────────────

const describe = ({ dir, manifest }) => `${dir} (${manifest?.name ?? "no name"})`

/** The publish-npm matrix equals the workspace packages npm receives (pure). */
export function checkPublishMatrix(releaseDoc, packages) {
  const errors = []
  const where = `${RELEASE_WORKFLOW}: job publish-npm`
  const job = releaseDoc?.jobs?.["publish-npm"]
  if (job === undefined) return [`${RELEASE_WORKFLOW}: the job publish-npm is missing`]
  if (job.uses !== `./${PUBLISH_WORKFLOW}`) {
    errors.push(`${where} must call ./${PUBLISH_WORKFLOW}`)
  }
  if (job.with?.directory !== "${{ matrix.directory }}") {
    errors.push(`${where} must pass directory: \${{ matrix.directory }}`)
  }
  if (typeof job.with?.version !== "string" || job.with.version === "") {
    errors.push(`${where} must pass version (the release tag the tarball has to carry)`)
  }
  if (!isDeepStrictEqual(job.permissions, { contents: "read", "id-token": "write" })) {
    errors.push(
      `${where} must hold exactly { contents: read, id-token: write }: the ceiling of the ` +
        `called pack and publish jobs`,
    )
  }
  if (job.strategy?.["fail-fast"] !== false) {
    errors.push(`${where} must set fail-fast: false (one failed package stops no other)`)
  }
  if (!asList(releaseDoc.jobs?.["sync-template-mirror"]?.needs).includes("publish-npm")) {
    errors.push(
      `${RELEASE_WORKFLOW}: sync-template-mirror must need publish-npm (it mirrors pins of ` +
        `published packages)`,
    )
  }

  const matrix = asList(job.strategy?.matrix?.directory)
  const byDir = new Map(packages.map((pkg) => [pkg.dir, pkg]))
  const seen = new Set()
  for (const entry of matrix) {
    if (seen.has(entry)) errors.push(`${where}: ${entry} is listed twice`)
    seen.add(entry)
    const pkg = byDir.get(entry)
    if (pkg === undefined || !PUBLISHABLE_DIR.test(entry)) {
      errors.push(
        `${where}: ${entry} is no workspace package directory (repo-relative, e.g. ` +
          `packages/core/widget-shell)`,
      )
    } else if (isVscodeExtension(pkg.manifest)) {
      errors.push(
        `${where}: ${describe(pkg)} declares engines.vscode: a VS Code extension publishes ` +
          `through vsce/ovsx as a .vsix, never through the npm matrix`,
      )
    } else if (pkg.manifest?.private === true) {
      errors.push(`${where}: ${describe(pkg)} is private: npm never receives it`)
    }
  }
  for (const pkg of packages.filter(({ manifest }) => isNpmPublished(manifest))) {
    if (!PUBLISHABLE_DIR.test(pkg.dir)) {
      errors.push(
        `${describe(pkg)} is not private, but the publish workflow packs only apps/*, ` +
          `packages/core/* and packages/connectors/*/*: mark it "private": true`,
      )
    } else if (!seen.has(pkg.dir)) {
      errors.push(
        `${describe(pkg)} is published to npm (not private, no engines.vscode) but the release ` +
          `train never publishes it: add it to the publish-npm matrix`,
      )
    }
  }
  return errors
}

/** Every workspace package under apps/ and packages/, and the root, gets its version bumped. */
export function checkReleaseExtraFiles(config, packages, { fileExists = () => true } = {}) {
  const errors = []
  const extraFiles = asList(config?.packages?.["."]?.["extra-files"])
  const bumped = new Set(
    extraFiles
      .filter((entry) => entry?.type === "json" && entry?.jsonpath === "$.version")
      .map((entry) => entry.path),
  )
  const owners = [
    { dir: ".", manifest: { name: "the root" } },
    ...packages.filter(({ dir }) => /^(?:apps|packages)\//.test(dir)),
  ]
  for (const pkg of owners) {
    const file = pkg.dir === "." ? "package.json" : `${pkg.dir}/package.json`
    if (!bumped.has(file)) {
      errors.push(
        `release-please-config.json: ${file} (${pkg.manifest?.name}) is missing from extra-files ` +
          `as { type: json, jsonpath: $.version }: a release would leave its version behind ` +
          `(and the publish job refuses a tarball that is not the release tag)`,
      )
    }
  }
  for (const entry of extraFiles) {
    const file = typeof entry === "string" ? entry : entry?.path
    if (typeof file !== "string" || !fileExists(file)) {
      errors.push(`release-please-config.json: the extra-files path ${file} does not exist`)
    }
  }
  return errors
}

// ── dependabot.yml ──────────────────────────────────────────────────────────

const isCatchAll = (group) => isDeepStrictEqual(group?.patterns, ["*"])

/** Groups never shadow each other, directories exist, @types/vscode stays at the floor. */
export function checkDependabot(doc, { packages, dirExists }) {
  const errors = []
  const where = ".github/dependabot.yml"
  const updates = asList(doc?.updates)
  for (const entry of updates) {
    const at = `${where} (${entry?.["package-ecosystem"]} ${asList(entry?.directory ?? entry?.directories).join(", ")})`
    const groups = Object.entries(entry?.groups ?? {})
    const catchAllAt = groups.findIndex(([, group]) => isCatchAll(group))
    if (catchAllAt >= 0) {
      const [catchAllName, catchAll] = groups[catchAllAt]
      groups.forEach(([name], index) => {
        if (index > catchAllAt) {
          errors.push(
            `${at}: ${name} is listed after the catch-all ${catchAllName}: Dependabot assigns a ` +
              `dependency to the first matching group, so it would never fill`,
          )
        }
      })
      const excluded = new Set(asList(catchAll["exclude-patterns"]))
      for (const [name, group] of groups) {
        if (isCatchAll(group)) continue
        for (const pattern of asList(group?.patterns)) {
          if (!excluded.has(pattern)) {
            errors.push(
              `${at}: ${pattern} of group ${name} is missing from ${catchAllName}.exclude-patterns`,
            )
          }
        }
      }
    }
    for (const dir of [...asList(entry?.directory), ...asList(entry?.directories)]) {
      const rel = String(dir).replace(/^\/+/, "") || "."
      if (!dirExists(rel)) {
        errors.push(`${at}: ${dir} does not exist: Dependabot fails that update job every run`)
      }
    }
  }
  const extensions = packages.filter(({ manifest }) => isVscodeExtension(manifest))
  if (extensions.length > 0) {
    const held = updates
      .filter((entry) => entry?.["package-ecosystem"] === "npm")
      .some((entry) =>
        asList(entry.ignore).some((rule) => {
          const types = asList(rule?.["update-types"])
          return (
            rule?.["dependency-name"] === "@types/vscode" &&
            types.includes("version-update:semver-minor") &&
            types.includes("version-update:semver-major")
          )
        }),
      )
    if (!held) {
      for (const pkg of extensions) {
        errors.push(
          `${where}: ${describe(pkg)} declares engines.vscode but @types/vscode minor/major ` +
            `updates are not ignored (vsce refuses @types/vscode newer than engines.vscode)`,
        )
      }
    }
  }
  return errors
}

// ── Required checks ─────────────────────────────────────────────────────────

const PR_EVENTS = ["pull_request", "pull_request_target"]

/** Each required check is a literal job name in a workflow every pull request runs. */
export function checkRequiredChecks(workflows, required = REQUIRED_CHECKS) {
  const errors = []
  for (const check of required) {
    const found = []
    for (const [file, doc] of workflows) {
      const triggers = triggersOf(doc)
      const events = PR_EVENTS.filter((event) => event in triggers)
      if (events.length === 0) continue
      for (const [id, job] of jobsOf(doc)) {
        if (job?.name === check) found.push({ file, id, job, triggers, events })
      }
    }
    if (found.length === 0) {
      errors.push(
        `"${check}" is a required check (ruleset 15024440) but no job of a pull_request ` +
          `workflow carries that name: every PR would wait for it forever`,
      )
    }
    for (const { file, id, job, triggers, events } of found) {
      for (const event of events) {
        const filter = ["paths", "paths-ignore"].find((key) => triggers[event]?.[key] !== undefined)
        if (filter) {
          errors.push(
            `${file}: "${check}" (job ${id}) is required, but ${event} has a ${filter} filter: ` +
              `a PR outside it never reports the check`,
          )
        }
      }
      if (job.strategy?.matrix !== undefined) {
        errors.push(
          `${file}: "${check}" (job ${id}) is required, but a matrix reports one check per leg ` +
            `under another name; aggregate the legs in a job of that name`,
        )
      }
    }
  }
  return errors
}

// ── Mutation artifacts + the nightly full run ───────────────────────────────

const uploadsOf = (doc) =>
  jobsOf(doc).flatMap(([id, job]) =>
    stepsOf(job)
      .filter((step) => usesAction(step, "actions/upload-artifact"))
      .map((step) => ({ id, step, paths: lines(step.with?.path) })),
  )

/** The reports and summaries every package form writes reach the fitness report (pure). */
export function checkArtifactGlobs(ciDoc, nightlyDoc, globs) {
  const errors = []
  const forms = packageForms(globs)
  const expectPaths = (file, upload, suffix) => {
    for (const form of forms) {
      if (!upload.paths.includes(`${form}/${suffix}`)) {
        errors.push(
          `${file}: the upload of ${upload.step.with?.name} misses ${form}/${suffix}: that ` +
            `package form's numbers never reach the report`,
        )
      }
    }
  }
  for (const [file, doc] of [
    [CI_WORKFLOW, ciDoc],
    [NIGHTLY_WORKFLOW, nightlyDoc],
  ]) {
    for (const upload of uploadsOf(doc)) {
      for (const glob of upload.paths.filter((p) => p.includes("**"))) {
        errors.push(
          `${file}: job ${upload.id} uploads ${glob}: upload-artifact follows symlinks, so ** ` +
            `walks pnpm's workspace links in node_modules; use one exact-depth glob per form`,
        )
      }
      const name = String(upload.step.with?.name ?? "")
      if (name === "mutation-reports" || name.startsWith("mutation-report-")) {
        expectPaths(file, upload, "reports/mutation-report.json")
      }
      if (name === "coverage-summaries") expectPaths(file, upload, "coverage/coverage-summary.json")
    }
  }
  if (!uploadsOf(ciDoc).some(({ step }) => step.with?.name === "mutation-reports")) {
    errors.push(`${CI_WORKFLOW}: no step uploads the artifact mutation-reports`)
  }
  const mutation = ciDoc?.jobs?.mutation
  const timeout = mutation?.["timeout-minutes"]
  if (typeof timeout !== "number" || timeout > 60) {
    errors.push(
      `${CI_WORKFLOW}: job mutation needs timeout-minutes of at most 60 (FILE_CAP bounds a ` +
        `package at about 30 min)`,
    )
  }
  for (const [id, job] of jobsOf(ciDoc)) {
    for (const step of stepsOf(job)) {
      if (
        usesAction(step, "actions/download-artifact") &&
        step.with?.name === "mutation-reports" &&
        step.with?.path !== undefined
      ) {
        errors.push(
          `${CI_WORKFLOW}: job ${id} downloads mutation-reports into ${step.with.path}; the ` +
            `artifact carries the apps/ and packages/ prefixes, so it unpacks at the repo root`,
        )
      }
    }
  }
  return errors
}

/** The nightly full Stryker run: off every pull request, over every package form (pure). */
export function checkNightlyMutation(doc, globs) {
  const errors = []
  const where = NIGHTLY_WORKFLOW
  if (doc === undefined) return [`${where} is missing: nothing runs the full Stryker suite`]
  const events = Object.keys(triggersOf(doc))
  for (const event of events.filter((e) => e !== "schedule" && e !== "workflow_dispatch")) {
    errors.push(
      `${where}: runs on ${event}; the full run is nightly (schedule, workflow_dispatch) and ` +
        `never a pull request check`,
    )
  }
  if (!asList(triggersOf(doc).schedule).some((entry) => typeof entry?.cron === "string")) {
    errors.push(`${where}: needs a schedule with a cron`)
  }
  if (triggersOf(doc).workflow_dispatch?.inputs?.force?.type !== "boolean") {
    errors.push(`${where}: workflow_dispatch needs the boolean input force`)
  }
  if (!doc.concurrency?.group || doc.concurrency?.["cancel-in-progress"] !== false) {
    errors.push(`${where}: needs a concurrency group of its own with cancel-in-progress: false`)
  }
  const list = stepsOf(doc.jobs?.packages).find((step) => step?.id === "list")
  if (list === undefined) {
    errors.push(`${where}: job packages needs the step id list (the matrix source)`)
  } else {
    const tokens = runOf(list).split(/[\s;]+/)
    for (const form of packageForms(globs)) {
      if (!tokens.includes(form)) {
        errors.push(
          `${where}: the list step misses the package form ${form} (pnpm-workspace.yaml): its ` +
            `packages would never get a nightly run`,
        )
      }
    }
    if (!runOf(list).includes("stryker.config.json")) {
      errors.push(`${where}: the list step must pick the dirs that carry a stryker.config.json`)
    }
  }
  const legs = jobsOf(doc).filter(([, job]) =>
    String(job?.strategy?.matrix?.include ?? "").includes("needs.packages.outputs.packages"),
  )
  if (legs.length !== 1) {
    errors.push(`${where}: needs one matrix job over needs.packages.outputs.packages`)
  }
  for (const [id, job] of legs) {
    if (job.strategy?.["fail-fast"] !== false) {
      errors.push(`${where}: job ${id} must set fail-fast: false`)
    }
    if (typeof job["timeout-minutes"] !== "number") {
      errors.push(`${where}: job ${id} needs timeout-minutes`)
    }
    const runs = stepsOf(job).map(runOf)
    if (!runs.some((run) => /--fail-if-no-match --filter\b.*\brun test:mutation\b/.test(run))) {
      errors.push(
        `${where}: job ${id} must run pnpm --fail-if-no-match --filter ./<dir> run test:mutation`,
      )
    }
  }
  return errors
}

// ── Main ────────────────────────────────────────────────────────────────────

const readYaml = (root, file) =>
  existsSync(path.join(root, file)) ? parse(readFileSync(path.join(root, file), "utf8")) : undefined

/** Every violation of the repo at `root`. */
export function checkRepo(root) {
  const globs = workspaceGlobs(readFileSync(path.join(root, "pnpm-workspace.yaml"), "utf8"))
  const packages = readWorkspace(root)
  const workflowDir = path.join(root, ".github/workflows")
  const workflows = new Map(
    readdirSync(workflowDir)
      .filter((name) => /\.ya?ml$/.test(name))
      .sort()
      .map((name) => [`.github/workflows/${name}`, readYaml(root, `.github/workflows/${name}`)]),
  )
  const exists = (rel) => existsSync(path.join(root, rel))
  return [
    ...checkPublishWorkflow(workflows.get(PUBLISH_WORKFLOW)),
    ...checkPublishMatrix(workflows.get(RELEASE_WORKFLOW), packages),
    ...checkReleaseExtraFiles(
      JSON.parse(readFileSync(path.join(root, "release-please-config.json"), "utf8")),
      packages,
      { fileExists: exists },
    ),
    ...checkDependabot(readYaml(root, ".github/dependabot.yml"), { packages, dirExists: exists }),
    ...checkRequiredChecks(workflows),
    ...checkArtifactGlobs(workflows.get(CI_WORKFLOW), workflows.get(NIGHTLY_WORKFLOW), globs),
    ...checkNightlyMutation(workflows.get(NIGHTLY_WORKFLOW), globs),
  ]
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
if (isMain) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
  const errors = checkRepo(root)
  if (errors.length > 0) {
    console.error("GitHub config out of line with the workspace:\n")
    for (const error of errors) console.error(`  - ${error}`)
    console.error(
      "\nFix the workflow or config instead of this gate: what it pins never runs in a pull " +
        "request (CLAUDE.md, Releases).",
    )
    process.exit(1)
  }
  console.log(
    "GitHub config: publish workflow, npm matrix, release extra-files, Dependabot groups, " +
      `${REQUIRED_CHECKS.length} required checks and the nightly mutation run hold.`,
  )
}
