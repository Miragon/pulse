#!/usr/bin/env node
// @ts-check
/**
 * GitHub-config gate: the release workflows hold the publish credentials and run only on a
 * release, so no pull request exercises them. What keeps those credentials safe and the
 * published set equal to the workspace is pinned here, against the workspace as it is:
 *
 * - publish-npm-package.yml packs without id-token and publishes in the one job that holds
 *   id-token, as exactly `id-token: write`, using only actions/setup-node and
 *   actions/download-artifact at the repo's pins and running no package manager
 *   (checkPublishWorkflow);
 * - release-please.yml's publish-npm matrix lists exactly the workspace packages npm receives,
 *   each naming this repository for its provenance (checkPublishMatrix), and
 *   release-please-config.json bumps every workspace package (checkReleaseExtraFiles), every
 *   Claude Code plugin manifest an app ships (checkPluginVersions) and every @miragon/pulse-*
 *   pin of a package.json under templates/, by that pin's exact jsonpath
 *   (checkTemplatePinBumps), each json file of them in the form release-please writes it back
 *   in, so prettier takes the Release PR's bump (checkJsonExtraFileForm);
 * - every job of release-please.yml past the approval waits for gate, and release-please.yml
 *   calls the publish workflows of the CLI, the Orca plugin, the server image and the starter's
 *   mirror, which run on no other trigger (a dispatch only publishes the formula of a release or
 *   the mirror again, after the release environment's approval of that run) and hold their
 *   tokens like the npm publish, the Orca publish action pinned to a commit (checkReleaseGate,
 *   checkChannelPublishWorkflows);
 * - in every workflow, a job that mints an App token or reads a secret runs no package manager
 *   and no JVM build (checkCredentialJobs);
 * - every VS Code extension is packaged by exactly one release job through
 *   publish-vscode-extension.yml, after the release gate, and that workflow publishes by
 *   trusted publishing on both stores (no secret anywhere) from its one job in the
 *   vscode-marketplace environment, which installs with --ignore-scripts and builds nothing
 *   (checkVscodePublish);
 * - the docs site deploys with a release: docs.yml runs on no push, its one deploy job in the
 *   github-pages environment holds only the Pages grants, and one job of release-please.yml calls
 *   it after the approval, once a release is created (checkDocsDeploy);
 * - every action of every workflow is pinned by a commit SHA with its version as a comment
 *   (checkActionPins);
 * - Dependabot's auto-merge labels no major, no minor below 1.0 and no workflow file, withdraws
 *   the label on a hand-made commit, and enables the merge with a token narrowed to this
 *   repository's contents and pull requests (checkDependabotAutomerge);
 * - every job of ci.yml runs in a scope of scripts/ci-scopes.mjs, and a failed changes job
 *   fails a job instead of skipping all of them (checkCiScopes).
 *
 * The test (check-github-config.test.mjs) also RUNS the bash steps of the npm publish workflow
 * against stub npm and curl executables.
 *
 * Runs as `pnpm lint:github` (chained into the root `pnpm lint`).
 */
import { existsSync, readdirSync, readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { isDeepStrictEqual } from "node:util"
import { parse } from "yaml"
import { SCOPES } from "./ci-scopes.mjs"
import { STANZAS, templateManifests } from "./template-pins.mjs"
import { isNpmPublished, isVscodeExtension, readWorkspace } from "./workspace-packages.mjs"

export const PUBLISH_WORKFLOW = ".github/workflows/publish-npm-package.yml"
export const RELEASE_WORKFLOW = ".github/workflows/release-please.yml"
export const CI_WORKFLOW = ".github/workflows/ci.yml"
export const VSCODE_PUBLISH_WORKFLOW = ".github/workflows/publish-vscode-extension.yml"

/** The npm scope of Pulse's packages, whose template pins release-please bumps. */
const PRODUCT_SCOPE = "@miragon/pulse-"

/** The directories the Resolve package step of the publish workflow accepts. */
export const PUBLISHABLE_DIR =
  /^(apps\/[a-z0-9][a-z0-9-]*|packages\/core\/[a-z0-9][a-z0-9-]*|packages\/connectors\/[a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9-]*)$/

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
// A name with more after a dash or a dot (pnpm-lock.yaml, yarn.lock) names a file, not the tool.
const OTHER_PACKAGE_MANAGERS = /\b(?:pnpm|pnpx|yarn|yarnpkg|npx|corepack|bun|bunx)\b(?![-.]\w)/

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

/**
 * Every workspace package under apps/ and packages/, and the root, gets its version bumped.
 *
 * @param {any} config release-please-config.json as parsed
 * @param {any[]} packages the workspace packages (readWorkspace)
 * @param {{ fileExists?: (rel: string) => boolean }} [options]
 */
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
 * Every json entry of extra-files is in the form release-please writes it back in: its json
 * updater serializes the whole file as `JSON.stringify(…, null, 2)` with the final newline, which
 * spreads every array over lines. A file prettier formats otherwise (an array on one line) fails
 * `format:check` on the Release PR and blocks it, as it did on 0.28.0's. prettier keeps a file in
 * that form under its `json-stringify` parser, which it gives every `package.json` by itself and
 * any other file by an override in `.prettierrc.json`. A plain string entry that ends in
 * `.json` goes through the same updater, so it counts as a json entry. `readText` returns a
 * file's text, or undefined for one that does not exist (checkReleaseExtraFiles names it).
 */
export function checkJsonExtraFileForm(config, readText) {
  const files = new Set(
    asList(config?.packages?.["."]?.["extra-files"]).flatMap((entry) => {
      if (typeof entry === "string") return entry.endsWith(".json") ? [entry] : []
      return entry?.type === "json" && typeof entry.path === "string" ? [entry.path] : []
    }),
  )
  const errors = []
  for (const file of [...files].sort()) {
    const text = readText(file)
    if (text === undefined) continue
    let written
    try {
      written = `${JSON.stringify(JSON.parse(text), null, 2)}\n`
    } catch {
      errors.push(`release-please-config.json: the json extra-file ${file} is no JSON`)
      continue
    }
    if (text !== written) {
      errors.push(
        `${file} is not in the form release-please writes it back in (JSON.stringify with two ` +
          `spaces): prettier would refuse the Release PR's bump of it. Give it prettier's ` +
          `json-stringify parser in .prettierrc.json's overrides and run pnpm format`,
      )
    }
  }
  return errors
}

/** release-please's generic markers: a version on this line, or on every line of a block. */
const INLINE_MARKER = /x-release-please-version\b/
const BLOCK_START = /x-release-please-start-version\b/
const BLOCK_END = /x-release-please-end\b/
/** The first version on a line, the one release-please's generic updater rewrites there. */
const MARKED_VERSION = /\d+\.\d+\.\d+(?:-[\w.]+)?(?:\+[-\w.]+)?/

/**
 * Every generic entry of extra-files is one release-please's generic updater bumps: its file
 * marks the versions it holds (`x-release-please-version` on a line, or a block from
 * `x-release-please-start-version` to `x-release-please-end`), every block is closed, and every
 * marked line holds the release's version, `version` (the root manifest's). A file without a
 * marker, or a marked line without the version, would keep the previous release's number after
 * the bump, silently: a page that loads pulse-ui's browser bundle from a CDN by that number would
 * load the old kit. `readText` returns a file's text, or undefined for one that does not exist
 * (checkReleaseExtraFiles names it) (pure).
 */
export function checkGenericExtraFiles(config, readText, version) {
  const files = asList(config?.packages?.["."]?.["extra-files"]).flatMap((entry) =>
    entry?.type === "generic" && typeof entry.path === "string" ? [entry.path] : [],
  )
  const errors = []
  for (const file of [...new Set(files)].sort()) {
    const text = readText(file)
    if (text === undefined) continue
    let open = null
    let marked = 0
    text.split("\n").forEach((line, i) => {
      const at = `${file}:${String(i + 1)}`
      if (BLOCK_START.test(line)) {
        if (open !== null)
          errors.push(`${at}: a version block opens inside the block of line ${open}`)
        open = i + 1
        return
      }
      if (BLOCK_END.test(line)) {
        if (open === null) errors.push(`${at}: x-release-please-end closes no block`)
        open = null
        return
      }
      if (open === null && !INLINE_MARKER.test(line)) return
      const found = MARKED_VERSION.exec(line)?.[0]
      if (found === undefined) {
        if (open === null) errors.push(`${at}: the line marks a version but holds none`)
        return
      }
      marked += 1
      if (found !== version) {
        errors.push(
          `${at}: marks ${found}, not the release's ${version}: release-please bumps the version ` +
            `it finds, so this line keeps another number than the release`,
        )
      }
    })
    if (open !== null) {
      errors.push(
        `${file}:${String(open)}: the version block is never closed (x-release-please-end)`,
      )
    }
    if (marked === 0) {
      errors.push(
        `release-please-config.json: the generic extra-file ${file} marks no version ` +
          `(x-release-please-version, or a block from x-release-please-start-version to ` +
          `x-release-please-end): a release would leave its version behind`,
      )
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

/** Every package.json under templates/ as `{ file, manifest }`, its path from the repo root. */
export function templatePackageFiles(root) {
  const templates = path.join(root, "templates")
  if (!existsSync(templates)) return []
  return templateManifests(templates).map(({ file, manifest }) => ({
    file: `templates/${file}`,
    manifest,
  }))
}

/**
 * Each @miragon/pulse-* pin of a template's package.json (`manifests`, `{ file, manifest }[]`)
 * is in extra-files as { type: json, path: <file>, jsonpath: $.<stanza>['<name>'] }, that exact
 * jsonpath: release-please bumps it with the libraries, or the starter keeps that pin a release
 * behind, which template-pins.mjs notices only after the bump (pure).
 */
export function checkTemplatePinBumps(config, manifests) {
  const bumped = new Set(
    asList(config?.packages?.["."]?.["extra-files"])
      .filter((entry) => entry?.type === "json")
      .map((entry) => `${entry.path} ${entry.jsonpath}`),
  )
  const errors = []
  for (const { file, manifest } of manifests) {
    for (const stanza of STANZAS) {
      for (const name of Object.keys(manifest?.[stanza] ?? {})) {
        const jsonpath = `$.${stanza}['${name}']`
        if (!name.startsWith(PRODUCT_SCOPE) || bumped.has(`${file} ${jsonpath}`)) continue
        errors.push(
          `release-please-config.json: ${file} ${jsonpath} is missing from extra-files as ` +
            `{ type: json, path: ${file}, jsonpath: ${jsonpath} }: a release would bump the ` +
            `libraries and leave this pin at the previous version`,
        )
      }
    }
  }
  return errors
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

// ── publish-cli.yml + publish-homebrew.yml + publish-orca-plugin.yml ────────

/**
 * The release channels besides npm and the VS Code stores, called by release-please.yml after
 * the gate: the CLI's binaries, image and formula, and the Orca plugin.
 */
export const CHANNEL_PUBLISH_WORKFLOWS = [
  ".github/workflows/publish-cli.yml",
  ".github/workflows/publish-homebrew.yml",
  ".github/workflows/publish-orca-plugin.yml",
  ".github/workflows/publish-to-docker.yml",
  ".github/workflows/sync-template-mirror.yml",
]

/**
 * The events each one runs on: the release calls each, and only the formula (from the assets of
 * a release that exists) and the starter's mirror (its bootstrap, a re-sync) can be published
 * again by hand, after the release environment's approval of that run (MANUAL_APPROVAL_JOB).
 * Nothing reaches the binaries or the images without an approval.
 */
export const CHANNEL_PUBLISH_TRIGGERS = {
  ".github/workflows/publish-cli.yml": ["workflow_call"],
  ".github/workflows/publish-homebrew.yml": ["workflow_call", "workflow_dispatch"],
  ".github/workflows/publish-orca-plugin.yml": ["workflow_call"],
  ".github/workflows/publish-to-docker.yml": ["workflow_call"],
  ".github/workflows/sync-template-mirror.yml": ["workflow_call", "workflow_dispatch"],
}

/**
 * The job a manual run of a channel waits in for the release environment's approval. It runs on
 * a direct run alone: called by release-please.yml, a workflow's github context is its caller's,
 * so `github.workflow_ref` names the channel's file only when someone ran it by hand.
 */
export const MANUAL_APPROVAL_JOB = "approval"

/**
 * The action that publishes into Miragon/orca-plugins. A full commit pins it, with its release of
 * Miragon/orca-plugin-kit as a comment, so Dependabot moves the pin to each new release.
 */
export const ORCA_PUBLISH_ACTION = "Miragon/orca-plugin-kit/actions/publish-plugin"
const COMMIT_REF = /^[0-9a-f]{40}$/

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
 * The channels' publish workflows hold their tokens the way the npm publish does (pure;
 * `workflows` holds release-please.yml too): release-please.yml calls each of them, each runs
 * only on its CHANNEL_PUBLISH_TRIGGERS, no permission at the top level, a permissions map on every
 * job, no dependency cache, checkouts without persisted credentials, no expression in a run
 * script, and no package manager in a job that holds a credential: a write grant, id-token, an
 * App token, a secret or a minted token (the build jobs hold contents: read only). The Orca
 * publish action is pinned to a commit and runs in a job a dry run skips.
 */
export function checkChannelPublishWorkflows(workflows) {
  const errors = []
  const callers = new Set(
    jobsOf(workflows.get(RELEASE_WORKFLOW)).map(([, job]) => String(job?.uses ?? "")),
  )
  for (const file of CHANNEL_PUBLISH_WORKFLOWS) {
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
    const allowed = CHANNEL_PUBLISH_TRIGGERS[file]
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
        errors.push(...checkOrcaPublishStep(at, job, step))
      }
      errors.push(...checkNeedsResults(at, job))
    }
    if (allowed.includes("workflow_dispatch")) errors.push(...checkManualApproval(file, doc))
  }
  return errors
}

/**
 * A job whose `if` names a status check function runs whatever its needs ended in, so it names
 * each need's result itself (a rejected approval, a failed build), never `!cancelled()` alone.
 */
function checkNeedsResults(at, job) {
  if (!STATUS_FUNCTION.test(String(job?.if ?? ""))) return []
  return asList(job?.needs)
    .filter((need) => !String(job.if).includes(`needs.${need}.result`))
    .map(
      (need) =>
        `${at}'s if names a status check function but not needs.${need}.result: it would run ` +
        `after ${need} failed or was refused`,
    )
}

/**
 * A channel that runs by hand too publishes then without the release's gate, so its
 * MANUAL_APPROVAL_JOB waits in the release environment on a direct run alone, holding nothing,
 * and every job that holds a credential waits for it, directly or through another job (pure).
 */
function checkManualApproval(file, doc) {
  const jobs = Object.fromEntries(jobsOf(doc))
  const approval = jobs[MANUAL_APPROVAL_JOB]
  if (approval === undefined) {
    return [
      `${file} runs on workflow_dispatch, but has no job ${MANUAL_APPROVAL_JOB}: a manual run ` +
        `waits for the release environment's approval there`,
    ]
  }
  const errors = []
  const at = `${file}: job ${MANUAL_APPROVAL_JOB}`
  if (environmentOf(approval) !== "release") {
    errors.push(`${at} must run in the environment release`)
  }
  const direct = `contains(github.workflow_ref, '/${path.basename(file)}@')`
  if (!String(approval.if ?? "").includes(direct)) {
    errors.push(
      `${at}'s if must hold ${direct}: it waits on a manual run, and the release's call, which ` +
        `its gate approved, skips it`,
    )
  }
  if (credentialOf(approval) !== undefined || stepsOf(approval).some((step) => step.uses)) {
    errors.push(`${at} only waits: it holds no credential and uses no action`)
  }
  const waits = (id, seen) =>
    id === MANUAL_APPROVAL_JOB ||
    (!seen.has(id) &&
      jobs[id] !== undefined &&
      asList(jobs[id].needs).some((need) => waits(need, new Set([...seen, id]))))
  for (const [id, job] of Object.entries(jobs)) {
    const credential = credentialOf(job)
    if (id === MANUAL_APPROVAL_JOB || credential === undefined || waits(id, new Set())) continue
    errors.push(
      `${file}: job ${id} holds ${credential} but never waits for job ${MANUAL_APPROVAL_JOB}: ` +
        `a manual run would publish without the release approval`,
    )
  }
  return errors
}

/** A JVM build tool, which runs the build's plugins and dependencies. */
const JVM_BUILD = /(?:^|[\s;&|(])(?:\.\/gradlew|gradlew|gradle|mvnw?|\.\/mvnw)(?=\s|$)/m

/**
 * Every workflow: a job that mints an App token or reads a secret other than its GITHUB_TOKEN
 * (or a token another job minted) runs no package manager and no JVM build, whose plugins and
 * dependencies would run next to it. Such a job checks out, downloads what a job without the
 * credential built, and publishes or pushes (CLAUDE.md, Releases). A write grant of the job's
 * own GITHUB_TOKEN is the publish workflows' business (checkPublishWorkflow,
 * checkChannelPublishWorkflows, checkVscodePublish), pure.
 */
export function checkCredentialJobs(workflows) {
  const errors = []
  for (const [file, doc] of workflows) {
    for (const [id, job] of jobsOf(doc)) {
      const text = JSON.stringify(job ?? {})
      const credential = stepsOf(job).some((step) =>
        usesAction(step, "actions/create-github-app-token"),
      )
        ? "an App token"
        : SECRET.test(text)
          ? "a secret"
          : TOKEN_OUTPUT.test(text)
            ? "a minted token"
            : undefined
      if (credential === undefined) continue
      for (const step of stepsOf(job)) {
        const run = runOf(step)
        const tool = packageManagerRun(run) ?? JVM_BUILD.exec(run)?.[0]?.trim()
        if (tool) {
          errors.push(
            `${file}: job ${id} holds ${credential} and runs "${tool}": build in a job without ` +
              `it and hand the result over as an artifact`,
          )
        }
      }
    }
  }
  return errors
}

function checkOrcaPublishStep(at, job, step) {
  if (!usesAction(step, ORCA_PUBLISH_ACTION)) return []
  const errors = []
  const ref = String(step.uses).split("@")[1] ?? ""
  if (!COMMIT_REF.test(ref)) {
    errors.push(
      `${at}: ${ORCA_PUBLISH_ACTION} is pinned to "${ref}"; pin it to a full commit SHA with ` +
        `its release as a comment`,
    )
  }
  if (!String(job?.if ?? "").includes("!inputs.dry_run")) {
    errors.push(`${at} publishes to Miragon/orca-plugins: it needs if: \${{ !inputs.dry_run }}`)
  }
  return errors
}

// ── publish-vscode-extension.yml ────────────────────────────────────────────

/**
 * The one environment whose job holds the trusted-publishing token (id-token). Both stores bind
 * their trusted publisher to it, Open VSX also to the caller's file name, release-please.yml, and
 * the Marketplace to the called file's, publish-vscode-extension.yml.
 */
export const VSCODE_ENVIRONMENT = "vscode-marketplace"
/** The directories the Resolve extension step of the workflow accepts. */
export const VSCODE_APP_DIR = /^apps\/[a-z0-9][a-z0-9-]*$/
/**
 * The scripts the publish job runs by name (pinned by scripts/check-ratchets.mjs), each with the
 * flag that makes its store tool trade the job's OIDC token instead of looking for a store token.
 */
const VSCODE_PUBLISH_SCRIPTS = {
  "marketplace:publish": "--oidc",
  "open-vsx:publish": "--trusted-publishing",
}
const VSCODE_PUBLISH_SCRIPT_NAMES = Object.keys(VSCODE_PUBLISH_SCRIPTS)

const callsVscodePublish = (job) => job?.uses === `./${VSCODE_PUBLISH_WORKFLOW}`
const usesCache = (step) =>
  typeof step?.uses === "string" && /^actions\/cache(?:\/[\w-]+)?@/.test(step.uses)
const runsScript = (step, script) =>
  new RegExp(String.raw`\brun ${escapeRegExp(script)}(?![\w:-])`).test(runOf(step))

/**
 * The release job that calls the workflow for one extension: after the release approval, with the
 * ceiling of the called jobs and no secrets, `secrets: inherit` least of all (pure).
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
  if (!isDeepStrictEqual(job.permissions, { contents: "write", "id-token": "write" })) {
    errors.push(
      `${at} must hold exactly { contents: write, id-token: write }: the ceiling of the called ` +
        `package, publish and attach jobs (found ${JSON.stringify(job.permissions)})`,
    )
  }
  if (job.secrets !== undefined) {
    errors.push(
      `${at} must pass no secrets (found ${JSON.stringify(job.secrets)}): both stores publish ` +
        `by trusted publishing, so no store token exists, and secrets: inherit would hand ` +
        `every secret of the repository down`,
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
 * install and the two publish scripts may run next to the trusted-publishing token.
 */
const foreignCommands = (job) =>
  stepsOf(job)
    .flatMap((step) => lines(runOf(step)))
    .flatMap((line) => line.split(/&&|\|\||;|\|/).map((command) => command.trim()))
    .filter((command) => packageManagerRun(command) !== undefined || /\bbuild\b/.test(command))
    .filter(
      (command) =>
        !/^pnpm install\b/.test(command) &&
        !VSCODE_PUBLISH_SCRIPT_NAMES.some((script) => runsScript({ run: command }, script)),
    )

/** The job in the environment: the token, the dry-run gate, the install, the publish steps. */
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
  if (!condition.includes("inputs.dry_run")) {
    errors.push(`${at} must skip itself on a dry run (if: inputs.dry_run)`)
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
        `${VSCODE_PUBLISH_SCRIPT_NAMES.join(" and ")} run, and nothing builds`,
    )
  }
  for (const [script, flag] of Object.entries(VSCODE_PUBLISH_SCRIPTS)) {
    const steps = stepsOf(job).filter((step) => runsScript(step, script))
    if (steps.length !== 1) {
      errors.push(`${at} must run ${script} in exactly one step, found ${steps.length}`)
      continue
    }
    const publishCommands = commandsOf(steps[0]).filter((command) =>
      runsScript({ run: command }, script),
    )
    if (!publishCommands.every((command) => passesFlag(wordsOf(command), flag))) {
      errors.push(
        `${at}: ${script} must pass ${flag}, and no word that switches it back off: the store ` +
          `takes the job's OIDC token (trusted publishing), never a store token`,
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
  const secrets = doc.on?.workflow_call?.secrets
  if (secrets !== undefined) {
    errors.push(
      `${where}: must declare no secrets (found ${JSON.stringify(Object.keys(secrets ?? {}))}): ` +
        `both stores publish by trusted publishing`,
    )
  }
  if (!isDeepStrictEqual(doc.permissions, {})) {
    errors.push(`${where}: top-level permissions must be {}: each job names its own`)
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
  }
  for (const [id, job] of jobs) {
    if (JSON.stringify(job).includes("secrets.")) {
      errors.push(
        `${where}: job ${id} reads secrets: both stores publish by trusted publishing, so no ` +
          `job holds a store token`,
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
 * job through publish-vscode-extension.yml, and that workflow keeps the trusted-publishing token (id-token) in one
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

// ── dependabot-automerge-eligibility.yml + dependabot-automerge.yml ──────────

export const AUTOMERGE_ELIGIBILITY_WORKFLOW =
  ".github/workflows/dependabot-automerge-eligibility.yml"
export const AUTOMERGE_WORKFLOW = ".github/workflows/dependabot-automerge.yml"

/**
 * Dependabot's auto-merge (pure): the eligibility runs on every push to a Dependabot pull request,
 * whoever pushed (its job gates on the pull request's author, never on github.actor, so a
 * hand-made commit withdraws the label), reads each dependency's versions (a minor below 1.0 is a
 * breaking step, whatever Dependabot's semver-minor says) and labels no major and no change of a
 * workflow file; the auto-merge mints the release app's token for this repository's contents and
 * pull requests alone, which cannot merge a workflow file either.
 */
export function checkDependabotAutomerge(workflows) {
  const eligibility = workflows.get(AUTOMERGE_ELIGIBILITY_WORKFLOW)
  const automerge = workflows.get(AUTOMERGE_WORKFLOW)
  if (eligibility === undefined || automerge === undefined) {
    return [
      `${AUTOMERGE_ELIGIBILITY_WORKFLOW} and ${AUTOMERGE_WORKFLOW} decide the auto-merge together`,
    ]
  }
  const errors = []
  for (const [id, job] of jobsOf(eligibility)) {
    const at = `${AUTOMERGE_ELIGIBILITY_WORKFLOW}: job ${id}`
    if (String(job?.if ?? "").includes("github.actor")) {
      errors.push(
        `${at}'s if names github.actor: a push by anyone else skips it and keeps the label`,
      )
    }
    if (!JSON.stringify(job ?? {}).includes("prevVersion")) {
      errors.push(`${at} reads no dependency's versions: a minor below 1.0 would pass as harmless`)
    }
    for (const step of stepsOf(job)) {
      for (const [name, value] of Object.entries(step?.env ?? {})) {
        if (!name.endsWith("_AUTOMERGE_PATHS")) continue
        if (name.startsWith("MAJOR") && value !== "") {
          errors.push(`${at}: ${name} must be empty: a major waits for a review`)
        }
        if (value !== "" && new RegExp(String(value)).test(".github/workflows/ci.yml")) {
          errors.push(
            `${at}: ${name} lets a workflow file auto-merge: an action's update reaches the jobs ` +
              `that hold the release app's key`,
          )
        }
      }
    }
  }
  for (const [id, job] of jobsOf(automerge)) {
    const at = `${AUTOMERGE_WORKFLOW}: job ${id}`
    for (const step of stepsOf(job).filter((s) =>
      usesAction(s, "actions/create-github-app-token"),
    )) {
      const given = step.with ?? {}
      const grants = Object.keys(given)
        .filter((key) => key.startsWith("permission-"))
        .sort()
      if (
        !isDeepStrictEqual(grants, ["permission-contents", "permission-pull-requests"]) ||
        given["permission-contents"] !== "write" ||
        given["permission-pull-requests"] !== "write"
      ) {
        errors.push(
          `${at} mints the release app's token with ${grants.join(", ") || "every permission of the app"}; ` +
            `narrow it to permission-contents: write and permission-pull-requests: write`,
        )
      }
      if (given.repositories === undefined) {
        errors.push(`${at} mints the token for every repository of the app; name this one`)
      }
    }
  }
  return errors
}

// ── every workflow: actions pinned by commit ────────────────────────────────

/** A step's `uses:` line, with the action, its ref and what follows it on the line. */
const USES_LINE = /^\s*(?:-\s+)?uses:\s*(\S+?)(?:@(\S+))?(\s+#.*)?\s*$/
/** The version a pin names in its comment, as Dependabot writes it back: `# v7.0.1`, `# 1.6`. */
const PIN_COMMENT = /^\s+#\s*v?\d+(?:\.\d+)*\b/

/**
 * Every workflow: each action is pinned by a full commit SHA with its version as a comment, which
 * Dependabot's github-actions entry moves to each release; a tag moves with whoever controls the
 * action's repository, so it never stands where a job holds a credential, or anywhere else. A
 * local action (`./`) and a reusable workflow of this repository need none (pure, over the files'
 * text: the comment is gone once parsed).
 */
export function checkActionPins(texts) {
  const errors = []
  for (const [file, text] of texts) {
    text.split("\n").forEach((line, index) => {
      const match = USES_LINE.exec(line)
      if (match === null) return
      const [, action, ref = "", comment = ""] = match
      if (action.startsWith("./") || action.startsWith("docker://")) return
      const at = `${file}:${index + 1}`
      if (!COMMIT_REF.test(ref)) {
        errors.push(
          `${at}: ${action} is pinned to "${ref}"; pin it to the full commit SHA of its release, ` +
            `with the version as a comment (uses: ${action}@<sha> # v<version>)`,
        )
      } else if (!PIN_COMMENT.test(comment)) {
        errors.push(`${at}: ${action}@${ref} names no version in a comment (# v<version>)`)
      }
    })
  }
  return errors
}

// ── docs.yml: the docs site ─────────────────────────────────────────────────

export const DOCS_WORKFLOW = ".github/workflows/docs.yml"
/**
 * The events the docs workflow runs on, each of them: a pull request builds the site, the release
 * calls it to deploy, a dispatch deploys by hand. Never a push or a schedule, so the public site
 * shows no docs that no release shipped.
 */
export const DOCS_TRIGGERS = ["pull_request", "workflow_call", "workflow_dispatch"]
/** The environment of the Pages deploy; its deployment branch policy admits main only. */
export const PAGES_ENVIRONMENT = "github-pages"
const PAGES_GRANT = { pages: "write", "id-token": "write" }
/** The deploy's condition in the release: a release exists, which no dry run creates. */
const RELEASE_CREATED = "needs.release-please.outputs.release_created == 'true'"

/** Like holdsIdToken, for pages: a string grants it, a map that names it at all does. */
const holdsPages = (job) => {
  const permissions = job?.permissions
  if (permissions === undefined) return false
  if (permissions === null || typeof permissions !== "object" || Array.isArray(permissions)) {
    return true
  }
  return Object.hasOwn(permissions, "pages")
}

/** The one job of docs.yml that deploys: in github-pages with exactly the Pages grant, main only. */
function checkPagesDeployJob(doc) {
  const errors = []
  const jobs = jobsOf(doc)
  const deploys = jobs.filter(([, job]) => environmentOf(job) === PAGES_ENVIRONMENT)
  if (deploys.length !== 1) {
    const ids = deploys.map(([id]) => id).join(", ")
    errors.push(
      `${DOCS_WORKFLOW}: exactly one job runs in the environment ${PAGES_ENVIRONMENT} (the ` +
        `deploy job), found ${deploys.length}${ids === "" ? "" : ` (${ids})`}`,
    )
  }
  for (const [id, job] of deploys) {
    const at = `${DOCS_WORKFLOW}: job ${id}`
    if (!isDeepStrictEqual(job.permissions, PAGES_GRANT)) {
      errors.push(
        `${at} must hold exactly { pages: write, id-token: write } (found ` +
          `${JSON.stringify(job.permissions)})`,
      )
    }
    const condition = String(job.if ?? "")
    if (
      !condition.includes("github.event_name != 'pull_request'") ||
      !condition.includes("github.ref == 'refs/heads/main'")
    ) {
      errors.push(
        `${at} must deploy from main only, never from a pull request (if: github.event_name != ` +
          `'pull_request' && github.ref == 'refs/heads/main')`,
      )
    }
  }
  for (const [id, job] of jobs.filter(([, other]) => environmentOf(other) !== PAGES_ENVIRONMENT)) {
    if (holdsIdToken(job) || holdsPages(job)) {
      errors.push(
        `${DOCS_WORKFLOW}: job ${id} holds pages or id-token: only the deploy job in ` +
          `${PAGES_ENVIRONMENT} may (a string such as write-all or read-all counts)`,
      )
    }
  }
  return errors
}

/** The one release job that calls docs.yml: after the approval, once a release exists. */
function checkDocsCaller(releaseDoc) {
  const errors = []
  const callers = jobsOf(releaseDoc).filter(([, job]) => job?.uses === `./${DOCS_WORKFLOW}`)
  if (callers.length !== 1) {
    errors.push(
      `${RELEASE_WORKFLOW}: exactly one job calls ./${DOCS_WORKFLOW}, found ${callers.length}: ` +
        `a release deploys the docs site once, and nothing else does`,
    )
  }
  for (const [id, job] of callers) {
    const at = `${RELEASE_WORKFLOW}: job ${id}`
    const needs = asList(job.needs)
    if (!["release-please", "gate"].every((need) => needs.includes(need))) {
      errors.push(`${at} must need release-please and gate: the site deploys an approved release`)
    }
    const condition = String(job.if ?? "")
    if (!condition.includes(RELEASE_CREATED) || /\|\||inputs\./.test(condition)) {
      errors.push(
        `${at} must run only once a release is created (if: \${{ ${RELEASE_CREATED} }}), with ` +
          `no alternative: a dry run creates no release and deploys nothing`,
      )
    }
    const grant = { contents: "read", ...PAGES_GRANT }
    if (!isDeepStrictEqual(job.permissions, grant)) {
      errors.push(
        `${at} must hold exactly { contents: read, pages: write, id-token: write }: the ceiling ` +
          `of the called build and deploy jobs (found ${JSON.stringify(job.permissions)})`,
      )
    }
    if (job.secrets !== undefined) {
      errors.push(`${at} passes secrets: the deploy needs none, never secrets: inherit`)
    }
  }
  return errors
}

/**
 * The docs site deploys with a release, never with a push to main (pure; `workflows` holds
 * release-please.yml too): docs.yml runs on exactly DOCS_TRIGGERS with no permission at the top
 * level, one job deploys, in github-pages from main, and one job of release-please.yml calls it
 * after the approval, only once a release is created, with the Pages grants and no secret.
 */
export function checkDocsDeploy(workflows) {
  const doc = workflows.get(DOCS_WORKFLOW)
  if (doc === undefined) return [`${DOCS_WORKFLOW} is missing: a release never deploys the docs`]
  const errors = []
  const triggers = Object.keys(triggersOf(doc))
  for (const event of triggers.filter((event) => !DOCS_TRIGGERS.includes(event))) {
    errors.push(
      `${DOCS_WORKFLOW}: runs on ${event}; it runs on ${DOCS_TRIGGERS.join(", ")} only, so the ` +
        `site deploys with a release or by hand, never docs that no release shipped`,
    )
  }
  for (const event of DOCS_TRIGGERS.filter((event) => !triggers.includes(event))) {
    errors.push(
      `${DOCS_WORKFLOW}: does not run on ${event}: a pull request builds the site, the release ` +
        `calls it (workflow_call), a dispatch on main deploys it by hand`,
    )
  }
  if (!isDeepStrictEqual(doc.permissions, {})) {
    errors.push(`${DOCS_WORKFLOW}: top-level permissions must be {}: each job names its own`)
  }
  errors.push(...checkPagesDeployJob(doc), ...checkDocsCaller(workflows.get(RELEASE_WORKFLOW)))
  return errors
}

// ── CI scopes ───────────────────────────────────────────────────────────────

const SCOPE_REFERENCE = /\bneeds\.changes\.outputs\.([\w-]+)/g
const RUNS_UNLESS_CANCELLED = /^\$\{\{\s*!\s*cancelled\(\)\s*\}\}$/

/**
 * Every ci.yml job waits for `changes` and reads only real scopes, and one always-on job
 * fails when `changes` fails (otherwise all scoped jobs skip, and skipped passes).
 */
export function checkCiScopes(doc, { scopes = SCOPES } = {}) {
  const jobs = new Map(jobsOf(doc))
  const changes = jobs.get("changes")
  if (changes === undefined) return [`${CI_WORKFLOW}: no changes job hands out the CI scopes`]
  const errors = []
  const outputs = changes.outputs ?? {}
  for (const scope of scopes) {
    if (outputs[scope] !== `\${{ steps.scopes.outputs.${scope} }}`) {
      errors.push(
        `${CI_WORKFLOW}: the changes job does not hand out the scope "${scope}" (steps.scopes.outputs.${scope})`,
      )
    }
  }
  for (const name of Object.keys(outputs).filter((name) => !scopes.includes(name))) {
    errors.push(
      `${CI_WORKFLOW}: the changes job hands out "${name}", which scripts/ci-scopes.mjs does not compute`,
    )
  }
  const waitsForChanges = (id, seen = new Set([id])) =>
    asList(jobs.get(id)?.needs).some(
      (need) => need === "changes" || (!seen.has(need) && waitsForChanges(need, seen.add(need))),
    )
  const used = new Set()
  for (const [id, job] of jobs) {
    if (id === "changes") continue
    if (!waitsForChanges(id)) {
      errors.push(
        `${CI_WORKFLOW}: job ${id} does not wait for the changes job, so it runs outside every scope`,
      )
    }
    const read = [...JSON.stringify(job).matchAll(SCOPE_REFERENCE)].map(([, scope]) => scope)
    if (read.length > 0 && !asList(job.needs).includes("changes")) {
      errors.push(
        `${CI_WORKFLOW}: job ${id} reads a scope but does not list changes in its needs, so it reads nothing`,
      )
    }
    for (const scope of read) {
      used.add(scope)
      if (!scopes.includes(scope))
        errors.push(`${CI_WORKFLOW}: job ${id} reads the unknown scope "${scope}"`)
    }
  }
  for (const scope of scopes.filter((scope) => !used.has(scope))) {
    errors.push(`${CI_WORKFLOW}: no job runs in the scope "${scope}"`)
  }
  const guards = [...jobs.values()].filter(
    (job) =>
      asList(job.needs).includes("changes") &&
      RUNS_UNLESS_CANCELLED.test(String(job.if ?? "")) &&
      JSON.stringify(stepsOf(job)).includes("needs.changes.result"),
  )
  if (guards.length === 0) {
    errors.push(
      `${CI_WORKFLOW}: no job runs on every pull request (if: \${{ !cancelled() }}) and ` +
        `fails on needs.changes.result: a failed changes job would pass as a row of skipped checks`,
    )
  }
  return errors
}

// ── Main ────────────────────────────────────────────────────────────────────

const readYaml = (root, file) =>
  existsSync(path.join(root, file)) ? parse(readFileSync(path.join(root, file), "utf8")) : undefined

/** Every violation of the repo at `root`. */
export function checkRepo(root) {
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
  const texts = new Map(
    [...workflows.keys()].map((file) => [file, readFileSync(path.join(root, file), "utf8")]),
  )
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
    ...checkTemplatePinBumps(
      JSON.parse(readFileSync(path.join(root, "release-please-config.json"), "utf8")),
      templatePackageFiles(root),
    ),
    ...checkJsonExtraFileForm(
      JSON.parse(readFileSync(path.join(root, "release-please-config.json"), "utf8")),
      (rel) => (exists(rel) ? readFileSync(path.join(root, rel), "utf8") : undefined),
    ),
    ...checkGenericExtraFiles(
      JSON.parse(readFileSync(path.join(root, "release-please-config.json"), "utf8")),
      (rel) => (exists(rel) ? readFileSync(path.join(root, rel), "utf8") : undefined),
      JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")).version,
    ),
    ...checkReleaseGate(workflows.get(RELEASE_WORKFLOW)),
    ...checkChannelPublishWorkflows(workflows),
    ...checkCredentialJobs(workflows),
    ...checkActionPins(texts),
    ...checkDependabotAutomerge(workflows),
    ...checkVscodePublish(
      workflows.get(RELEASE_WORKFLOW),
      workflows.get(VSCODE_PUBLISH_WORKFLOW),
      packages,
    ),
    ...checkDocsDeploy(workflows),
    ...checkCiScopes(workflows.get(CI_WORKFLOW)),
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
    "GitHub config: publish workflow, npm matrix and repositories, release extra-files, " +
      "plugin versions and template pins in release-please's form, the versions the generic " +
      "extra-files mark, the release gate, the channels' publish workflows (the CLI, Orca, the " +
      "image, the starter's mirror), no build next to a credential, the actions' commit pins, " +
      "Dependabot's auto-merge, the extension's release path, the docs deploy and the CI " +
      "scopes hold.",
  )
}
