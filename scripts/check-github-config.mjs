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
 * - every VS Code extension is packaged by exactly one release job through
 *   publish-vscode-extension.yml, after the release gate and behind the VSCODE_PUBLISH switch,
 *   and that workflow keeps the store credentials in its one job in the vscode-marketplace
 *   environment, which installs with --ignore-scripts, builds nothing and publishes with
 *   --skip-duplicate (checkVscodePublish);
 * - dependabot.yml groups never shadow each other and name only directories that exist
 *   (checkDependabot);
 * - every check the main-branch ruleset requires is a job a pull request runs
 *   (checkRequiredChecks);
 * - every workspace package pins Playwright (`playwright`, `@playwright/test`) at one version:
 *   ci.yml keys the browser cache of the TypeScript job and of the host simulation on those
 *   pins, so the two share one entry and one browser build (checkPlaywrightPins);
 * - the coverage and mutation artifacts cover every package form and unpack at the repo root,
 *   and the nightly full run (the only mutation testing CI runs) lists every package form,
 *   forces a run every week and caches each package's incremental file under a fingerprinted
 *   key, the file every stryker.config.json writes (checkArtifactGlobs, checkNightlyMutation,
 *   checkStrykerIncremental).
 *
 * The test (check-github-config.test.mjs) also RUNS the bash steps of the publish workflow
 * (against stub npm and curl executables), of the CLI's release (the tap update against a stub
 * gh), of the extension's release switch and of the nightly run in fixture trees.
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
export const VSCODE_PUBLISH_WORKFLOW = ".github/workflows/publish-vscode-extension.yml"

/**
 * The status checks ruleset 15024440 (branch main) requires. A MIRROR of a GitHub setting that
 * no file in the repo holds (read it with `gh api repos/Miragon/pulse/rulesets/15024440`): keep
 * the two equal by hand. A job renamed, split into a matrix or moved behind a paths filter never
 * reports its check, and every pull request then waits for it forever.
 */
export const REQUIRED_CHECKS = [
  "TypeScript (Build + Test + Lint)",
  "Lint + Format",
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
 * A status check function in a job's `if`. Once a condition names one, GitHub drops the implicit
 * success() of the job's needs, so `always()`, `!cancelled()`, `failure()`, `cancelled()` and
 * `success() || x` all let the job run after a rejected or failed approval.
 */
const STATUS_FUNCTION = /\b(?:always|cancelled|failure|success)\s*\(/

/**
 * Every other job of release-please.yml waits for gate, the `release` environment's approval:
 * it needs gate directly or through another job that does, and its `if` names no status check
 * function, which would let it run when gate did not succeed (pure).
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
    const status = STATUS_FUNCTION.exec(String(jobs[id]?.if ?? ""))
    if (status) {
      errors.push(
        `${RELEASE_WORKFLOW}: job ${id}'s if uses the status check function ${status[0]}): it ` +
          `would run after a rejected or failed release approval`,
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

/** A secret other than the job's own GITHUB_TOKEN, whose power its permissions already name. */
const SECRET = /\bsecrets\.(?!GITHUB_TOKEN\b)[\w-]+/
/** A token another step or job minted, e.g. `steps.tap-token.outputs.token`. */
const TOKEN_OUTPUT = /\b(?:steps|needs)\.[\w-]+\.outputs\.[\w-]*token/i

/**
 * The credential a job holds, if any, for the message: a write grant or id-token (its
 * permissions), an App token it mints, a secret or a minted token it reads (a job with
 * `permissions: {}` can still hold the strongest token of the workflow).
 */
function credentialOf(job) {
  if (grantsWrite(job)) return JSON.stringify(job.permissions)
  if (stepsOf(job).some((step) => usesAction(step, "actions/create-github-app-token"))) {
    return "an App token"
  }
  const text = JSON.stringify(job ?? {})
  if (SECRET.test(text)) return "a secret"
  return TOKEN_OUTPUT.test(text) ? "a minted token" : undefined
}

/**
 * The CLI's publish workflows hold their tokens the way the npm publish does (pure; `workflows`
 * holds release-please.yml too): release-please.yml calls each of them, each runs only on its
 * CLI_PUBLISH_TRIGGERS, no permission at the top level, a permissions map on every job, no
 * dependency cache, checkouts without persisted credentials, no expression in a run script, and
 * no package manager in a job that holds a credential: a write grant, id-token, an App token, a
 * secret or a minted token (the build jobs hold contents: read only).
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
      const credential = credentialOf(job)
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
        const install = credential === undefined ? undefined : packageManagerRun(run)
        if (install) {
          errors.push(
            `${at} holds ${credential} and runs "${install}": a job that holds a write grant, ` +
              `id-token, an App token or a secret installs nothing; build in a job with ` +
              `contents: read`,
          )
        }
      }
    }
  }
  return errors
}

// ── publish-vscode-extension.yml ────────────────────────────────────────────

/** The one environment whose job holds the store credentials (or the trusted-publishing token). */
export const VSCODE_ENVIRONMENT = "vscode-marketplace"
/** The release switch: the repository variable, never a literal in the workflow. */
export const VSCODE_SWITCH = "${{ vars.VSCODE_PUBLISH }}"
const VSCODE_DRY_RUN = "${{ inputs.dry_run == true }}"
/** The directories the Resolve extension step of the workflow accepts. */
export const VSCODE_APP_DIR = /^apps\/[a-z0-9][a-z0-9-]*$/
/** The scripts the publish job runs by name (pinned by scripts/check-ratchets.mjs). */
const VSCODE_PUBLISH_SCRIPTS = ["marketplace:publish", "open-vsx:publish"]

const callsVscodePublish = (job) => job?.uses === `./${VSCODE_PUBLISH_WORKFLOW}`
const usesCache = (step) =>
  typeof step?.uses === "string" && /^actions\/cache(?:\/[\w-]+)?@/.test(step.uses)
const runsScript = (step, script) =>
  new RegExp(String.raw`\brun ${escapeRegExp(script)}(?![\w:-])`).test(runOf(step))

/**
 * The release job that calls the workflow for one extension: after the release approval, with the
 * switch, the dry run and the release tag of the train, the ceiling of the called jobs and no
 * secrets (pure).
 */
function checkVscodeCaller(id, job) {
  const errors = []
  const at = `${RELEASE_WORKFLOW}: job ${id}`
  const needs = asList(job.needs)
  if (!["release-please", "gate"].every((need) => needs.includes(need))) {
    errors.push(
      `${at} must need release-please and gate: the release approval covers the extension too`,
    )
  }
  if (job.with?.channel !== VSCODE_SWITCH) {
    errors.push(
      `${at} must pass channel: ${VSCODE_SWITCH} (found ${JSON.stringify(job.with?.channel)}): ` +
        `the switch is the repository variable, never a literal in the workflow`,
    )
  }
  if (job.with?.dry_run !== VSCODE_DRY_RUN) {
    errors.push(`${at} must pass dry_run: ${VSCODE_DRY_RUN}`)
  }
  if (!String(job.with?.version ?? "").includes("tag_name")) {
    errors.push(`${at} must pass version: the release tag (tag_name) the .vsix has to carry`)
  }
  if (!isDeepStrictEqual(job.permissions, { contents: "write", "id-token": "write" })) {
    errors.push(
      `${at} must hold exactly { contents: write, id-token: write }: the ceiling of the called ` +
        `package, publish and attach jobs (found ${JSON.stringify(job.permissions)})`,
    )
  }
  if (job.secrets !== undefined) {
    errors.push(
      `${at} passes secrets: the store credentials live in the ${VSCODE_ENVIRONMENT} ` +
        `environment, never in the caller`,
    )
  }
  return errors
}

/** A run script's commands: its lines without shell comments, split at &&, ||, ; and |. */
const commandsOf = (step) =>
  lines(runOf(step))
    .map((line) => line.replace(/(?:^|\s)#.*$/, ""))
    .flatMap((line) => line.split(/&&|\|\||;|\|/))
    .map((command) => command.trim())
    .filter(Boolean)

/** The words of a command, with their quotes and the parentheses of a bash array taken off. */
const wordsOf = (command) =>
  command
    .split(/[\s()]+/)
    .map((word) => word.replace(/^["']+|["']+$/g, ""))
    .filter(Boolean)

/**
 * Whether the words pass `flag` as a bare word, and no other word names it: neither
 * `--flag=false`, `--no-flag` nor `--config.flag=false` switches it back off.
 */
const passesFlag = (words, flag) => {
  const name = flag.replace(/^--/, "")
  return words.includes(flag) && words.every((word) => word === flag || !word.includes(name))
}

/**
 * The command lines of the credential job that start a package manager or a build: only the one
 * install and the two publish scripts may run next to the store credentials.
 */
const foreignCommands = (job) =>
  stepsOf(job)
    .flatMap((step) => lines(runOf(step)))
    .flatMap((line) => line.split(/&&|\|\||;|\|/).map((command) => command.trim()))
    .filter((command) => packageManagerRun(command) !== undefined || /\bbuild\b/.test(command))
    .filter(
      (command) =>
        !/^pnpm install\b/.test(command) &&
        !VSCODE_PUBLISH_SCRIPTS.some((script) => runsScript({ run: command }, script)),
    )

/** The job in the environment: the token, the gate on the switch, the install, the publish steps. */
function checkVscodeCredentialJob(id, job) {
  const errors = []
  const at = `${VSCODE_PUBLISH_WORKFLOW}: job ${id}`
  if (!isDeepStrictEqual(job.permissions, { contents: "read", "id-token": "write" })) {
    errors.push(
      `${at} must hold exactly { contents: read, id-token: write } (found ` +
        `${JSON.stringify(job.permissions)})`,
    )
  }
  const condition = String(job.if ?? "")
  if (
    !condition.includes("inputs.dry_run") ||
    !condition.includes("needs.package.outputs.publish")
  ) {
    errors.push(
      `${at} must skip itself on a dry run and while the switch is off (if: inputs.dry_run and ` +
        `needs.package.outputs.publish)`,
    )
  }
  if (!asList(job.needs).includes("package")) {
    errors.push(`${at} must need the package job, which builds the .vsix without the credentials`)
  }
  const installs = stepsOf(job).filter((step) => /\bpnpm install\b/.test(runOf(step)))
  if (installs.length !== 1) {
    errors.push(`${at} must run exactly one pnpm install, found ${installs.length}`)
  }
  const installCommands = installs
    .flatMap((step) => commandsOf(step))
    .filter((command) => /^pnpm install\b/.test(command))
  for (const flag of installs.length === 0 ? [] : ["--frozen-lockfile", "--ignore-scripts"]) {
    const name = flag.replace(/^--/, "")
    const passed = installCommands.every((command) => passesFlag(wordsOf(command), flag))
    if (installCommands.length === 0 || !passed) {
      errors.push(
        `${at}: pnpm install must pass ${flag}, and no word that switches it back off ` +
          `(${flag}=false, --no-${name}): the lockfile's vsce and ovsx, and no lifecycle ` +
          `script runs next to the credentials`,
      )
    }
  }
  for (const line of foreignCommands(job)) {
    errors.push(
      `${at} runs "${line}": next to the credentials only the one pnpm install and the scripts ` +
        `${VSCODE_PUBLISH_SCRIPTS.join(" and ")} run, and nothing builds`,
    )
  }
  for (const script of VSCODE_PUBLISH_SCRIPTS) {
    const steps = stepsOf(job).filter((step) => runsScript(step, script))
    if (steps.length !== 1) {
      errors.push(`${at} must run ${script} in exactly one step, found ${steps.length}`)
    }
    const skipping = (step) =>
      passesFlag(
        commandsOf(step).flatMap((command) => wordsOf(command)),
        "--skip-duplicate",
      )
    for (const step of steps.filter((step) => !skipping(step))) {
      errors.push(
        `${at}: the step "${step.name ?? script}" must pass --skip-duplicate, and no word that ` +
          `switches it back off (--skip-duplicate=false): a re-run after a partial failure ` +
          `publishes only what is missing`,
      )
    }
  }
  return errors
}

/** The workflow's shape, whoever calls it (pure; the doc is the parsed workflow). */
function checkVscodeWorkflow(doc) {
  const where = VSCODE_PUBLISH_WORKFLOW
  if (doc === undefined) return [`${where} is missing: a release never packages the extension`]
  const errors = []
  const inputs = doc.on?.workflow_call?.inputs ?? {}
  for (const name of ["directory", "version"]) {
    if (inputs[name]?.required !== true || inputs[name]?.type !== "string") {
      errors.push(`${where}: needs the required string input "${name}"`)
    }
  }
  if (inputs.channel?.type !== "string") errors.push(`${where}: needs the string input "channel"`)
  if (inputs.dry_run?.type !== "boolean") {
    errors.push(`${where}: needs the boolean input "dry_run"`)
  }
  if (!isDeepStrictEqual(doc.permissions, {})) {
    errors.push(`${where}: top-level permissions must be {}: each job names its own`)
  }
  if (doc.defaults?.run?.shell !== "bash") {
    errors.push(
      `${where}: defaults.run.shell must be bash (-eo pipefail, the flags its test runs the ` +
        `steps with)`,
    )
  }

  const jobs = jobsOf(doc)
  const credentialJobs = jobs.filter(([, job]) => environmentOf(job) === VSCODE_ENVIRONMENT)
  if (credentialJobs.length !== 1) {
    const ids = credentialJobs.map(([id]) => id).join(", ")
    errors.push(
      `${where}: exactly one job runs in the environment ${VSCODE_ENVIRONMENT} (the publish ` +
        `job), found ${credentialJobs.length}${ids === "" ? "" : ` (${ids})`}`,
    )
  } else {
    errors.push(...checkVscodeCredentialJob(...credentialJobs[0]))
  }
  const credentialIds = new Set(credentialJobs.map(([id]) => id))
  const pack = doc.jobs?.package
  if (pack === undefined) {
    errors.push(`${where}: the job package is missing`)
  } else {
    if (!isDeepStrictEqual(pack.permissions, { contents: "read" })) {
      errors.push(`${where}: job package must hold exactly { contents: read }`)
    }
    if (environmentOf(pack) !== undefined) {
      errors.push(`${where}: job package runs in no environment`)
    }
  }
  for (const [id, job] of jobs.filter(([id]) => !credentialIds.has(id))) {
    if (id !== "package" && holdsIdToken(job)) {
      errors.push(
        `${where}: job ${id} holds id-token: only the job in ${VSCODE_ENVIRONMENT} may (a ` +
          `string such as write-all or read-all counts)`,
      )
    }
    if (JSON.stringify(job).includes("secrets.")) {
      errors.push(
        `${where}: job ${id} reads secrets: only the job in ${VSCODE_ENVIRONMENT} may, from ` +
          `that environment`,
      )
    }
  }

  for (const [id, job] of jobs) {
    const at = `${where}: job ${id}`
    for (const step of stepsOf(job)) {
      if (runOf(step).includes("${{")) {
        errors.push(
          `${at}: a run script holds a \${{ }} expression (template injection); pass it through env`,
        )
      }
      if (usesCache(step)) {
        errors.push(`${at} uses ${step.uses}: a release job restores no cache into the package`)
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
      if (usesAction(step, "actions/checkout") && step.with?.["persist-credentials"] !== false) {
        errors.push(`${at}: actions/checkout must set persist-credentials: false`)
      }
    }
  }
  return errors
}

/**
 * Every VS Code extension (an app that declares engines.vscode) is packaged by exactly one release
 * job through publish-vscode-extension.yml, and that workflow keeps the store credentials in one
 * job that builds nothing (pure).
 */
export function checkVscodePublish(releaseDoc, publishDoc, packages) {
  const errors = []
  const extensions = packages.filter(({ manifest }) => isVscodeExtension(manifest))
  const callers = jobsOf(releaseDoc).filter(([, job]) => callsVscodePublish(job))
  for (const [id, job] of callers) {
    if (!extensions.some(({ dir }) => dir === job.with?.directory)) {
      errors.push(
        `${RELEASE_WORKFLOW}: job ${id} calls ./${VSCODE_PUBLISH_WORKFLOW} with directory ` +
          `${job.with?.directory}, which declares no engines.vscode: it packages nothing`,
      )
    }
  }
  for (const pkg of extensions) {
    if (!VSCODE_APP_DIR.test(pkg.dir)) {
      errors.push(
        `${describe(pkg)} declares engines.vscode, but ./${VSCODE_PUBLISH_WORKFLOW} packages ` +
          `apps/<name> only`,
      )
      continue
    }
    const own = callers.filter(([, job]) => job.with?.directory === pkg.dir)
    if (own.length !== 1) {
      errors.push(
        `${describe(pkg)} declares engines.vscode, but ${own.length} jobs of ${RELEASE_WORKFLOW} ` +
          `call ./${VSCODE_PUBLISH_WORKFLOW} with directory: ${pkg.dir}: a release never ` +
          `packages it (or twice)`,
      )
    }
    for (const [id, job] of own) errors.push(...checkVscodeCaller(id, job))
  }
  if (publishDoc !== undefined || extensions.length > 0) {
    errors.push(...checkVscodeWorkflow(publishDoc))
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
  name === "coverage-summaries" || String(name ?? "").startsWith("mutation-report-")

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
      if (name.startsWith("mutation-report-")) {
        expectPaths(file, upload, "reports/mutation-report.json")
      }
      if (name === "coverage-summaries") expectPaths(file, upload, "coverage/coverage-summary.json")
    }
  }
  const coverage = "coverage-summaries"
  if (!uploadsOf(ciDoc).some(({ step }) => step.with?.name === coverage)) {
    errors.push(`${CI_WORKFLOW}: no step uploads the artifact ${coverage}`)
  }
  if (
    !stepsUsing(ciDoc, "actions/download-artifact").some(({ step }) => step.with?.name === coverage)
  ) {
    errors.push(
      `${CI_WORKFLOW}: no step downloads the artifact ${coverage}: the fitness report would ` +
        `show no coverage for any package`,
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

// ── Playwright pins ─────────────────────────────────────────────────────────

/** The packages that pin a Playwright version, each decides the browser build its job installs. */
export const PLAYWRIGHT_PACKAGES = ["playwright", "@playwright/test"]

/**
 * Every Playwright pin of the workspace is one version (pure). ci.yml keys the browser cache of
 * the TypeScript job on apps/vscode's `playwright` and the host simulation's on the server app's
 * `@playwright/test`; two versions would mean two keys, two browser downloads and a job that
 * never hits the shared entry.
 */
export function checkPlaywrightPins(packages) {
  const pins = packages.flatMap(({ dir, manifest }) =>
    PLAYWRIGHT_PACKAGES.flatMap((name) =>
      ["dependencies", "devDependencies"]
        .map((field) => manifest?.[field]?.[name])
        .filter((version) => version !== undefined)
        .map((version) => ({ dir, name, version })),
    ),
  )
  if (new Set(pins.map(({ version }) => version)).size <= 1) return []
  const listed = pins.map(({ dir, name, version }) => `${dir} ${name} ${version}`).join(", ")
  return [
    `Playwright is pinned at more than one version (${listed}): ci.yml keys one browser cache ` +
      `on these pins, so bump them together to one version`,
  ]
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
    ...checkVscodePublish(
      workflows.get(RELEASE_WORKFLOW),
      workflows.get(VSCODE_PUBLISH_WORKFLOW),
      packages,
    ),
    ...checkDependabot(readYaml(root, ".github/dependabot.yml"), { packages, dirExists: exists }),
    ...checkRequiredChecks(workflows),
    ...checkPlaywrightPins(packages),
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
      "plugin versions, the release gate, the CLI publish workflows, the extension's release " +
      `path, Dependabot groups, ${REQUIRED_CHECKS.length} required checks, the Playwright pins, ` +
      "the report artifacts, the nightly mutation run and the Stryker incremental files hold.",
  )
}
