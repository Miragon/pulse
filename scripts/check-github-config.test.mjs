import assert from "node:assert/strict"
import { execFileSync, spawnSync } from "node:child_process"
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { after, describe, it } from "node:test"
import { fileURLToPath } from "node:url"
import { parse } from "yaml"
import {
  CI_WORKFLOW,
  INCREMENTAL_FILE,
  MUTATION_TIMEOUT_CEILING,
  NIGHTLY_WORKFLOW,
  PUBLISHABLE_DIR,
  PUBLISH_WORKFLOW,
  RELEASE_WORKFLOW,
  VSCODE_APP_DIR,
  VSCODE_ENVIRONMENT,
  VSCODE_PUBLISH_WORKFLOW,
  VSCODE_SWITCH,
  actionRefs,
  checkArtifactGlobs,
  checkDependabot,
  checkNightlyMutation,
  checkPlaywrightPins,
  checkPublishMatrix,
  checkPublishWorkflow,
  checkReleaseExtraFiles,
  checkRepo,
  checkRequiredChecks,
  checkStrykerIncremental,
  checkVscodePublish,
  expectedRepository,
  isNpmPublished,
  packageManagerRun,
  readWorkspace,
} from "./check-github-config.mjs"
import { workspaceGlobs } from "./check-package-scripts.mjs"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const readDoc = (file) => parse(readFileSync(path.join(ROOT, file), "utf8"))
const GLOBS = workspaceGlobs(readFileSync(path.join(ROOT, "pnpm-workspace.yaml"), "utf8"))

/** Scratch dirs under the OS tmpdir: every fixture lives there and is removed afterwards. */
const scratch = []
const tempDir = (prefix) => {
  const dir = mkdtempSync(path.join(tmpdir(), prefix))
  scratch.push(dir)
  return dir
}
after(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true })
})

const writeFile = (root, rel, text, mode) => {
  mkdirSync(path.dirname(path.join(root, rel)), { recursive: true })
  writeFileSync(path.join(root, rel), text, mode === undefined ? undefined : { mode })
}

/** A package npm receives, with the repository field its provenance publish needs. */
const published = (dir, manifest) => ({
  [dir]: { ...manifest, repository: expectedRepository(dir) },
})

/**
 * Today's workspace, as manifests. The fixture cases below run on fixture data only (this
 * workspace and configs built for it), so a package that lands in the real tree changes none of
 * them; the real files are compared with the real workspace alone.
 */
const TODAY = {
  "apps/mcp-server-camunda7": { name: "@miragon/pulse-mcp-server-camunda7", private: true },
  ...published("packages/core/widget-shell", { name: "@miragon/pulse-widget-shell" }),
  ...published("packages/connectors/camunda/camunda7-client", {
    name: "@miragon/pulse-camunda7-client",
  }),
  ...published("packages/connectors/camunda/camunda7-connector", {
    name: "@miragon/pulse-camunda7-connector",
  }),
  ...published("packages/connectors/analytics/analytics-client", {
    name: "@miragon/pulse-analytics-client",
  }),
  ...published("packages/connectors/analytics/analytics-connector", {
    name: "@miragon/pulse-analytics-connector",
  }),
  docs: { name: "@miragon/pulse-docs", private: true },
}
/** Packages that do not exist yet: a public CLI, a VS Code extension, a public domain package. */
const CLI = published("apps/cli", {
  name: "@miragon/pulse-cli",
  bin: { "pulse-cli": "dist/cli.js" },
})
const VSCODE = { "apps/vscode": { name: "pulse-vscode", engines: { vscode: "^1.101.0" } } }
const DOMAIN = published("packages/connectors/camunda/camunda7-domain", {
  name: "@miragon/pulse-camunda7-domain",
})

/** A workspace fixture in a tmpdir, read back the way the gate reads the real one. */
function workspace(manifests) {
  const root = tempDir("gh-config-ws-")
  writeFile(
    root,
    "pnpm-workspace.yaml",
    'packages:\n  - "apps/*"\n  - "packages/core/*"\n  - "packages/connectors/*/*"\n  - "docs"\n',
  )
  for (const [dir, manifest] of Object.entries(manifests)) {
    writeFile(root, `${dir}/package.json`, JSON.stringify(manifest))
  }
  return readWorkspace(root)
}

const matches = (errors, pattern) => errors.some((error) => pattern.test(error))

describe("the repo", () => {
  it("holds every rule", () => {
    assert.deepEqual(checkRepo(ROOT), [])
  })

  it("publishes exactly the packages that are neither private nor an extension", () => {
    assert.equal(isNpmPublished({ name: "a" }), true)
    assert.equal(isNpmPublished({ name: "a", private: true }), false)
    assert.equal(isNpmPublished({ name: "pulse-vscode", engines: { vscode: "^1.101.0" } }), false)
    assert.equal(isNpmPublished({ name: "a", engines: { node: ">=22" } }), true)
  })
})

// ── publish-npm-package.yml ─────────────────────────────────────────────────

const PUBLISH = readDoc(PUBLISH_WORKFLOW)
/** The refs the repo's other workflows pin, as checkRepo hands them to checkPublishWorkflow. */
const REAL_PINS = actionRefs(
  new Map(
    readdirSync(path.join(ROOT, ".github/workflows"))
      .filter((name) => /\.ya?ml$/.test(name) && `.github/workflows/${name}` !== PUBLISH_WORKFLOW)
      .map((name) => [name, readDoc(`.github/workflows/${name}`)]),
  ),
)
const publishErrors = (mutate, options) => {
  const doc = structuredClone(PUBLISH)
  mutate(doc)
  return checkPublishWorkflow(doc, options)
}
const stepNamed = (job, name) => job.steps.find((step) => step.name === name || step.id === name)
const setupNode = (job) => job.steps.find((step) => step.uses?.startsWith("actions/setup-node@"))
/** A second job in the npm environment that checks out, installs and publishes. */
const rogueJob = (permissions) => ({
  "runs-on": "ubuntu-latest",
  environment: "npm",
  permissions,
  steps: [
    { uses: "actions/checkout@v7.0.1", with: { "persist-credentials": false } },
    { run: "npm install -g pnpm && pnpm install" },
    { run: "npm publish --provenance" },
  ],
})

describe("checkPublishWorkflow", () => {
  it("accepts the real workflow, also against the pins of the other workflows", () => {
    assert.deepEqual(checkPublishWorkflow(PUBLISH), [])
    assert.deepEqual(checkPublishWorkflow(PUBLISH, { pinnedRefs: REAL_PINS }), [])
  })

  it("rejects the retired package input and a missing directory input", () => {
    const legacy = publishErrors((doc) => {
      doc.on.workflow_call.inputs.package = doc.on.workflow_call.inputs.directory
      doc.on.workflow_call.inputs.package.description = "Package directory under packages/"
      delete doc.on.workflow_call.inputs.directory
    })
    assert.ok(matches(legacy, /input "package"/))
    assert.ok(matches(legacy, /required string input "directory"/))
  })

  it("rejects id-token at the top level", () => {
    const errors = publishErrors((doc) => {
      doc.permissions = { "id-token": "write" }
    })
    assert.ok(matches(errors, /top-level permissions must be \{\}/))
  })

  it("rejects no job and two jobs with id-token", () => {
    assert.ok(
      matches(
        publishErrors((doc) => delete doc.jobs.publish.permissions["id-token"]),
        /exactly one job may hold id-token .* found 0;/,
      ),
    )
    assert.ok(
      matches(
        publishErrors((doc) => (doc.jobs.pack.permissions["id-token"] = "write")),
        /exactly one job may hold id-token .* found 2 \(pack, publish\)/,
      ),
    )
  })

  it("counts every grant of id-token as a token job, a string permissions included", () => {
    for (const permissions of ["write-all", "read-all", { "id-token": "none" }]) {
      const errors = publishErrors((doc) => (doc.jobs.pack.permissions = permissions))
      assert.ok(matches(errors, /found 2 \(pack, publish\)/), JSON.stringify(permissions))
      assert.ok(
        matches(errors, /job pack must hold exactly \{ id-token: write \}/),
        JSON.stringify(permissions),
      )
    }
    const readAll = publishErrors((doc) => (doc.jobs.publish.permissions = "read-all"))
    assert.deepEqual(readAll.length, 1)
    assert.match(readAll[0], /job publish must hold exactly \{ id-token: write \}.*"read-all"/)
  })

  it("rejects a second job in the npm environment, with write-all or without the token", () => {
    const writeAll = publishErrors((doc) => (doc.jobs.rogue = rogueJob("write-all")))
    assert.ok(matches(writeAll, /found 2 \(publish, rogue\)/))
    assert.ok(matches(writeAll, /job rogue must hold exactly \{ id-token: write \}/))
    assert.ok(
      matches(writeAll, /job rogue uses actions\/checkout@v7\.0\.1: the token job uses only/),
    )
    assert.ok(matches(writeAll, /job rogue runs "pnpm"/))
    const tokenless = publishErrors((doc) => (doc.jobs.rogue = rogueJob({ contents: "read" })))
    assert.deepEqual(tokenless.length, 1)
    assert.match(tokenless[0], /job rogue runs in the environment npm without the token/)
  })

  it("rejects a publish job that holds anything next to the token", () => {
    const errors = publishErrors((doc) => (doc.jobs.publish.permissions.contents = "read"))
    assert.deepEqual(errors.length, 1)
    assert.match(errors[0], /exactly \{ id-token: write \}/)
  })

  it("rejects a publish job outside the npm environment", () => {
    const errors = publishErrors((doc) => delete doc.jobs.publish.environment)
    assert.deepEqual(errors.length, 1)
    assert.match(errors[0], /environment npm/)
  })

  it("rejects a checkout, any other action, a package manager or an install in the token job, one each", () => {
    for (const step of [
      { uses: "actions/checkout@v7.0.1" },
      { uses: "pnpm/action-setup@v6.1.0" },
      { uses: "bahmutov/npm-install@v1" },
      { uses: "./.github/actions/setup" },
      { uses: "docker://node:24" },
      { run: "pnpm install --frozen-lockfile" },
      { run: "npm ci" },
      { run: "npm install -g npm@11" },
      { run: "npx foo" },
      { run: "npm add -g npm@latest" },
      { run: "npm update -g npm" },
      { run: "npm clean-install" },
      { run: "npm it" },
      { run: "npm rb" },
      { run: "npm i" },
      { run: "npm exec -- foo" },
      { run: "npm x foo" },
      { run: "npm run build" },
      { run: "npm rebuild" },
      { run: "npm -g install npm@11" },
      { run: "npm --loglevel=silent up" },
      { run: "npm --prefix /tmp/x install foo" },
      { run: "echo ok && npm cit" },
      { run: "yarn" },
      { run: "corepack enable" },
      { run: "bun install" },
      { run: "bunx foo" },
      { run: "pnpx foo" },
    ]) {
      const errors = publishErrors((doc) => doc.jobs.publish.steps.unshift(step))
      assert.equal(errors.length, 1, JSON.stringify({ step, errors }))
      assert.match(
        errors[0],
        /job publish (?:uses .*: the token job uses only actions\/setup-node and actions\/download-artifact|runs ".*": no package manager runs next to the token)/,
      )
    }
  })

  it("leaves npm --version, npm view and npm publish and prose about npm alone", () => {
    for (const script of [
      "npm --version",
      'npm view "@miragon/pulse-x@1.2.3" version',
      'npm view "@miragon/pulse-x@1.2.3" dist.attestations.url',
      'npm publish "$tarball" --access public --provenance',
      'echo "::notice::x is already on npm from the repo, nothing to publish"',
      'echo "::error::npm $(npm --version) predates trusted publishing"',
      "echo npm_config_registry",
      ...PUBLISH.jobs.publish.steps.map((step) => step.run ?? ""),
    ]) {
      assert.equal(packageManagerRun(script), undefined, script)
    }
  })

  it("keeps the token job's actions on exact pins the other workflows run", () => {
    for (const ref of ["v7", "main", "v7.1"]) {
      const errors = publishErrors(
        (doc) => (setupNode(doc.jobs.publish).uses = `actions/setup-node@${ref}`),
      )
      assert.deepEqual(errors.length, 1, ref)
      assert.match(errors[0], /pin an exact version \(vX\.Y\.Z\) or a commit SHA/)
    }
    const sha = `actions/setup-node@${"a".repeat(40)}`
    assert.deepEqual(
      publishErrors((doc) => (setupNode(doc.jobs.publish).uses = sha)),
      [],
    )
    const pinnedRefs = new Map([["actions/download-artifact", new Set(["v8.0.2"])]])
    const older = publishErrors(
      (doc) => {
        doc.jobs.publish.steps.find((s) => s.uses?.startsWith("actions/download-artifact@")).uses =
          "actions/download-artifact@v8.0.1"
      },
      { pinnedRefs },
    )
    assert.deepEqual(older.length, 1)
    assert.match(older[0], /the other workflows run actions\/download-artifact@v8\.0\.2/)
  })

  it("collects each action's refs over every workflow", () => {
    const refs = actionRefs(
      new Map([
        [
          "a.yml",
          { jobs: { x: { steps: [{ uses: "actions/setup-node@v7.1.0" }, { run: "true" }] } } },
        ],
        [
          "b.yml",
          {
            jobs: {
              y: { steps: [{ uses: "actions/setup-node@v7.0.0" }, { uses: "./local-action" }] },
              z: { uses: "./.github/workflows/c.yml" },
            },
          },
        ],
      ]),
    )
    assert.deepEqual([...refs.keys()], ["actions/setup-node"])
    assert.deepEqual([...refs.get("actions/setup-node")].sort(), ["v7.0.0", "v7.1.0"])
  })

  it("rejects a dependency cache in either job", () => {
    for (const job of ["pack", "publish"]) {
      const errors = publishErrors((doc) => (setupNode(doc.jobs[job]).with.cache = "pnpm"))
      assert.ok(matches(errors, /sets cache/), job)
    }
    assert.ok(
      matches(
        publishErrors((doc) => delete setupNode(doc.jobs.pack).with["package-manager-cache"]),
        /package-manager-cache: false/,
      ),
    )
  })

  it("rejects npm pack, which ships workspace:* verbatim", () => {
    const errors = publishErrors((doc) => {
      stepNamed(doc.jobs.pack, "Pack").run = "npm pack --ignore-scripts"
    })
    assert.ok(matches(errors, /npm pack ships workspace:\* verbatim/))
  })

  it("rejects pnpm publish anywhere and npm publish without provenance", () => {
    assert.ok(
      matches(
        publishErrors((doc) => doc.jobs.pack.steps.push({ run: "pnpm publish --access public" })),
        /pnpm publish/,
      ),
    )
    const errors = publishErrors((doc) => {
      const step = stepNamed(doc.jobs.publish, "Publish")
      step.run = step.run.replace(" --provenance", "")
    })
    assert.deepEqual(errors.length, 1)
    assert.match(errors[0], /--provenance/)
  })

  it("rejects a constant artifact name: the matrix calls share one run", () => {
    const errors = publishErrors((doc) => {
      doc.jobs.pack.steps.find((s) => s.uses?.startsWith("actions/upload-artifact@")).with.name =
        "package"
    })
    assert.ok(matches(errors, /artifact name "package" is constant/))
  })

  it("rejects an expression in a run script (template injection)", () => {
    const errors = publishErrors((doc) => {
      stepNamed(doc.jobs.pack, "pkg").run = 'echo "${{ inputs.directory }}"'
    })
    assert.ok(matches(errors, /template injection/))
  })

  it("rejects a workflow without bash as the default shell", () => {
    assert.ok(
      matches(
        publishErrors((doc) => delete doc.defaults),
        /defaults\.run\.shell/,
      ),
    )
  })

  it("rejects a publish job that runs on a dry run or needs no pack job", () => {
    assert.ok(
      matches(
        publishErrors((doc) => delete doc.jobs.publish.if),
        /dry run/,
      ),
    )
    assert.ok(
      matches(
        publishErrors((doc) => delete doc.jobs.publish.needs),
        /need the pack job/,
      ),
    )
  })

  it("keeps the Resolve package step on the directories the gate calls publishable", () => {
    const script = stepNamed(PUBLISH.jobs.pack, "pkg").run
    assert.ok(script.includes(PUBLISHABLE_DIR.source.replaceAll("\\/", "/")))
  })
})

// ── Behaviour of the publish workflow's bash steps ──────────────────────────

const BASH = existsSync("/bin/bash") ? "/bin/bash" : "bash"

/** Runs a step script the way GitHub runs it under `shell: bash`. */
const runStep = (script, { cwd, env }) =>
  spawnSync(BASH, ["--noprofile", "--norc", "-eo", "pipefail", "-c", script], {
    cwd,
    env: { PATH: process.env.PATH, ...env },
    encoding: "utf8",
  })

describe("the Resolve package step", () => {
  const script = stepNamed(PUBLISH.jobs.pack, "pkg").run
  const repo = tempDir("gh-config-resolve-")
  for (const [dir, manifest] of Object.entries({
    ...TODAY,
    ...CLI,
    ...VSCODE,
    ...DOMAIN,
    "apps/private-app": { name: "@miragon/pulse-private-app", private: true },
  })) {
    writeFile(repo, `${dir}/package.json`, JSON.stringify(manifest))
  }
  let runs = 0
  const resolve = (DIR) => {
    const output = path.join(repo, `github-output-${(runs += 1)}`)
    writeFileSync(output, "")
    const result = runStep(script, { cwd: repo, env: { DIR, GITHUB_OUTPUT: output } })
    return { ...result, output: readFileSync(output, "utf8").trim().split("\n").filter(Boolean) }
  }

  for (const [DIR, artifact] of [
    ["packages/core/widget-shell", "npm-miragon-pulse-widget-shell"],
    ["packages/connectors/camunda/camunda7-domain", "npm-miragon-pulse-camunda7-domain"],
    ["apps/cli", "npm-miragon-pulse-cli"],
  ]) {
    it(`resolves ${DIR}`, () => {
      const result = resolve(DIR)
      assert.equal(result.status, 0, result.stdout + result.stderr)
      const name = JSON.parse(readFileSync(path.join(repo, DIR, "package.json"), "utf8")).name
      assert.deepEqual(result.output, [`name=${name}`, `artifact=${artifact}`])
    })
  }

  for (const [DIR, message] of [
    ["core/widget-shell", /no workspace package directory/],
    ["packages/core/../../apps/cli", /no workspace package directory/],
    ["apps/..", /no workspace package directory/],
    ["packages/core/missing", /no workspace package directory/],
    ["apps/cli; touch pwned", /no workspace package directory/],
    ["apps/private-app", /is private: npm never receives it/],
    ["apps/mcp-server-camunda7", /is private/],
    ["apps/vscode", /engines\.vscode: a VS Code extension ships as a \.vsix through vsce\/ovsx/],
  ]) {
    it(`refuses ${DIR}`, () => {
      const result = resolve(DIR)
      assert.equal(result.status, 1)
      assert.match(result.stdout, message)
      assert.deepEqual(result.output, [])
      assert.equal(existsSync(path.join(repo, "pwned")), false)
    })
  }
})

/** A stub npm (logs its argv) and curl (prints the fixture attestations) first on PATH. */
function stubTools(dir, { published, attestationRepo, npmVersion = "11.6.0" }) {
  const bin = path.join(dir, "bin")
  writeFile(
    bin,
    "npm",
    [
      "#!/bin/bash",
      'echo "npm $*" >> "$STUB/calls"',
      'if [ "$1" = --version ]; then echo "$STUB_NPM_VERSION"; exit 0; fi',
      'if [ "$1" = view ] && [ "$3" = version ]; then',
      published ? `  echo ${published}; exit 0` : "  exit 1",
      "fi",
      'if [ "$1" = view ] && [ "$3" = dist.attestations.url ]; then',
      attestationRepo ? "  echo https://registry.example/attestations" : "  echo",
      "fi",
      "exit 0",
      "",
    ].join("\n"),
    0o755,
  )
  writeFile(
    bin,
    "curl",
    '#!/bin/bash\nif [ -f "$STUB/attestations.json" ]; then cat "$STUB/attestations.json"; else exit 22; fi\n',
    0o755,
  )
  if (attestationRepo) {
    const payload = Buffer.from(
      JSON.stringify({
        predicate: {
          buildDefinition: { externalParameters: { workflow: { repository: attestationRepo } } },
        },
      }),
    ).toString("base64")
    writeFile(
      dir,
      "attestations.json",
      JSON.stringify({
        attestations: [
          { predicateType: "https://github.com/npm/attestation/tree/main/specs/publish/v0.1" },
          {
            predicateType: "https://slsa.dev/provenance/v1",
            bundle: { dsseEnvelope: { payload } },
          },
        ],
      }),
    )
  }
  return { PATH: `${bin}:${process.env.PATH}`, STUB: dir, STUB_NPM_VERSION: npmVersion }
}

describe("the npm floor step", () => {
  const script = stepNamed(
    PUBLISH.jobs.publish,
    "Require an npm with trusted publishing (>= 11.5.1)",
  ).run
  for (const [version, status] of [
    ["11.4.2", 1],
    ["11.5.0", 1],
    ["11.5.1", 0],
    ["11.10.0", 0],
    ["12.0.2", 0],
  ]) {
    it(`npm ${version} -> exit ${status}`, () => {
      const dir = tempDir("gh-config-npm-")
      const env = stubTools(dir, { npmVersion: version })
      const result = runStep(script, { cwd: dir, env })
      assert.equal(result.status, status, result.stdout + result.stderr)
    })
  }
})

describe("the Publish step", () => {
  const script = stepNamed(PUBLISH.jobs.publish, "Publish").run
  const SOURCE = "https://github.com/Miragon/pulse"

  function publish({ tag = "v1.2.3", tarVersion = "1.2.3", tarballs = 1, ...stub }) {
    const dir = tempDir("gh-config-publish-")
    const runnerTemp = path.join(dir, "runner")
    mkdirSync(path.join(runnerTemp, "package"), { recursive: true })
    writeFile(
      dir,
      "src/package/package.json",
      JSON.stringify({ name: "@miragon/pulse-x", version: tarVersion }),
    )
    for (let i = 0; i < tarballs; i++) {
      const tarball = path.join(runnerTemp, "package", `x-${i}.tgz`)
      execFileSync("tar", ["-czf", tarball, "-C", path.join(dir, "src"), "package"])
    }
    const env = { ...stubTools(dir, stub), RUNNER_TEMP: runnerTemp, TAG: tag, SOURCE }
    const result = runStep(script, { cwd: dir, env })
    const callsFile = path.join(dir, "calls")
    const calls = existsSync(callsFile) ? readFileSync(callsFile, "utf8").trim().split("\n") : []
    return { ...result, calls, published: calls.filter((call) => call.startsWith("npm publish")) }
  }

  it("publishes a new version with provenance", () => {
    const result = publish({})
    assert.equal(result.status, 0, result.stdout + result.stderr)
    assert.equal(result.published.length, 1)
    assert.match(result.published[0], /^npm publish \S+\/x-0\.tgz --access public --provenance$/)
  })

  it("passes a re-run whose version carries this repository's provenance", () => {
    const result = publish({ published: "1.2.3", attestationRepo: SOURCE })
    assert.equal(result.status, 0, result.stdout + result.stderr)
    assert.match(result.stdout, /::notice::@miragon\/pulse-x@1\.2\.3 is already on npm/)
    assert.deepEqual(result.published, [])
  })

  it("fails a version another repository published", () => {
    const result = publish({
      published: "1.2.3",
      attestationRepo: "https://github.com/example/fork",
    })
    assert.equal(result.status, 1)
    assert.match(
      result.stdout,
      /not from https:\/\/github\.com\/Miragon\/pulse \(provenance: https:\/\/github\.com\/example\/fork\)/,
    )
    assert.deepEqual(result.published, [])
  })

  it("fails a version published without provenance (a token publish)", () => {
    const result = publish({ published: "1.2.3" })
    assert.equal(result.status, 1)
    assert.match(result.stdout, /provenance: none/)
    assert.deepEqual(result.published, [])
  })

  it("fails on two tarballs and on none", () => {
    const two = publish({ tarballs: 2 })
    assert.equal(two.status, 1)
    assert.match(two.stdout, /Expected one package tarball, got 2/)
    assert.notEqual(publish({ tarballs: 0 }).status, 0)
    assert.deepEqual([...two.published], [])
  })

  it("fails a tarball that is not the release tag, and an empty tag", () => {
    const stale = publish({ tarVersion: "0.0.0" })
    assert.equal(stale.status, 1)
    assert.match(
      stale.stdout,
      /@miragon\/pulse-x@0\.0\.0 is not the release v1\.2\.3: .*extra-files/,
    )
    assert.deepEqual(stale.published, [])
    const untagged = publish({ tag: "" })
    assert.equal(untagged.status, 1)
    assert.deepEqual(untagged.published, [])
  })
})

// ── release-please.yml + release-please-config.json ─────────────────────────

const RELEASE = readDoc(RELEASE_WORKFLOW)
const REAL_PACKAGES = readWorkspace(ROOT)
/** The real release workflow with its npm matrix rebuilt for a fixture workspace. */
const fixtureRelease = (packages) => {
  const doc = structuredClone(RELEASE)
  doc.jobs["publish-npm"].strategy.matrix.directory = packages
    .filter(({ dir, manifest }) => isNpmPublished(manifest) && PUBLISHABLE_DIR.test(dir))
    .map(({ dir }) => dir)
  return doc
}
const matrixErrors = (packages, mutate = () => {}) => {
  const doc = fixtureRelease(workspace(TODAY))
  mutate(doc)
  return checkPublishMatrix(doc, packages)
}
const addToMatrix = (dir) => (doc) => doc.jobs["publish-npm"].strategy.matrix.directory.push(dir)

describe("checkPublishMatrix", () => {
  it("accepts the real release workflow and workspace", () => {
    assert.deepEqual(checkPublishMatrix(RELEASE, REAL_PACKAGES), [])
  })

  it("accepts a matrix built for the fixture workspace", () => {
    assert.deepEqual(matrixErrors(workspace(TODAY)), [])
  })

  it("demands a public domain package and a public CLI", () => {
    const domain = matrixErrors(workspace({ ...TODAY, ...DOMAIN }))
    assert.equal(domain.length, 1)
    assert.match(
      domain[0],
      /packages\/connectors\/camunda\/camunda7-domain \(@miragon\/pulse-camunda7-domain\) is published to npm .* add it to the publish-npm matrix/,
    )
    const cli = matrixErrors(workspace({ ...TODAY, ...CLI }))
    assert.equal(cli.length, 1)
    assert.match(cli[0], /apps\/cli \(@miragon\/pulse-cli\) is published to npm/)
    assert.deepEqual(matrixErrors(workspace({ ...TODAY, ...CLI }), addToMatrix("apps/cli")), [])
  })

  it("keeps a VS Code extension out of the npm matrix, private or not", () => {
    assert.deepEqual(matrixErrors(workspace({ ...TODAY, ...VSCODE })), [])
    const listed = matrixErrors(workspace({ ...TODAY, ...VSCODE }), addToMatrix("apps/vscode"))
    assert.equal(listed.length, 1)
    assert.match(listed[0], /apps\/vscode \(pulse-vscode\) declares engines\.vscode: .*vsce\/ovsx/)
    const privateExtension = {
      "apps/vscode": { ...VSCODE["apps/vscode"], private: true },
    }
    assert.deepEqual(matrixErrors(workspace({ ...TODAY, ...privateExtension })), [])
    assert.ok(
      matches(
        matrixErrors(workspace({ ...TODAY, ...privateExtension }), addToMatrix("apps/vscode")),
        /vsce\/ovsx/,
      ),
    )
  })

  it("rejects a legacy entry, a private package and a duplicate", () => {
    const packages = workspace(TODAY)
    assert.ok(
      matches(
        matrixErrors(packages, addToMatrix("core/widget-shell")),
        /core\/widget-shell is no workspace package directory/,
      ),
    )
    assert.ok(
      matches(
        matrixErrors(packages, addToMatrix("apps/mcp-server-camunda7")),
        /is private: npm never receives it/,
      ),
    )
    assert.ok(
      matches(matrixErrors(packages, addToMatrix("packages/core/widget-shell")), /listed twice/),
    )
  })

  it("demands the repository npm checks against the provenance", () => {
    for (const [fixture, dir] of [
      [CLI, "apps/cli"],
      [DOMAIN, "packages/connectors/camunda/camunda7-domain"],
    ]) {
      const { repository, ...manifest } = fixture[dir]
      assert.deepEqual(repository, {
        type: "git",
        url: "git+https://github.com/Miragon/pulse.git",
        directory: dir,
      })
      for (const wrong of [
        undefined,
        "github:Miragon/pulse",
        { ...repository, url: "git+https://github.com/example/fork.git" },
        { ...repository, url: "git+https://github.com/miragon/pulse.git" },
        { ...repository, url: "https://github.com/Miragon/pulse" },
        { ...repository, directory: "packages/core/widget-shell" },
        { url: repository.url, directory: dir },
      ]) {
        const errors = matrixErrors(
          workspace({ ...TODAY, [dir]: { ...manifest, repository: wrong } }),
          addToMatrix(dir),
        )
        assert.equal(errors.length, 1, JSON.stringify({ dir, wrong, errors }))
        const head = `${dir} (${manifest.name}) is published to npm with provenance`
        assert.ok(errors[0].startsWith(head), errors[0])
        assert.ok(errors[0].includes(JSON.stringify(repository)), errors[0])
      }
    }
    // Private packages and extensions never reach npm, so they need none.
    assert.deepEqual(
      matrixErrors(workspace({ ...TODAY, "apps/private-app": { name: "x", private: true } })),
      [],
    )
    assert.deepEqual(matrixErrors(workspace({ ...TODAY, ...VSCODE })), [])
  })

  it("rejects a public package the publish workflow cannot pack", () => {
    const errors = matrixErrors(workspace({ ...TODAY, docs: { name: "@miragon/pulse-docs" } }))
    assert.ok(
      matches(errors, /^docs \(@miragon\/pulse-docs\) is not private, .* mark it "private": true/),
    )
  })

  it("rejects a caller that grants more or less, passes no version or feeds the mirror early", () => {
    const packages = workspace(TODAY)
    for (const mutate of [
      (doc) => (doc.jobs["publish-npm"].permissions.contents = "write"),
      (doc) => delete doc.jobs["publish-npm"].permissions["id-token"],
    ]) {
      assert.ok(
        matches(matrixErrors(packages, mutate), /exactly \{ contents: read, id-token: write \}/),
      )
    }
    assert.ok(
      matches(
        matrixErrors(packages, (doc) => delete doc.jobs["publish-npm"].with.version),
        /must pass version/,
      ),
    )
    assert.ok(
      matches(
        matrixErrors(
          packages,
          (doc) => (doc.jobs["sync-template-mirror"].needs = ["release-please"]),
        ),
        /sync-template-mirror must need publish-npm/,
      ),
    )
    assert.ok(
      matches(
        matrixErrors(
          packages,
          (doc) => (doc.jobs["publish-npm"].with = { package: "${{ matrix.package }}" }),
        ),
        /must pass directory/,
      ),
    )
  })
})

/** A release-please config that bumps the root and every fixture package, as the gate asks. */
const fixtureConfig = (manifests) => ({
  packages: {
    ".": {
      "extra-files": [
        { type: "generic", path: "engine-plugins/gradle.properties" },
        { type: "json", path: "package.json", jsonpath: "$.version" },
        ...Object.keys(manifests)
          .filter((dir) => /^(?:apps|packages)\//.test(dir))
          .map((dir) => ({ type: "json", path: `${dir}/package.json`, jsonpath: "$.version" })),
      ],
    },
  },
})

describe("checkReleaseExtraFiles", () => {
  const realConfig = JSON.parse(readFileSync(path.join(ROOT, "release-please-config.json"), "utf8"))
  const config = fixtureConfig(TODAY)
  const exists = (rel) => existsSync(path.join(ROOT, rel))

  it("accepts the real config", () => {
    assert.deepEqual(checkReleaseExtraFiles(realConfig, REAL_PACKAGES, { fileExists: exists }), [])
  })

  it("accepts a config built for the fixture workspace", () => {
    assert.deepEqual(checkReleaseExtraFiles(config, workspace(TODAY)), [])
  })

  it("demands every package under apps/ and packages/, published or not", () => {
    const errors = checkReleaseExtraFiles(
      config,
      workspace({ ...TODAY, ...DOMAIN, ...CLI, ...VSCODE }),
    )
    assert.deepEqual(
      errors.map((error) => /: (\S+\/package\.json) /.exec(error)?.[1]),
      [
        "apps/cli/package.json",
        "apps/vscode/package.json",
        "packages/connectors/camunda/camunda7-domain/package.json",
      ],
    )
  })

  it("leaves the private docs package (outside apps/ and packages/) alone", () => {
    const withoutDocs = workspace({
      ...TODAY,
      docs: { name: "@miragon/pulse-docs", private: true },
    })
    assert.deepEqual(checkReleaseExtraFiles(config, withoutDocs), [])
  })

  it("demands the root and refuses a path that does not exist", () => {
    const broken = structuredClone(realConfig)
    const files = broken.packages["."]["extra-files"]
    files.splice(
      files.findIndex((entry) => entry.path === "package.json"),
      1,
    )
    files.push({ type: "json", path: "apps/gone/package.json", jsonpath: "$.version" })
    const errors = checkReleaseExtraFiles(broken, REAL_PACKAGES, { fileExists: exists })
    assert.ok(matches(errors, /: package\.json \(the root\) is missing/))
    assert.ok(matches(errors, /apps\/gone\/package\.json does not exist/))
  })
})

// ── publish-vscode-extension.yml ────────────────────────────────────────────

const VSCODE_PUBLISH = readDoc(VSCODE_PUBLISH_WORKFLOW)
const WITH_EXTENSION = workspace({ ...TODAY, ...VSCODE })
const WITHOUT_EXTENSION = workspace(TODAY)
/**
 * checkVscodePublish over the real release and extension workflows, mutated: `mutate` gets the
 * release-please.yml doc, the caller job, the extension workflow doc and its jobs.
 */
const vscodeErrors = (mutate, packages = WITH_EXTENSION) => {
  const release = structuredClone(RELEASE)
  const publish = structuredClone(VSCODE_PUBLISH)
  mutate({ release, caller: release.jobs["publish-vscode"], publish, jobs: publish.jobs })
  return checkVscodePublish(release, publish, packages)
}
const stepUsing = (job, action) => job.steps.find((step) => step.uses?.startsWith(`${action}@`))

describe("checkVscodePublish", () => {
  it("accepts the real workflows, for the real and the fixture workspace", () => {
    assert.deepEqual(checkVscodePublish(RELEASE, VSCODE_PUBLISH, REAL_PACKAGES), [])
    assert.deepEqual(
      vscodeErrors(() => {}),
      [],
    )
  })

  it("asks nothing of a workspace without an extension, and refuses a caller there", () => {
    const withoutCaller = structuredClone(RELEASE)
    delete withoutCaller.jobs["publish-vscode"]
    assert.deepEqual(checkVscodePublish(withoutCaller, undefined, WITHOUT_EXTENSION), [])
    assert.deepEqual(checkVscodePublish(withoutCaller, VSCODE_PUBLISH, WITHOUT_EXTENSION), [])
    const errors = vscodeErrors(() => {}, WITHOUT_EXTENSION)
    assert.equal(errors.length, 1, errors.join("\n"))
    assert.match(errors[0], /job publish-vscode calls .* apps\/vscode, which declares no engines/)
  })

  it("demands the workflow once an extension exists", () => {
    const errors = checkVscodePublish(RELEASE, undefined, WITH_EXTENSION)
    assert.deepEqual(errors, [
      `${VSCODE_PUBLISH_WORKFLOW} is missing: a release never packages the extension`,
    ])
  })

  it("demands an extension under apps/", () => {
    const withoutCaller = structuredClone(RELEASE)
    delete withoutCaller.jobs["publish-vscode"]
    const elsewhere = workspace({
      ...TODAY,
      "packages/core/vscode-extension": { name: "pulse-x", engines: { vscode: "^1.101.0" } },
    })
    const errors = checkVscodePublish(withoutCaller, VSCODE_PUBLISH, elsewhere)
    assert.equal(errors.length, 1, errors.join("\n"))
    assert.match(errors[0], /packages\/core\/vscode-extension \(pulse-x\) .* apps\/<name> only/)
  })

  it("reads the environment in both of its forms", () => {
    const named = vscodeErrors(({ jobs }) => {
      jobs.publish.environment = { name: VSCODE_ENVIRONMENT, url: "https://example.com" }
    })
    assert.deepEqual(named, [])
  })

  /** One mutation per rule, each with exactly the errors it must raise. */
  const CASES = [
    [
      "no caller",
      ({ release }) => delete release.jobs["publish-vscode"],
      [/0 jobs .* a release never packages it \(or twice\)/],
    ],
    [
      "a caller with another directory",
      ({ caller }) => (caller.with.directory = "apps/vscodex"),
      [/apps\/vscodex, which declares no engines\.vscode: it packages nothing/, /0 jobs of/],
    ],
    [
      "a second caller",
      ({ release, caller }) => (release.jobs["publish-vscode-again"] = structuredClone(caller)),
      [/2 jobs of .* \(or twice\)/],
    ],
    [
      "needs release-please only",
      ({ caller }) => (caller.needs = "release-please"),
      [/must need release-please and gate/],
    ],
    [
      "a literal channel",
      ({ caller }) => (caller.with.channel = "release"),
      [/must pass channel: \$\{\{ vars\.VSCODE_PUBLISH \}\} \(found "release"\)/],
    ],
    ["no channel", ({ caller }) => delete caller.with.channel, [/must pass channel/]],
    ["a constant dry run", ({ caller }) => (caller.with.dry_run = false), [/must pass dry_run/]],
    ["no version", ({ caller }) => delete caller.with.version, [/must pass version/]],
    [
      "secrets: inherit",
      ({ caller }) => (caller.secrets = "inherit"),
      [/passes secrets: the store credentials live in the vscode-marketplace environment/],
    ],
    [
      "write-all on the caller",
      ({ caller }) => (caller.permissions = "write-all"),
      [/exactly \{ contents: write, id-token: write \}/],
    ],
    [
      "a caller without id-token",
      ({ caller }) => delete caller.permissions["id-token"],
      [/exactly \{ contents: write, id-token: write \}/],
    ],
    [
      "a required input that is not",
      ({ publish }) => delete publish.on.workflow_call.inputs.version.required,
      [/required string input "version"/],
    ],
    [
      "no channel input",
      ({ publish }) => delete publish.on.workflow_call.inputs.channel,
      [/string input "channel"/],
    ],
    [
      "a string dry_run input",
      ({ publish }) => (publish.on.workflow_call.inputs.dry_run.type = "string"),
      [/boolean input "dry_run"/],
    ],
    [
      "top-level permissions",
      ({ publish }) => (publish.permissions = { contents: "read" }),
      [/top-level permissions must be \{\}/],
    ],
    [
      "no bash default",
      ({ publish }) => delete publish.defaults,
      [/defaults\.run\.shell must be bash/],
    ],
    [
      "a publish job without id-token",
      ({ jobs }) => delete jobs.publish.permissions["id-token"],
      [/job publish must hold exactly \{ contents: read, id-token: write \}/],
    ],
    [
      "a publish job with contents: write",
      ({ jobs }) => (jobs.publish.permissions.contents = "write"),
      [/job publish must hold exactly \{ contents: read, id-token: write \}/],
    ],
    [
      "a second job in the environment",
      ({ jobs }) =>
        (jobs.rogue = {
          "runs-on": "ubuntu-latest",
          environment: VSCODE_ENVIRONMENT,
          permissions: { contents: "read" },
          steps: [{ run: "echo hello" }],
        }),
      [/exactly one job runs in the environment vscode-marketplace .* found 2 \(publish, rogue\)/],
    ],
    [
      "id-token on package",
      ({ jobs }) => (jobs.package.permissions["id-token"] = "write"),
      [/job package must hold exactly \{ contents: read \}/],
    ],
    [
      "package in an environment",
      ({ jobs }) => (jobs.package.environment = "release"),
      [/job package runs in no environment/],
    ],
    [
      "id-token on attach",
      ({ jobs }) => (jobs.attach.permissions["id-token"] = "write"),
      [/job attach holds id-token/],
    ],
    [
      "read-all on attach",
      ({ jobs }) => (jobs.attach.permissions = "read-all"),
      [/job attach holds id-token/],
    ],
    [
      "a secret in the package job",
      ({ jobs }) => (stepNamed(jobs.package, "Package").env.VSCE_PAT = "${{ secrets.VSCE_PAT }}"),
      [/job package reads secrets/],
    ],
    [
      "an expression inside a run",
      ({ jobs }) => {
        const step = stepNamed(jobs.package, "channel")
        step.run = step.run.replace('case "$CHANNEL" in', 'case "${{ inputs.channel }}" in')
      },
      [/job package: a run script holds a \$\{\{ \}\} expression/],
    ],
    [
      "actions/cache in publish",
      ({ jobs }) =>
        jobs.publish.steps.splice(1, 0, {
          uses: "actions/cache@v6.1.0",
          with: { path: "x", key: "k" },
        }),
      [/job publish uses actions\/cache@v6\.1\.0: a release job restores no cache/],
    ],
    [
      "actions/cache/restore in package",
      ({ jobs }) =>
        jobs.package.steps.splice(1, 0, {
          uses: "actions/cache/restore@v6.1.0",
          with: { path: "x", key: "k" },
        }),
      [/job package uses actions\/cache\/restore@v6\.1\.0/],
    ],
    [
      "cache: pnpm on setup-node",
      ({ jobs }) => (stepUsing(jobs.package, "actions/setup-node").with.cache = "pnpm"),
      [/job package: actions\/setup-node@v7\.1\.0 sets cache/],
    ],
    [
      "setup-node with the package manager cache",
      ({ jobs }) =>
        delete stepUsing(jobs.publish, "actions/setup-node").with["package-manager-cache"],
      [/job publish: actions\/setup-node must set package-manager-cache: false/],
    ],
    [
      "a checkout that keeps its credentials",
      ({ jobs }) => delete stepUsing(jobs.publish, "actions/checkout").with,
      [/job publish: actions\/checkout must set persist-credentials: false/],
    ],
    [
      "an install that runs lifecycle scripts",
      ({ jobs }) => {
        const step = stepNamed(jobs.publish, "Install vsce and ovsx")
        step.run = step.run.replace(" --ignore-scripts", "")
      },
      [/pnpm install must pass --ignore-scripts/],
    ],
    [
      "an install off the lockfile",
      ({ jobs }) => {
        const step = stepNamed(jobs.publish, "Install vsce and ovsx")
        step.run = step.run.replace(" --frozen-lockfile", "")
      },
      [/pnpm install must pass --frozen-lockfile/],
    ],
    ...[
      ["--ignore-scripts", "--ignore-scripts=false"],
      ["--ignore-scripts", "--no-ignore-scripts"],
      ["--ignore-scripts", "--ignore-scripts --config.ignore-scripts=false"],
      ["--frozen-lockfile", "--frozen-lockfile=false"],
      ["--frozen-lockfile", "--no-frozen-lockfile"],
    ].map(([flag, negated]) => [
      `an install that switches ${flag} back off with ${negated}`,
      ({ jobs }) => {
        const step = stepNamed(jobs.publish, "Install vsce and ovsx")
        step.run = step.run.replace(` ${flag}`, ` ${negated}`)
      },
      [new RegExp(`pnpm install must pass ${flag}, and no word that switches it back off`)],
    ]),
    [
      "install flags only in a comment",
      ({ jobs }) => {
        const step = stepNamed(jobs.publish, "Install vsce and ovsx")
        step.run =
          'pnpm install --fail-if-no-match --filter "${NAME}" # --frozen-lockfile --ignore-scripts'
      },
      [/pnpm install must pass --frozen-lockfile/, /pnpm install must pass --ignore-scripts/],
    ],
    [
      "a second install command without the flags in the same step",
      ({ jobs }) => {
        const step = stepNamed(jobs.publish, "Install vsce and ovsx")
        step.run = `${step.run} && pnpm install`
      },
      [/pnpm install must pass --frozen-lockfile/, /pnpm install must pass --ignore-scripts/],
    ],
    [
      "a second install",
      ({ jobs }) =>
        jobs.publish.steps.splice(4, 0, { run: "pnpm install --frozen-lockfile --ignore-scripts" }),
      [/must run exactly one pnpm install, found 2/],
    ],
    [
      "a build next to the credentials",
      ({ jobs }) =>
        jobs.publish.steps.splice(4, 0, {
          run: 'pnpm --fail-if-no-match --filter "${NAME}" run build',
        }),
      [
        /job publish runs "pnpm --fail-if-no-match --filter "\$\{NAME\}" run build": next to the credentials/,
      ],
    ],
    [
      "a build script without a package manager",
      ({ jobs }) =>
        jobs.publish.steps.splice(4, 0, {
          run: "cd apps/vscode && node scripts/build.mjs --production",
        }),
      [/runs "node scripts\/build\.mjs --production"/],
    ],
    [
      "a registry download next to the credentials",
      ({ jobs }) => jobs.publish.steps.splice(4, 0, { run: "npx @vscode/vsce@latest --version" }),
      [/runs "npx @vscode\/vsce@latest --version"/],
    ],
    [
      "a Marketplace publish without --skip-duplicate",
      ({ jobs }) => {
        const step = stepNamed(jobs.publish, "Publish to the Visual Studio Marketplace")
        step.run = step.run.replace(" --skip-duplicate", "")
      },
      [/the step "Publish to the Visual Studio Marketplace" must pass --skip-duplicate/],
    ],
    [
      "an Open VSX publish without --skip-duplicate",
      ({ jobs }) => {
        const step = stepNamed(jobs.publish, "Publish to Open VSX")
        step.run = step.run.replace(" --skip-duplicate", "")
      },
      [/the step "Publish to Open VSX" must pass --skip-duplicate/],
    ],
    [
      "a Marketplace publish that switches --skip-duplicate back off",
      ({ jobs }) => {
        const step = stepNamed(jobs.publish, "Publish to the Visual Studio Marketplace")
        step.run = step.run.replace(" --skip-duplicate)", " --skip-duplicate=false)")
      },
      [/the step "Publish to the Visual Studio Marketplace" must pass --skip-duplicate/],
    ],
    [
      "an Open VSX publish with --skip-duplicate only in a comment",
      ({ jobs }) => {
        const step = stepNamed(jobs.publish, "Publish to Open VSX")
        step.run = `${step.run.replace(" --skip-duplicate)", ")")}\n# --skip-duplicate`
      },
      [/the step "Publish to Open VSX" must pass --skip-duplicate/],
    ],
    [
      "no Open VSX publish",
      ({ jobs }) =>
        (jobs.publish.steps = jobs.publish.steps.filter(
          (step) => step.name !== "Publish to Open VSX",
        )),
      [/must run open-vsx:publish in exactly one step, found 0/],
    ],
    [
      "a publish job that runs on a dry run",
      ({ jobs }) => (jobs.publish.if = "${{ needs.package.outputs.publish == 'true' }}"),
      [/must skip itself on a dry run and while the switch is off/],
    ],
    [
      "a publish job that ignores the switch",
      ({ jobs }) => (jobs.publish.if = "${{ inputs.dry_run != true }}"),
      [/must skip itself on a dry run and while the switch is off/],
    ],
    [
      "a publish job that needs nothing",
      ({ jobs }) => delete jobs.publish.needs,
      [/must need the package job/],
    ],
  ]
  for (const [label, mutate, expected] of CASES) {
    it(`rejects ${label}`, () => {
      const errors = vscodeErrors(mutate)
      assert.equal(errors.length, expected.length, errors.join("\n"))
      for (const pattern of expected)
        assert.ok(matches(errors, pattern), `${pattern}\n${errors.join("\n")}`)
    })
  }

  it("pins the switch the caller passes and the directories the Resolve step accepts", () => {
    assert.equal(RELEASE.jobs["publish-vscode"].with.channel, VSCODE_SWITCH)
    const script = stepNamed(VSCODE_PUBLISH.jobs.package, "pkg").run
    assert.ok(script.includes(VSCODE_APP_DIR.source.replaceAll("\\/", "/")))
  })
})

// ── Behaviour of the extension workflow's bash steps ────────────────────────

describe("the Release switch step", () => {
  const script = stepNamed(VSCODE_PUBLISH.jobs.package, "channel").run
  const dir = tempDir("gh-config-switch-")
  let runs = 0
  const resolve = (CHANNEL) => {
    const output = path.join(dir, `github-output-${(runs += 1)}`)
    writeFileSync(output, "")
    const result = runStep(script, { cwd: dir, env: { CHANNEL, GITHUB_OUTPUT: output } })
    return { ...result, output: readFileSync(output, "utf8").trim().split("\n").filter(Boolean) }
  }

  for (const [CHANNEL, publish, preRelease] of [
    ["", false, false],
    ["off", false, false],
    ["pre-release", true, true],
    ["release", true, false],
  ]) {
    it(`reads ${JSON.stringify(CHANNEL)} as publish=${publish}, pre_release=${preRelease}`, () => {
      const result = resolve(CHANNEL)
      assert.equal(result.status, 0, result.stdout + result.stderr)
      assert.deepEqual(result.output, [`publish=${publish}`, `pre_release=${preRelease}`])
    })
  }

  for (const CHANNEL of ["prerelease", "true", "on", "Release", "release "]) {
    it(`fails on ${JSON.stringify(CHANNEL)}`, () => {
      const result = resolve(CHANNEL)
      assert.equal(result.status, 1)
      assert.match(result.stdout, /VSCODE_PUBLISH is/)
      assert.deepEqual(result.output, [])
    })
  }
})

describe("the Resolve extension step", () => {
  const script = stepNamed(VSCODE_PUBLISH.jobs.package, "pkg").run
  const repo = tempDir("gh-config-resolve-vsix-")
  const extension = (manifest) => ({
    name: "pulse-vscode",
    version: "1.2.3",
    engines: { vscode: "^1.101.0" },
    ...manifest,
  })
  for (const [dir, manifest] of Object.entries({
    ...TODAY,
    "apps/vscode": extension({}),
    "apps/beta": extension({ name: "pulse-beta", version: "1.2.3-beta.1" }),
    "apps/plain": { name: "pulse-plain", version: "1.2.3" },
    "apps/scoped": extension({ name: "@miragon/pulse-vscode" }),
  })) {
    writeFile(repo, `${dir}/package.json`, JSON.stringify(manifest))
  }
  let runs = 0
  const resolve = (DIR, TAG) => {
    const output = path.join(repo, `github-output-${(runs += 1)}`)
    writeFileSync(output, "")
    const result = runStep(script, { cwd: repo, env: { DIR, TAG, GITHUB_OUTPUT: output } })
    return { ...result, output: readFileSync(output, "utf8").trim().split("\n").filter(Boolean) }
  }

  for (const TAG of ["v1.2.3", ""]) {
    it(`resolves apps/vscode for ${TAG === "" ? "a dry run" : TAG}`, () => {
      const result = resolve("apps/vscode", TAG)
      assert.equal(result.status, 0, result.stdout + result.stderr)
      assert.deepEqual(result.output, [
        "name=pulse-vscode",
        "version=1.2.3",
        "vsix=pulse-vscode-1.2.3.vsix",
        "artifact=vsix-pulse-vscode",
      ])
    })
  }

  for (const [DIR, TAG, message] of [
    ["apps/vscode", "v1.2.4", /pulse-vscode@1\.2\.3 is not the release v1\.2\.4/],
    ["apps/beta", "", /pulse-beta@1\.2\.3-beta\.1: the Marketplace takes major\.minor\.patch only/],
    ["apps/plain", "", /apps\/plain declares no engines\.vscode/],
    ["apps/scoped", "", /is named "@miragon\/pulse-vscode": vsce takes an unscoped lowercase name/],
    ["apps/..", "", /apps\/\.\. is no app directory/],
    ["apps/missing", "", /is no app directory/],
    ["packages/core/widget-shell", "", /is no app directory/],
    ["apps/vscode; touch pwned", "", /is no app directory/],
  ]) {
    it(`refuses ${DIR}${TAG === "" ? "" : ` for ${TAG}`}`, () => {
      const result = resolve(DIR, TAG)
      assert.equal(result.status, 1)
      assert.match(result.stdout, message)
      assert.deepEqual(result.output, [])
      assert.equal(existsSync(path.join(repo, "pwned")), false)
    })
  }
})

// ── dependabot.yml ──────────────────────────────────────────────────────────

const DEPENDABOT = readDoc(".github/dependabot.yml")
const dirExists = (rel) => existsSync(path.join(ROOT, rel))
/** A Dependabot config in the real one's shape, over fixture groups and directories. */
const FIXTURE_DEPENDABOT = {
  version: 2,
  updates: [
    {
      "package-ecosystem": "npm",
      directory: "/",
      ignore: [
        {
          "dependency-name": "@types/vscode",
          "update-types": ["version-update:semver-minor", "version-update:semver-major"],
        },
      ],
      groups: {
        cli: { patterns: ["commander", "tsdown"] },
        vscode: { patterns: ["@vscode/*", "@types/vscode"] },
        "npm-dependencies": {
          patterns: ["*"],
          "exclude-patterns": ["commander", "tsdown", "@vscode/*", "@types/vscode"],
        },
      },
    },
    {
      "package-ecosystem": "docker",
      directories: ["/playground/docker", "/playground/docker/otel"],
      groups: { "docker-dependencies": { patterns: ["*"] } },
    },
    {
      "package-ecosystem": "github-actions",
      directory: "/",
      groups: { "github-actions": { patterns: ["*"] } },
    },
  ],
}
const FIXTURE_DIRS = new Set([".", "playground/docker", "playground/docker/otel"])
const fixtureDirExists = (rel) => FIXTURE_DIRS.has(rel)
const dependabotErrors = (mutate, options = {}) => {
  const doc = structuredClone(FIXTURE_DEPENDABOT)
  mutate(doc)
  return checkDependabot(doc, {
    packages: workspace(TODAY),
    dirExists: fixtureDirExists,
    ...options,
  })
}
const npmEntry = (doc) => doc.updates.find((entry) => entry["package-ecosystem"] === "npm")

describe("checkDependabot", () => {
  it("accepts the real config", () => {
    assert.deepEqual(checkDependabot(DEPENDABOT, { packages: REAL_PACKAGES, dirExists }), [])
  })

  it("accepts the fixture config", () => {
    assert.deepEqual(
      dependabotErrors(() => {}),
      [],
    )
  })

  it("rejects a group listed after the catch-all", () => {
    const errors = dependabotErrors((doc) => {
      const { cli, ...rest } = npmEntry(doc).groups
      npmEntry(doc).groups = { ...rest, cli }
    })
    assert.deepEqual(errors.length, 1)
    assert.match(errors[0], /cli is listed after the catch-all npm-dependencies/)
  })

  it("rejects a group pattern the catch-all does not exclude", () => {
    const errors = dependabotErrors((doc) => {
      const catchAll = npmEntry(doc).groups["npm-dependencies"]
      catchAll["exclude-patterns"] = catchAll["exclude-patterns"].filter((p) => p !== "tsdown")
    })
    assert.deepEqual(errors.length, 1)
    assert.match(
      errors[0],
      /tsdown of group cli is missing from npm-dependencies\.exclude-patterns/,
    )
  })

  it("rejects a directory that does not exist yet", () => {
    const addCliImage = (doc) =>
      doc.updates.push({
        "package-ecosystem": "docker",
        directory: "/apps/cli",
        groups: { "docker-cli": { patterns: ["*"] } },
      })
    assert.ok(matches(dependabotErrors(addCliImage), /\/apps\/cli does not exist/))
    assert.deepEqual(
      dependabotErrors(addCliImage, {
        dirExists: (rel) => rel === "apps/cli" || fixtureDirExists(rel),
      }),
      [],
    )
    const missing = dependabotErrors((doc) =>
      doc.updates.find((entry) => entry.directories).directories.push("/playground/docker/missing"),
    )
    assert.deepEqual(missing.length, 1)
    assert.match(missing[0], /\/playground\/docker\/missing does not exist/)
  })

  it("holds @types/vscode at the floor once an extension exists", () => {
    const packages = workspace({ ...TODAY, ...VSCODE })
    const ignoring = (types) => (doc) =>
      (npmEntry(doc).ignore =
        types === undefined
          ? undefined
          : [{ "dependency-name": "@types/vscode", "update-types": types }])
    assert.ok(
      matches(
        dependabotErrors(ignoring(undefined), { packages }),
        /apps\/vscode \(pulse-vscode\) declares engines\.vscode/,
      ),
    )
    assert.ok(
      matches(
        dependabotErrors(ignoring(["version-update:semver-major"]), { packages }),
        /@types\/vscode/,
      ),
    )
    assert.deepEqual(
      dependabotErrors(ignoring(["version-update:semver-minor", "version-update:semver-major"]), {
        packages,
      }),
      [],
    )
  })

  it("asks nothing of @types/vscode without an extension", () => {
    assert.deepEqual(
      dependabotErrors((doc) => delete npmEntry(doc).ignore),
      [],
    )
  })

  it("passes entries whose only group is a catch-all", () => {
    assert.deepEqual(
      dependabotErrors((doc) => doc.updates.splice(doc.updates.indexOf(npmEntry(doc)), 1)),
      [],
    )
  })
})

// ── Required checks ─────────────────────────────────────────────────────────

const WORKFLOWS = new Map(
  ["ci.yml", "pr-title.yml", "dependency-review.yml", "release-please.yml"].map((name) => [
    `.github/workflows/${name}`,
    readDoc(`.github/workflows/${name}`),
  ]),
)
const requiredErrors = (mutate) => {
  const workflows = structuredClone(WORKFLOWS)
  mutate(workflows)
  return checkRequiredChecks(workflows)
}
const ci = (workflows) => workflows.get(CI_WORKFLOW)

describe("checkRequiredChecks", () => {
  it("finds every required check in the real workflows", () => {
    assert.deepEqual(checkRequiredChecks(WORKFLOWS), [])
  })

  it("rejects a renamed required job", () => {
    const errors = requiredErrors((w) => (ci(w).jobs.kotlin.name = "Kotlin"))
    assert.deepEqual(errors.length, 1)
    assert.match(errors[0], /"Kotlin \(Build \+ Test\)" is a required check/)
  })

  it("rejects a required job no pull request runs", () => {
    const errors = requiredErrors(
      (w) => (w.get(".github/workflows/dependency-review.yml").on = { push: null }),
    )
    assert.ok(matches(errors, /"Dependency Review" is a required check/))
  })

  it("rejects a paths filter and a matrix on a required job", () => {
    assert.ok(
      matches(
        requiredErrors((w) => (ci(w).on.pull_request.paths = ["apps/**"])),
        /pull_request has a paths filter/,
      ),
    )
    assert.ok(
      matches(
        requiredErrors((w) => (ci(w).jobs.mutation.strategy = { matrix: { pkg: ["a", "b"] } })),
        /"Mutation \(changed files\)" \(job mutation\) is required, but a matrix/,
      ),
    )
  })

  it("reads every form of on", () => {
    for (const on of ["pull_request", ["push", "pull_request"], { pull_request_target: null }]) {
      const errors = requiredErrors(
        (w) => (w.get(".github/workflows/dependency-review.yml").on = on),
      )
      assert.deepEqual(errors, [], JSON.stringify(on))
    }
  })
})

// ── Mutation artifacts + the nightly full run ───────────────────────────────

const CI = readDoc(CI_WORKFLOW)
const NIGHTLY = readDoc(NIGHTLY_WORKFLOW)
const artifactErrors = (mutate) => {
  const docs = { ci: structuredClone(CI), nightly: structuredClone(NIGHTLY) }
  mutate(docs)
  return checkArtifactGlobs(docs.ci, docs.nightly, GLOBS)
}
const uploadNamed = (doc, name) =>
  Object.values(doc.jobs)
    .flatMap((job) => job.steps ?? [])
    .find(
      (step) =>
        step.uses?.startsWith("actions/upload-artifact@") &&
        String(step.with?.name).startsWith(name),
    )

describe("checkPlaywrightPins", () => {
  const SERVER = "apps/mcp-server-camunda7"
  const pinned = (dir, field, name, version) => ({
    dir,
    manifest: { name: dir, [field]: { [name]: version } },
  })

  it("holds the extension's playwright and the server app's @playwright/test at one version", () => {
    const pins = readWorkspace(ROOT).flatMap(({ dir, manifest }) =>
      ["playwright", "@playwright/test"]
        .map((name) => manifest.devDependencies?.[name])
        .filter(Boolean)
        .map((version) => `${dir} ${version}`),
    )
    assert.equal(pins.length, 2, pins.join(", "))
    assert.deepEqual(checkPlaywrightPins(readWorkspace(ROOT)), [])
  })

  it("passes one version, a single pin and none", () => {
    const same = [
      pinned("apps/vscode", "devDependencies", "playwright", "1.64.1"),
      pinned(SERVER, "devDependencies", "@playwright/test", "1.64.1"),
    ]
    assert.deepEqual(checkPlaywrightPins(same), [])
    assert.deepEqual(checkPlaywrightPins(same.slice(0, 1)), [])
    assert.deepEqual(checkPlaywrightPins([{ dir: "docs", manifest: { name: "docs" } }]), [])
  })

  it("fails two versions and names every pin", () => {
    const errors = checkPlaywrightPins([
      pinned("apps/vscode", "devDependencies", "playwright", "1.63.0"),
      pinned(SERVER, "devDependencies", "@playwright/test", "1.64.1"),
    ])
    assert.equal(errors.length, 1)
    assert.match(
      errors[0],
      /apps\/vscode playwright 1\.63\.0, apps\/mcp-server-camunda7 @playwright\/test 1\.64\.1\): ci\.yml keys one browser cache/,
    )
  })

  it("reads runtime dependencies too", () => {
    const errors = checkPlaywrightPins([
      pinned("apps/vscode", "dependencies", "playwright", "1.63.0"),
      pinned(SERVER, "devDependencies", "@playwright/test", "1.64.1"),
    ])
    assert.equal(errors.length, 1)
  })
})

describe("checkArtifactGlobs", () => {
  it("accepts the real workflows", () => {
    assert.deepEqual(checkArtifactGlobs(CI, NIGHTLY, GLOBS), [])
  })

  it("rejects ** and a missing package form", () => {
    const errors = artifactErrors(({ ci }) => {
      uploadNamed(ci, "mutation-reports").with.path = "packages/**/reports/mutation-report.json"
    })
    assert.ok(
      matches(
        errors,
        /uploads packages\/\*\*\/reports\/mutation-report\.json: upload-artifact follows symlinks/,
      ),
    )
    assert.ok(matches(errors, /misses apps\/\*\/reports\/mutation-report\.json/))
    const coverage = artifactErrors(({ ci }) => {
      const upload = uploadNamed(ci, "coverage-summaries")
      upload.with.path = upload.with.path.replace("apps/*/coverage/coverage-summary.json\n", "")
    })
    assert.deepEqual(coverage.length, 1)
    assert.match(coverage[0], /misses apps\/\*\/coverage\/coverage-summary\.json/)
    const nightly = artifactErrors(({ nightly }) => {
      const upload = uploadNamed(nightly, "mutation-report-")
      upload.with.path = upload.with.path.replace(
        "packages/core/*/reports/mutation-report.json\n",
        "",
      )
    })
    assert.deepEqual(nightly.length, 1)
    assert.match(nightly[0], /mutation-nightly\.yml: .* misses packages\/core\/\*\/reports/)
  })

  it("rejects a report download below the repo root, in both workflows", () => {
    const download = (doc, key, value) =>
      Object.values(doc.jobs)
        .flatMap((job) => job.steps ?? [])
        .find((s) => s.uses?.startsWith("actions/download-artifact@") && s.with?.[key] === value)
    for (const [mutate, message] of [
      [
        ({ ci }) => (download(ci, "name", "mutation-reports").with.path = "packages"),
        /ci\.yml: job fitness downloads mutation-reports into packages/,
      ],
      [
        ({ ci }) => (download(ci, "name", "coverage-summaries").with.path = "packages"),
        /ci\.yml: job fitness downloads coverage-summaries into packages/,
      ],
      [
        ({ nightly }) => (download(nightly, "pattern", "mutation-report-*").with.path = "packages"),
        /mutation-nightly\.yml: job summary downloads mutation-report-\* into packages/,
      ],
    ]) {
      const errors = artifactErrors(mutate)
      assert.deepEqual(errors.length, 1, errors.join("\n"))
      assert.match(errors[0], message)
    }
  })

  it("demands the coverage and mutation artifacts of ci.yml, uploaded and downloaded", () => {
    for (const name of ["coverage-summaries", "mutation-reports"]) {
      const notDownloaded = artifactErrors(({ ci }) => {
        ci.jobs.fitness.steps = ci.jobs.fitness.steps.filter((s) => s.with?.name !== name)
      })
      assert.deepEqual(notDownloaded.length, 1)
      assert.match(notDownloaded[0], new RegExp(`no step downloads the artifact ${name}`))
      const notUploaded = artifactErrors(({ ci }) => {
        for (const job of Object.values(ci.jobs)) {
          job.steps = (job.steps ?? []).filter(
            (s) => !(s.uses?.startsWith("actions/upload-artifact@") && s.with?.name === name),
          )
        }
      })
      assert.deepEqual(notUploaded.length, 1)
      assert.match(notUploaded[0], new RegExp(`no step uploads the artifact ${name}`))
    }
  })

  it("demands the nightly leg's upload and the summary's merged download", () => {
    const summary = (nightly) =>
      nightly.jobs.summary.steps.find((s) => s.uses?.startsWith("actions/download-artifact@"))
    for (const [mutate, message] of [
      [
        ({ nightly }) => {
          nightly.jobs.mutation.steps = nightly.jobs.mutation.steps.filter(
            (s) => !s.uses?.startsWith("actions/upload-artifact@"),
          )
        },
        /job mutation must upload its report as mutation-report-\$\{\{ matrix\.slug \}\}/,
      ],
      [
        ({ nightly }) => (uploadNamed(nightly, "mutation-report-").with.name = "report"),
        /job mutation must upload its report as mutation-report-/,
      ],
      [
        ({ nightly }) => delete summary(nightly).with["merge-multiple"],
        /job summary must download mutation-report-\* with merge-multiple: true/,
      ],
      [
        ({ nightly }) => (summary(nightly).with.pattern = "mutation-*"),
        /no step downloads pattern mutation-report-\*/,
      ],
      [
        ({ nightly }) => {
          nightly.jobs.summary.steps = nightly.jobs.summary.steps.filter(
            (s) => s.run !== "pnpm fitness",
          )
        },
        /job summary downloads the reports but never runs pnpm fitness/,
      ],
    ]) {
      const errors = artifactErrors(mutate)
      assert.deepEqual(errors.length, 1, errors.join("\n"))
      assert.match(errors[0], message)
    }
  })

  it(`bounds the diff gate at ${MUTATION_TIMEOUT_CEILING} minutes`, () => {
    for (const timeout of [undefined, MUTATION_TIMEOUT_CEILING + 1, 360, "120"]) {
      const errors = artifactErrors(({ ci }) => {
        ci.jobs.mutation["timeout-minutes"] = timeout
      })
      assert.deepEqual(errors.length, 1, String(timeout))
      assert.match(
        errors[0],
        /job mutation needs timeout-minutes of at most 120: it runs the packages one after another/,
      )
    }
    for (const timeout of [60, MUTATION_TIMEOUT_CEILING]) {
      assert.deepEqual(
        artifactErrors(({ ci }) => (ci.jobs.mutation["timeout-minutes"] = timeout)),
        [],
      )
    }
  })
})

// ── stryker.config.json ─────────────────────────────────────────────────────

describe("checkStrykerIncremental", () => {
  const good = { incremental: true, incrementalFile: INCREMENTAL_FILE, mutate: ["src/**/*.ts"] }
  const errorsFor = (config) => checkStrykerIncremental([{ dir: "apps/cli", config }])

  it("accepts every real config and a config that writes the cached file", () => {
    const real = REAL_PACKAGES.filter(({ dir }) =>
      existsSync(path.join(ROOT, dir, "stryker.config.json")),
    ).map(({ dir }) => ({
      dir,
      config: JSON.parse(readFileSync(path.join(ROOT, dir, "stryker.config.json"), "utf8")),
    }))
    assert.ok(real.length > 0)
    assert.deepEqual(checkStrykerIncremental(real), [])
    assert.deepEqual(errorsFor(good), [])
  })

  it("rejects a config without incremental, or with it off", () => {
    for (const incremental of [undefined, false, "true"]) {
      const errors = errorsFor({ ...good, incremental })
      assert.deepEqual(errors.length, 1, String(incremental))
      assert.match(errors[0], /^apps\/cli\/stryker\.config\.json must set "incremental": true/)
    }
  })

  it("rejects an incremental file the nightly does not cache", () => {
    for (const incrementalFile of [undefined, "reports/mutation/incremental.json"]) {
      const errors = errorsFor({ ...good, incrementalFile })
      assert.deepEqual(errors.length, 1, String(incrementalFile))
      assert.match(
        errors[0],
        /must set "incrementalFile": "reports\/stryker-incremental\.json", the path the nightly caches/,
      )
    }
    assert.deepEqual(errorsFor({}).length, 2)
  })

  it("rejects a config that is no JSON object", () => {
    assert.deepEqual(errorsFor(undefined), ["apps/cli/stryker.config.json is no JSON object"])
  })
})

const nightlyErrors = (mutate) => {
  const doc = structuredClone(NIGHTLY)
  mutate(doc)
  return checkNightlyMutation(doc, GLOBS)
}

describe("checkNightlyMutation", () => {
  it("accepts the real workflow", () => {
    assert.deepEqual(checkNightlyMutation(NIGHTLY, GLOBS), [])
  })

  it("never runs on a pull request or a push", () => {
    for (const event of ["pull_request", "push"]) {
      const errors = nightlyErrors((doc) => (doc.on[event] = null))
      assert.deepEqual(errors.length, 1)
      assert.match(errors[0], new RegExp(`runs on ${event}`))
    }
    assert.ok(
      matches(
        nightlyErrors((doc) => delete doc.on.schedule),
        /schedule with a cron/,
      ),
    )
  })

  it("lists every package form", () => {
    const errors = nightlyErrors((doc) => {
      const list = doc.jobs.packages.steps.find((step) => step.id === "list")
      list.run = list.run.replace("apps/* ", "")
    })
    assert.deepEqual(errors.length, 1)
    assert.match(errors[0], /misses the package form apps\/\*/)
    assert.ok(
      matches(
        checkNightlyMutation(NIGHTLY, [...GLOBS, "packages/tools/*"]),
        /misses the package form packages\/tools\/\*/,
      ),
    )
  })

  it("keeps the legs independent and bounded", () => {
    const leg = (doc) => doc.jobs.mutation
    assert.ok(
      matches(
        nightlyErrors((doc) => (leg(doc).strategy["fail-fast"] = true)),
        /fail-fast: false/,
      ),
    )
    assert.ok(
      matches(
        nightlyErrors((doc) => delete leg(doc)["timeout-minutes"]),
        /timeout-minutes/,
      ),
    )
    assert.ok(matches(checkNightlyMutation(undefined, GLOBS), /is missing/))
  })

  const leg = (doc) => doc.jobs.mutation
  const strykerStep = (doc) => leg(doc).steps.find((step) => step.name === "Stryker")
  const keyStep = (doc) => leg(doc).steps.find((step) => step.id === "cache-key")
  const cacheStep = (doc, action) =>
    leg(doc).steps.find((step) => step.uses?.startsWith(`actions/cache/${action}@`))
  const forcedCron = (doc) =>
    /github\.event\.schedule == '([^']+)'/.exec(strykerStep(doc).env.FORCE)[1]

  it("forces a run every week, from a cron of the schedule", () => {
    assert.ok(NIGHTLY.on.schedule.some((entry) => entry.cron === forcedCron(NIGHTLY)))
    for (const [mutate, message] of [
      [(doc) => (strykerStep(doc).env.FORCE = "${{ inputs.force == true }}"), /needs FORCE: /],
      [
        (doc) => (doc.on.schedule = doc.on.schedule.filter((e) => e.cron !== forcedCron(doc))),
        /FORCE names the cron "[^"]+", which the schedule does not list/,
      ],
      [
        (doc) => {
          const cron = forcedCron(doc)
          const monthly = "0 2 1 * *"
          doc.on.schedule.find((entry) => entry.cron === cron).cron = monthly
          strykerStep(doc).env.FORCE = strykerStep(doc).env.FORCE.replace(cron, monthly)
        },
        /the forced cron "0 2 1 \* \*" must fire every week/,
      ],
      [
        (doc) => (strykerStep(doc).run = strykerStep(doc).run.replace(/^.*--force.*\n/m, "")),
        /the Stryker step must pass --force when FORCE is true/,
      ],
    ]) {
      const errors = nightlyErrors(mutate)
      assert.deepEqual(errors.length, 1, errors.join("\n"))
      assert.match(errors[0], message)
    }
  })

  it("caches the pinned incremental file under the fingerprinted key", () => {
    const bare = "stryker-incremental-${{ matrix.slug }}-"
    for (const [mutate, message] of [
      [
        (doc) => (cacheStep(doc, "restore").with["restore-keys"] = bare),
        /restore needs restore-keys: /,
      ],
      [
        (doc) => (cacheStep(doc, "restore").with.key = `${bare}\${{ github.run_id }}`),
        /restore needs key: /,
      ],
      [(doc) => (cacheStep(doc, "save").with.key = `${bare}x`), /save needs key: /],
      [
        (doc) =>
          (cacheStep(doc, "save").with.path =
            "${{ matrix.dir }}/reports/mutation/incremental.json"),
        /actions\/cache\/save must cache path \$\{\{ matrix\.dir \}\}\/reports\/stryker-incremental\.json/,
      ],
      [
        (doc) => (leg(doc).steps = leg(doc).steps.filter((s) => s !== cacheStep(doc, "save"))),
        /exactly one actions\/cache\/save step, found 0/,
      ],
      [
        (doc) =>
          (keyStep(doc).env.FINGERPRINT = keyStep(doc).env.FINGERPRINT.replace(
            "'pnpm-lock.yaml', ",
            "",
          )),
        /FINGERPRINT misses 'pnpm-lock\.yaml'/,
      ],
      [
        (doc) =>
          (keyStep(doc).env.FINGERPRINT = keyStep(doc).env.FINGERPRINT.replace(
            "format('{0}/vitest*.ts', matrix.dir), ",
            "",
          )),
        /FINGERPRINT misses format\('\{0\}\/vitest\*\.ts', matrix\.dir\)/,
      ],
      [(doc) => (keyStep(doc).env.SLUG = "${{ matrix.dir }}"), /needs SLUG: /],
      [
        (doc) => (keyStep(doc).run = keyStep(doc).run.replace("-node${node_major}", "")),
        /the cache-key step must run echo "prefix=stryker-incremental-\$\{SLUG\}-node\$\{node_major\}/,
      ],
    ]) {
      const errors = nightlyErrors(mutate)
      assert.deepEqual(errors.length, 1, errors.join("\n"))
      assert.match(errors[0], message)
    }
    assert.ok(
      matches(
        nightlyErrors((doc) => (keyStep(doc).env.FINGERPRINT = "${{ github.sha }}")),
        /needs FINGERPRINT: \$\{\{ hashFiles\(\.\.\.\) \}\}/,
      ),
    )
    assert.ok(
      matches(
        nightlyErrors((doc) => delete keyStep(doc).id),
        /needs the step id cache-key/,
      ),
    )
  })
})

describe("the nightly steps", () => {
  const listScript = NIGHTLY.jobs.packages.steps.find((step) => step.id === "list").run
  const list = (dirs) => {
    const repo = tempDir("gh-config-nightly-")
    for (const [dir, stryker] of Object.entries(dirs)) {
      writeFile(repo, `${dir}/package.json`, "{}")
      if (stryker) writeFile(repo, `${dir}/stryker.config.json`, "{}")
    }
    const output = path.join(repo, "github-output")
    writeFileSync(output, "")
    const result = runStep(listScript, { cwd: repo, env: { GITHUB_OUTPUT: output } })
    assert.equal(result.status, 0, result.stdout + result.stderr)
    const line = readFileSync(output, "utf8").trim()
    assert.match(line, /^packages=/)
    return JSON.parse(line.slice("packages=".length))
  }

  it("lists every package form that carries a stryker.config.json", () => {
    assert.deepEqual(
      list({
        "apps/cli": true,
        "apps/vscode": true,
        "apps/plain": false,
        "packages/core/widget-shell": true,
        "packages/connectors/camunda/camunda7-domain": true,
        docs: true,
      }),
      [
        { dir: "apps/cli", slug: "apps-cli" },
        { dir: "apps/vscode", slug: "apps-vscode" },
        { dir: "packages/core/widget-shell", slug: "packages-core-widget-shell" },
        {
          dir: "packages/connectors/camunda/camunda7-domain",
          slug: "packages-connectors-camunda-camunda7-domain",
        },
      ],
    )
  })

  it("lists nothing in a tree without Stryker", () => {
    assert.deepEqual(list({ "apps/plain": false }), [])
  })

  it("builds the cache key prefix from the slug, the Node major and the fingerprint", () => {
    const script = NIGHTLY.jobs.mutation.steps.find((step) => step.id === "cache-key").run
    const dir = tempDir("gh-config-cache-key-")
    // The node the test runs on first, so the expected major is the one the step reads.
    const env = { PATH: `${path.dirname(process.execPath)}:${process.env.PATH}` }
    const output = path.join(dir, "github-output")
    writeFileSync(output, "")
    const result = runStep(script, {
      cwd: dir,
      env: { ...env, SLUG: "apps-cli", FINGERPRINT: "f1ng3r", GITHUB_OUTPUT: output },
    })
    assert.equal(result.status, 0, result.stdout + result.stderr)
    const major = process.versions.node.split(".")[0]
    assert.equal(
      readFileSync(output, "utf8").trim(),
      `prefix=stryker-incremental-apps-cli-node${major}-f1ng3r-`,
    )
    writeFileSync(output, "")
    const empty = runStep(script, {
      cwd: dir,
      env: { ...env, SLUG: "apps-cli", FINGERPRINT: "", GITHUB_OUTPUT: output },
    })
    assert.equal(empty.status, 1)
    assert.match(empty.stdout, /cache fingerprint is empty/)
    assert.equal(readFileSync(output, "utf8"), "")
  })

  it("passes --force to Stryker only when dispatched with force", () => {
    const strykerScript = NIGHTLY.jobs.mutation.steps.find((step) => step.name === "Stryker").run
    for (const [FORCE, expected] of [
      ["true", "run test:mutation --force"],
      ["false", "run test:mutation"],
    ]) {
      const dir = tempDir("gh-config-stryker-")
      writeFile(dir, "bin/pnpm", '#!/bin/bash\necho "$*" > "$STUB/args"\n', 0o755)
      const result = runStep(strykerScript, {
        cwd: dir,
        env: { PATH: `${dir}/bin:${process.env.PATH}`, STUB: dir, DIR: "apps/cli", FORCE },
      })
      assert.equal(result.status, 0, result.stdout + result.stderr)
      assert.equal(
        readFileSync(path.join(dir, "args"), "utf8").trim(),
        `--fail-if-no-match --filter ./apps/cli ${expected}`,
      )
    }
  })
})
