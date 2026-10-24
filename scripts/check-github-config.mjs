#!/usr/bin/env node
/**
 * GitHub-config gate: the workflows, the Dependabot config and the release config are code no
 * pull request runs. A release job runs only on a release, a nightly only at night, Dependabot
 * only after the merge, and a required check that no job reports leaves every PR waiting. So
 * what they must hold is pinned here, against the workspace as it is, which also covers
 * packages that do not exist yet (a public CLI under apps/, a VS Code extension, a -domain
 * package) the moment they land:
 *
 * - publish-npm-package.yml packs without id-token and publishes in the one job that holds
 *   id-token, as exactly `id-token: write`, using only actions/setup-node and
 *   actions/download-artifact at the repo's pins and running no package manager
 *   (checkPublishWorkflow);
 * - release-please.yml's publish-npm matrix lists exactly the workspace packages npm receives,
 *   each naming this repository for its provenance (checkPublishMatrix), and
 *   release-please-config.json bumps every workspace package (checkReleaseExtraFiles) and
 *   every Claude Code plugin manifest an app ships (checkPluginVersions);
 * - every job of release-please.yml past the approval waits for gate, and release-please.yml
 *   calls the CLI's publish workflows, which run on no other trigger (a dispatch only publishes
 *   the formula of a release again) and hold their tokens like the npm publish
 *   (checkReleaseGate, checkCliPublishWorkflows);
 * - dependabot.yml groups never shadow each other and name only directories that exist
 *   (checkDependabot);
 * - every check the main-branch ruleset requires is a job a pull request runs
 *   (checkRequiredChecks);
 * - the coverage and mutation artifacts cover every package form and unpack at the repo root,
 *   the diff gate stays within its timeout, and the nightly full run lists every package form,
 *   forces a run every week and caches each package's incremental file under a fingerprinted
 *   key, the file every stryker.config.json writes (checkArtifactGlobs, checkNightlyMutation,
 *   checkStrykerIncremental).
 *
 * The test (check-github-config.test.mjs) also RUNS the bash steps of the publish workflow
 * (against stub npm and curl executables), of the CLI's release (the tap update against a stub
 * gh) and of the nightly run in fixture trees.
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

/** The only actions the token job may use: the runtime and the pack job's tarball. */
export const TOKEN_JOB_ACTIONS = ["actions/setup-node", "actions/download-artifact"]

/** An exact pin: a full version tag or a commit SHA, never a moving ref such as v7 or main. */
const EXACT_REF = /^(?:v\d+\.\d+\.\d+|[0-9a-f]{40})$/

/**
 * npm's verbs that install, rebuild or run package code, with every alias npm 11 accepts for
 * them (`npm i`, `npm add`, `npm it`, `npm cit`, `npm up`, `npm rb`, `npm x` and more). Next to
 * the token only `npm --version`, `npm view` and `npm publish` run. A verb you need there that
 * this list catches is a sign the step belongs in the pack job, which holds no token.
 */
const NPM_CODE_VERBS = [
  ...["install", "i", "in", "ins", "inst", "insta", "instal", "add"],
  ...["isnt", "isnta", "isntal", "isntall"],
  ...["install-test", "it", "install-ci-test", "cit", "sit", "clean-install-test"],
  ...["ci", "clean-install", "ic", "install-clean", "isntall-clean"],
  ...["update", "up", "upgrade", "udpate", "rebuild", "rb"],
  ...["exec", "x", "run", "run-script", "rum", "urn"],
  ...["test", "tst", "t", "start", "stop", "restart"],
  ...["dedupe", "ddp", "link", "ln", "init", "create", "innit", "explore"],
  ...["uninstall", "un", "unlink", "remove", "rm", "r"],
]
const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
// `npm`, any flags (`-g`, `--loglevel=silent`, `--prefix /tmp`), then one of the verbs.
const NPM_RUNS_CODE = new RegExp(
  String.raw`\bnpm(?:\s+--?[\w-]+(?:=\S*|\s+[^\s-]\S*)?)*\s+(?:` +
    NPM_CODE_VERBS.map(escapeRegExp).join("|") +
    String.raw`)(?![\w-])`,
)
const OTHER_PACKAGE_MANAGERS = /\b(?:pnpm|pnpx|yarn|yarnpkg|npx|corepack|bun|bunx)\b/

/** The package manager command a run script starts, if any (the first one found). */
export const packageManagerRun = (script) =>
  OTHER_PACKAGE_MANAGERS.exec(script)?.[0] ?? NPM_RUNS_CODE.exec(script)?.[0]

/**
 * A job holds id-token when its permissions grant it in any form: a string such as write-all
 * (read-all included, so a string never slips past this rule) or a map that names id-token at
 * all. A job without permissions inherits the top level, which must be {}.
 */
const holdsIdToken = (job) => {
  const permissions = job?.permissions
  if (permissions === undefined) return false
  if (permissions === null || typeof permissions !== "object" || Array.isArray(permissions)) {
    return true
  }
  return Object.hasOwn(permissions, "id-token")
}

/** Each action's refs in `workflows` (a Map of file to parsed doc), for the token job's pins. */
export function actionRefs(workflows) {
  const refs = new Map()
  for (const [, doc] of workflows) {
    for (const [, job] of jobsOf(doc)) {
      for (const step of stepsOf(job)) {
        if (typeof step?.uses !== "string" || !step.uses.includes("@")) continue
        const [action, ref] = step.uses.split("@")
        refs.set(action, new Set([...(refs.get(action) ?? []), ref]))
      }
    }
  }
  return refs
}

/**
 * Violations of the two-job publish shape (pure; the doc is the parsed workflow). `pinnedRefs`
 * (from actionRefs over the other workflows) holds the token job's actions at the versions the
 * rest of the repo runs; Dependabot moves them all in one pull request.
 */
export function checkPublishWorkflow(doc, { pinnedRefs = new Map() } = {}) {
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
  const tokenJobs = jobs.filter(([, job]) => holdsIdToken(job))
  if (tokenJobs.length !== 1) {
    const ids = tokenJobs.map(([id]) => id).join(", ")
    errors.push(
      `${where}: exactly one job may hold id-token (the publish job, as { id-token: write }), ` +
        `found ${tokenJobs.length}${ids === "" ? "" : ` (${ids})`}; a string such as write-all ` +
        `or read-all counts as holding it`,
    )
  }
  for (const [id, job] of jobs) {
    if (environmentOf(job) === "npm" && !tokenJobs.some(([tokenId]) => tokenId === id)) {
      errors.push(
        `${where}: job ${id} runs in the environment npm without the token: only the publish ` +
          `job runs there`,
      )
    }
  }
  for (const [id, job] of tokenJobs) {
    const at = `${where}: job ${id}`
    if (!isDeepStrictEqual(job.permissions, { "id-token": "write" })) {
      errors.push(
        `${at} must hold exactly { id-token: write }, nothing next to the token (found ` +
          `${JSON.stringify(job.permissions)})`,
      )
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
      if (step?.uses !== undefined) {
        const [action, ref] = String(step.uses).split("@")
        if (!TOKEN_JOB_ACTIONS.includes(action)) {
          errors.push(
            `${at} uses ${step.uses}: the token job uses only ${TOKEN_JOB_ACTIONS.join(" and ")} ` +
              `(it checks out, installs and caches nothing)`,
          )
        } else if (!EXACT_REF.test(ref ?? "")) {
          errors.push(`${at} uses ${step.uses}: pin an exact version (vX.Y.Z) or a commit SHA`)
        } else if (pinnedRefs.has(action) && !pinnedRefs.get(action).has(ref)) {
          errors.push(
            `${at} uses ${step.uses}, but the other workflows run ${action}@` +
              `${[...pinnedRefs.get(action)].join(", @")}: keep the token job on the repo's pin`,
          )
        }
      }
      const install = packageManagerRun(runOf(step))
      if (install) {
        errors.push(
          `${at} runs "${install}": no package manager runs next to the token (only npm ` +
            `--version, npm view and npm publish)`,
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

/** The repository every npm-published package names: npm checks it against the provenance. */
export const REPOSITORY_URL = "git+https://github.com/Miragon/pulse.git"
export const expectedRepository = (dir) => ({ type: "git", url: REPOSITORY_URL, directory: dir })

/**
 * The publish-npm matrix equals the workspace packages npm receives, and each of them names this
 * repository in its manifest (pure).
 */
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
      continue
    }
    if (!seen.has(pkg.dir)) {
      errors.push(
        `${describe(pkg)} is published to npm (not private, no engines.vscode) but the release ` +
          `train never publishes it: add it to the publish-npm matrix`,
      )
    }
    // npm compares repository.url with the repository the provenance names (E422 otherwise);
    // directory keeps the npm page's source link on the package.
    const repository = expectedRepository(pkg.dir)
    if (!isDeepStrictEqual(pkg.manifest?.repository, repository)) {
      errors.push(
        `${describe(pkg)} is published to npm with provenance, so its package.json needs ` +
          `"repository": ${JSON.stringify(repository)} (found ` +
          `${JSON.stringify(pkg.manifest?.repository) ?? "none"}): npm refuses a provenance ` +
          `publish whose repository is not the one that built it`,
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

/**
 * Every Claude Code plugin manifest an app ships (`apps/<app>/skills/<skill>/.claude-plugin/
 * plugin.json`): its version is the release's too, so release-please bumps it with the rest.
 */
export function pluginManifests(root, packages) {
  return packages
    .filter(({ dir }) => dir.startsWith("apps/"))
    .flatMap(({ dir }) => {
      const skills = path.join(root, dir, "skills")
      if (!existsSync(skills)) return []
      return readdirSync(skills, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => `${dir}/skills/${entry.name}/.claude-plugin/plugin.json`)
        .filter((rel) => existsSync(path.join(root, rel)))
    })
    .sort()
}

/** Each plugin manifest is in extra-files as { type: json, jsonpath: $.version } (pure). */
export function checkPluginVersions(config, manifests) {
  const bumped = new Set(
    asList(config?.packages?.["."]?.["extra-files"])
      .filter((entry) => entry?.type === "json" && entry?.jsonpath === "$.version")
      .map((entry) => entry.path),
  )
  return manifests
    .filter((file) => !bumped.has(file))
    .map(
      (file) =>
        `release-please-config.json: ${file} is missing from extra-files as { type: json, ` +
        `jsonpath: $.version }: the plugin would announce the previous release's version`,
    )
}

// ── release-please.yml: the release gate ────────────────────────────────────

/** The jobs before the approval: release-please opens the release, gate is the approval. */
export const BEFORE_THE_GATE = ["release-please", "gate"]

/**
 * Every other job of release-please.yml waits for gate, the `release` environment's approval:
 * it needs gate directly or through another job that does (pure).
 */
export function checkReleaseGate(releaseDoc) {
  const errors = []
  const jobs = releaseDoc?.jobs ?? {}
  if (environmentOf(jobs.gate) !== "release") {
    errors.push(
      `${RELEASE_WORKFLOW}: job gate must run in the environment release: it is the approval ` +
        `every publish waits for`,
    )
  }
  const memo = new Map()
  const waits = (id, seen) => {
    if (id === "gate") return true
    if (memo.has(id)) return memo.get(id)
    if (seen.has(id) || jobs[id] === undefined) return false
    const result = asList(jobs[id].needs).some((need) => waits(need, new Set([...seen, id])))
    memo.set(id, result)
    return result
  }
  for (const id of Object.keys(jobs).filter((id) => !BEFORE_THE_GATE.includes(id))) {
    if (!waits(id, new Set())) {
      errors.push(
        `${RELEASE_WORKFLOW}: job ${id} never waits for gate (needs it, directly or through ` +
          `another job): it would publish without the release approval`,
      )
    }
  }
  return errors
}

// ── publish-cli.yml + publish-homebrew.yml ──────────────────────────────────

/** The CLI's release channels besides npm, called by release-please.yml after the gate. */
export const CLI_PUBLISH_WORKFLOWS = [
  ".github/workflows/publish-cli.yml",
  ".github/workflows/publish-homebrew.yml",
]

/**
 * The events each one runs on: the release calls both, and only the formula can be published
 * again by hand, from the assets of a release that exists. Nothing reaches the binaries or the
 * image without the approval.
 */
export const CLI_PUBLISH_TRIGGERS = {
  ".github/workflows/publish-cli.yml": ["workflow_call"],
  ".github/workflows/publish-homebrew.yml": ["workflow_call", "workflow_dispatch"],
}

const grantsWrite = (job) =>
  Object.values(job?.permissions ?? {}).some((value) => value === "write")

/**
 * The CLI's publish workflows hold their tokens the way the npm publish does (pure; `workflows`
 * holds release-please.yml too): release-please.yml calls each of them, each runs only on its
 * CLI_PUBLISH_TRIGGERS, no permission at the top level, a permissions map on every job, no
 * dependency cache, checkouts without persisted credentials, no expression in a run script, and
 * no package manager in a job that holds a write grant or id-token (the build jobs hold
 * contents: read only).
 */
export function checkCliPublishWorkflows(workflows) {
  const errors = []
  const callers = new Set(
    jobsOf(workflows.get(RELEASE_WORKFLOW)).map(([, job]) => String(job?.uses ?? "")),
  )
  for (const file of CLI_PUBLISH_WORKFLOWS) {
    const doc = workflows.get(file)
    if (doc === undefined) {
      errors.push(`${file} is missing: release-please.yml calls it`)
      continue
    }
    if (!callers.has(`./${file}`)) {
      errors.push(
        `${RELEASE_WORKFLOW}: no job calls ./${file}: a release would ship without that channel`,
      )
    }
    const allowed = CLI_PUBLISH_TRIGGERS[file]
    for (const event of Object.keys(triggersOf(doc)).filter((e) => !allowed.includes(e))) {
      errors.push(
        `${file}: runs on ${event}; it runs on ${allowed.join(" and ")} only, so nothing ` +
          `publishes without the release approval`,
      )
    }
    if (!isDeepStrictEqual(doc.permissions, {})) {
      errors.push(`${file}: top-level permissions must be {}: each job names its own`)
    }
    for (const [id, job] of jobsOf(doc)) {
      const at = `${file}: job ${id}`
      const permissions = job?.permissions
      if (permissions === null || typeof permissions !== "object" || Array.isArray(permissions)) {
        errors.push(
          `${at} must name its permissions as a map (a string such as write-all grants all)`,
        )
        continue
      }
      for (const step of stepsOf(job)) {
        const run = runOf(step)
        if (run.includes("${{")) {
          errors.push(
            `${at}: a run script holds a \${{ }} expression (template injection); pass it through env`,
          )
        }
        if (usesAction(step, "actions/checkout") && step.with?.["persist-credentials"] !== false) {
          errors.push(`${at}: actions/checkout must set persist-credentials: false`)
        }
        if (
          String(step?.uses ?? "").startsWith("actions/cache") ||
          step?.with?.cache !== undefined
        ) {
          errors.push(`${at}: a release job restores no cache`)
        }
        if (
          usesAction(step, "actions/setup-node") &&
          step.with?.["package-manager-cache"] !== false
        ) {
          errors.push(`${at}: actions/setup-node must set package-manager-cache: false`)
        }
        const install = grantsWrite(job) ? packageManagerRun(run) : undefined
        if (install) {
          errors.push(
            `${at} holds ${JSON.stringify(permissions)} and runs "${install}": a job that holds ` +
              `a write grant or id-token installs nothing; build in a job with contents: read`,
          )
        }
      }
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

/** The ceiling of the diff gate's timeout-minutes in ci.yml. */
export const MUTATION_TIMEOUT_CEILING = 120

/** The file the nightly caches per package: every stryker.config.json writes exactly this. */
export const INCREMENTAL_FILE = "reports/stryker-incremental.json"

const stepsUsing = (doc, action) =>
  jobsOf(doc).flatMap(([id, job]) =>
    stepsOf(job)
      .filter((step) => usesAction(step, action))
      .map((step) => ({ id, job, step, paths: lines(step.with?.path) })),
  )
const uploadsOf = (doc) => stepsUsing(doc, "actions/upload-artifact")
const isReportArtifact = (name) =>
  name === "coverage-summaries" ||
  name === "mutation-reports" ||
  String(name ?? "").startsWith("mutation-report-")

/** The jobs of the nightly that run one leg per listed package. */
const nightlyLegs = (doc) =>
  jobsOf(doc).filter(([, job]) =>
    String(job?.strategy?.matrix?.include ?? "").includes("needs.packages.outputs.packages"),
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
  for (const name of ["mutation-reports", "coverage-summaries"]) {
    if (!uploadsOf(ciDoc).some(({ step }) => step.with?.name === name)) {
      errors.push(`${CI_WORKFLOW}: no step uploads the artifact ${name}`)
    }
    if (
      !stepsUsing(ciDoc, "actions/download-artifact").some(({ step }) => step.with?.name === name)
    ) {
      errors.push(
        `${CI_WORKFLOW}: no step downloads the artifact ${name}: the fitness report would show ` +
          `"(no run)" for every package`,
      )
    }
  }
  const timeout = ciDoc?.jobs?.mutation?.["timeout-minutes"]
  if (typeof timeout !== "number" || timeout > MUTATION_TIMEOUT_CEILING) {
    errors.push(
      `${CI_WORKFLOW}: job mutation needs timeout-minutes of at most ${MUTATION_TIMEOUT_CEILING}: ` +
        `it runs the packages one after another and FILE_CAP caps each one, so the bound holds ` +
        `about four packages at the cap at about 1 min/file`,
    )
  }
  // Every report artifact carries the apps/ and packages/ prefixes (the globs' least common
  // ancestor is the repo root), so a download unpacks it over the checkout, where
  // fitness-report.mjs reads each package's coverage/ and reports/ files.
  for (const [file, doc] of [
    [CI_WORKFLOW, ciDoc],
    [NIGHTLY_WORKFLOW, nightlyDoc],
  ]) {
    for (const { id, step } of stepsUsing(doc, "actions/download-artifact")) {
      const artifact = step.with?.name ?? step.with?.pattern
      if (isReportArtifact(artifact) && step.with?.path !== undefined) {
        errors.push(
          `${file}: job ${id} downloads ${artifact} into ${step.with.path}; the artifact ` +
            `carries the apps/ and packages/ prefixes, so it unpacks at the repo root`,
        )
      }
    }
  }
  const legName = "mutation-report-${{ matrix.slug }}"
  for (const [id, job] of nightlyLegs(nightlyDoc)) {
    if (
      !stepsOf(job).some(
        (step) => usesAction(step, "actions/upload-artifact") && step.with?.name === legName,
      )
    ) {
      errors.push(
        `${NIGHTLY_WORKFLOW}: job ${id} must upload its report as ${legName} (one exact-depth ` +
          `glob per package form): the summary reads nothing else`,
      )
    }
  }
  const summaries = stepsUsing(nightlyDoc, "actions/download-artifact").filter(
    ({ step }) => step.with?.pattern === "mutation-report-*",
  )
  if (summaries.length === 0) {
    errors.push(
      `${NIGHTLY_WORKFLOW}: no step downloads pattern mutation-report-*: the nightly scores ` +
        `never reach the summary`,
    )
  }
  for (const { id, job, step } of summaries) {
    if (step.with?.["merge-multiple"] !== true) {
      errors.push(
        `${NIGHTLY_WORKFLOW}: job ${id} must download mutation-report-* with merge-multiple: ` +
          `true, or each leg unpacks into a directory of its own name`,
      )
    }
    if (!stepsOf(job).some((other) => /^pnpm fitness\b/.test(runOf(other).trim()))) {
      errors.push(
        `${NIGHTLY_WORKFLOW}: job ${id} downloads the reports but never runs pnpm fitness`,
      )
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
  const legs = nightlyLegs(doc)
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
    errors.push(...checkForcedRun(doc, job, `${where}: job ${id}`))
    errors.push(...checkIncrementalCache(job, `${where}: job ${id}`))
  }
  return errors
}

/** A cron fires every week when it names no day of the month and no month. */
const firesWeekly = (cron) => {
  const fields = String(cron).trim().split(/\s+/)
  return fields.length === 5 && fields[2] === "*" && fields[3] === "*"
}
const FORCE_EXPRESSION =
  /^\$\{\{ inputs\.force == true \|\| github\.event\.schedule == '([^']+)' \}\}$/

/**
 * Between forced runs a leg reuses every result whose mutant and killing test did not change,
 * however stale (a helper, another package's dist, a dependency). So one cron of the schedule
 * passes --force at least weekly, and the Stryker step's FORCE names it next to the dispatch
 * input.
 */
function checkForcedRun(doc, job, at) {
  const stryker = stepsOf(job).find((step) => /\brun test:mutation\b/.test(runOf(step)))
  const force = String(stryker?.env?.FORCE ?? "")
  const cron = FORCE_EXPRESSION.exec(force)?.[1]
  const crons = asList(triggersOf(doc).schedule).map((entry) => entry?.cron)
  if (cron === undefined) {
    return [
      `${at}: the Stryker step needs FORCE: \${{ inputs.force == true || ` +
        `github.event.schedule == '<a weekly cron of the schedule>' }} (found "${force}"): ` +
        `without a forced run, reused results are never measured again`,
    ]
  }
  const errors = []
  if (!crons.includes(cron)) {
    errors.push(`${at}: FORCE names the cron "${cron}", which the schedule does not list`)
  }
  if (!firesWeekly(cron)) {
    errors.push(`${at}: the forced cron "${cron}" must fire every week (day of month and month *)`)
  }
  if (!/\[ "\$FORCE" = true \]; then args\+=\(--force\)/.test(runOf(stryker))) {
    errors.push(`${at}: the Stryker step must pass --force when FORCE is true`)
  }
  return errors
}

/** What the fingerprint hashes: a change in any of them starts a leg cold. */
export const CACHE_FINGERPRINT_INPUTS = [
  "'pnpm-lock.yaml'",
  "'vitest.shared.ts'",
  "'tsconfig.base.json'",
  "format('{0}/stryker.config.json', matrix.dir)",
  "format('{0}/vitest*.ts', matrix.dir)",
  "format('{0}/tsconfig*.json', matrix.dir)",
]
/** The cache-key step's prefix: the package, the Node major the leg runs and the fingerprint. */
const CACHE_KEY_LINES = [
  `node_major="$(node -p 'process.versions.node.split(".")[0]')"`,
  'echo "prefix=stryker-incremental-${SLUG}-node${node_major}-${FINGERPRINT}-" >> "$GITHUB_OUTPUT"',
]
const CACHE_PREFIX = "${{ steps.cache-key.outputs.prefix }}"
const CACHE_KEY = `${CACHE_PREFIX}\${{ github.run_id }}-\${{ github.run_attempt }}`

/**
 * The leg restores and saves the incremental file under a key whose prefix (the cache-key
 * step's output) fingerprints the lockfile, the configs and the Node major: a bare package
 * prefix would restore results measured under another dependency tree or Node.
 */
function checkIncrementalCache(job, at) {
  const errors = []
  const keyStep = stepsOf(job).find((step) => step?.id === "cache-key")
  if (keyStep === undefined) {
    errors.push(`${at} needs the step id cache-key, which builds the cache key prefix`)
  } else {
    const fingerprint = String(keyStep.env?.FINGERPRINT ?? "")
    if (!/^\$\{\{ hashFiles\(.*\) \}\}$/.test(fingerprint)) {
      errors.push(`${at}: the cache-key step needs FINGERPRINT: \${{ hashFiles(...) }}`)
    }
    for (const input of CACHE_FINGERPRINT_INPUTS.filter((input) => !fingerprint.includes(input))) {
      errors.push(`${at}: the cache-key step's FINGERPRINT misses ${input}`)
    }
    if (keyStep.env?.SLUG !== "${{ matrix.slug }}") {
      errors.push(`${at}: the cache-key step needs SLUG: \${{ matrix.slug }}`)
    }
    const run = runOf(keyStep)
    for (const line of CACHE_KEY_LINES.filter((line) => !run.includes(line))) {
      errors.push(`${at}: the cache-key step must run ${line}`)
    }
  }
  const cachePath = `\${{ matrix.dir }}/${INCREMENTAL_FILE}`
  for (const [action, keys] of [
    ["actions/cache/restore", { key: CACHE_KEY, "restore-keys": CACHE_PREFIX }],
    ["actions/cache/save", { key: CACHE_KEY }],
  ]) {
    const steps = stepsOf(job).filter((step) => usesAction(step, action))
    if (steps.length !== 1) {
      errors.push(`${at} needs exactly one ${action} step, found ${steps.length}`)
      continue
    }
    const step = steps[0]
    if (step.with?.path !== cachePath) {
      errors.push(`${at}: ${action} must cache path ${cachePath}, the file every config writes`)
    }
    for (const [name, value] of Object.entries(keys)) {
      if (step.with?.[name] !== value) {
        errors.push(`${at}: ${action} needs ${name}: ${value} (found ${step.with?.[name]})`)
      }
    }
  }
  return errors
}

/** Every stryker.config.json writes the incremental file the nightly caches (pure). */
export function checkStrykerIncremental(configs) {
  const errors = []
  for (const { dir, config } of configs) {
    const at = `${dir}/stryker.config.json`
    if (config === undefined) {
      errors.push(`${at} is no JSON object`)
      continue
    }
    if (config.incremental !== true) {
      errors.push(
        `${at} must set "incremental": true: the nightly leg reuses the last night's results ` +
          `from that file`,
      )
    }
    if (config.incrementalFile !== INCREMENTAL_FILE) {
      errors.push(
        `${at} must set "incrementalFile": "${INCREMENTAL_FILE}", the path the nightly caches ` +
          `(found ${JSON.stringify(config.incrementalFile)}): any other path is never restored, ` +
          `and every night runs cold`,
      )
    }
  }
  return errors
}

// ── Main ────────────────────────────────────────────────────────────────────

/** A JSON object file, or undefined when it holds no JSON object (reported, not thrown). */
const readJsonObject = (root, file) => {
  try {
    const value = JSON.parse(readFileSync(path.join(root, file), "utf8"))
    return value !== null && typeof value === "object" && !Array.isArray(value) ? value : undefined
  } catch {
    return undefined
  }
}

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
  const others = new Map([...workflows].filter(([file]) => file !== PUBLISH_WORKFLOW))
  const strykerConfigs = packages
    .filter(({ dir }) => exists(`${dir}/stryker.config.json`))
    .map(({ dir }) => ({ dir, config: readJsonObject(root, `${dir}/stryker.config.json`) }))
  return [
    ...checkPublishWorkflow(workflows.get(PUBLISH_WORKFLOW), { pinnedRefs: actionRefs(others) }),
    ...checkPublishMatrix(workflows.get(RELEASE_WORKFLOW), packages),
    ...checkReleaseExtraFiles(
      JSON.parse(readFileSync(path.join(root, "release-please-config.json"), "utf8")),
      packages,
      { fileExists: exists },
    ),
    ...checkPluginVersions(
      JSON.parse(readFileSync(path.join(root, "release-please-config.json"), "utf8")),
      pluginManifests(root, packages),
    ),
    ...checkReleaseGate(workflows.get(RELEASE_WORKFLOW)),
    ...checkCliPublishWorkflows(workflows),
    ...checkDependabot(readYaml(root, ".github/dependabot.yml"), { packages, dirExists: exists }),
    ...checkRequiredChecks(workflows),
    ...checkArtifactGlobs(workflows.get(CI_WORKFLOW), workflows.get(NIGHTLY_WORKFLOW), globs),
    ...checkNightlyMutation(workflows.get(NIGHTLY_WORKFLOW), globs),
    ...checkStrykerIncremental(strykerConfigs),
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
    "GitHub config: publish workflow, npm matrix and repositories, release extra-files and " +
      "plugin versions, the release gate, the CLI publish workflows, Dependabot groups, " +
      `${REQUIRED_CHECKS.length} required checks, the report artifacts, the nightly mutation ` +
      "run and the Stryker incremental files hold.",
  )
}
