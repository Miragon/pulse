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
  BEFORE_THE_GATE,
  CI_WORKFLOW,
  CLI_PUBLISH_TRIGGERS,
  CLI_PUBLISH_WORKFLOWS,
  PUBLISHABLE_DIR,
  PUBLISH_WORKFLOW,
  RELEASE_WORKFLOW,
  VSCODE_APP_DIR,
  VSCODE_ENVIRONMENT,
  VSCODE_PUBLISH_WORKFLOW,
  actionRefs,
  checkCiScopes,
  checkCliPublishWorkflows,
  checkPluginVersions,
  checkPublishMatrix,
  checkPublishWorkflow,
  checkReleaseExtraFiles,
  checkReleaseGate,
  checkRepo,
  checkVscodePublish,
  expectedRepository,
  isNpmPublished,
  packageManagerRun,
  pluginManifests,
  readWorkspace,
} from "./check-github-config.mjs"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const readDoc = (file) => parse(readFileSync(path.join(ROOT, file), "utf8"))

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
/** Packages that do not exist yet: a public CLI, a VS Code extension, a new public package. */
const CLI = published("apps/cli", {
  name: "@miragon/pulse-cli",
  bin: { "pulse-cli": "dist/cli.js" },
})
const VSCODE = { "apps/vscode": { name: "pulse", engines: { vscode: "^1.101.0" } } }
const NEW_CLIENT = published("packages/connectors/flowable/flowable-client", {
  name: "@miragon/pulse-flowable-client",
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
    assert.equal(isNpmPublished({ name: "pulse", engines: { vscode: "^1.101.0" } }), false)
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
    ...NEW_CLIENT,
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
    ["packages/connectors/flowable/flowable-client", "npm-miragon-pulse-flowable-client"],
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

  it("demands a new public package and a public CLI", () => {
    const client = matrixErrors(workspace({ ...TODAY, ...NEW_CLIENT }))
    assert.equal(client.length, 1)
    assert.match(
      client[0],
      /packages\/connectors\/flowable\/flowable-client \(@miragon\/pulse-flowable-client\) is published to npm .* add it to the publish-npm matrix/,
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
    assert.match(listed[0], /apps\/vscode \(pulse\) declares engines\.vscode: .*vsce\/ovsx/)
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
      [NEW_CLIENT, "packages/connectors/flowable/flowable-client"],
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
      workspace({ ...TODAY, ...NEW_CLIENT, ...CLI, ...VSCODE }),
    )
    assert.deepEqual(
      errors.map((error) => /: (\S+\/package\.json) /.exec(error)?.[1]),
      [
        "apps/cli/package.json",
        "apps/vscode/package.json",
        "packages/connectors/flowable/flowable-client/package.json",
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
      "secrets: inherit",
      ({ caller }) => (caller.secrets = "inherit"),
      [/must pass exactly the secrets .* never secrets: inherit/],
    ],
    [
      "a store token missing",
      ({ caller }) => delete caller.secrets.OVSX_PUBLISH,
      [/must pass exactly the secrets/],
    ],
    [
      "a store token renamed",
      ({ caller }) => (caller.secrets.VSCE_PUBLISH = "${{ secrets.VSCE_PAT }}"),
      [/must pass exactly the secrets/],
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
      "no store token declared",
      ({ publish }) => delete publish.on.workflow_call.secrets.OVSX_PUBLISH,
      [/must declare exactly the secrets VSCE_PUBLISH and OVSX_PUBLISH/],
    ],
    [
      "top-level permissions",
      ({ publish }) => (publish.permissions = { contents: "read" }),
      [/top-level permissions must be \{\}/],
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
        const step = stepNamed(jobs.package, "Package")
        step.run = step.run.replace('"${NAME}"', '"${{ inputs.directory }}"')
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
      "no Open VSX publish",
      ({ jobs }) =>
        (jobs.publish.steps = jobs.publish.steps.filter(
          (step) => step.name !== "Publish to Open VSX",
        )),
      [/must run open-vsx:publish in exactly one step, found 0/],
    ],
    [
      "a publish job that runs on a dry run",
      ({ jobs }) => delete jobs.publish.if,
      [/must skip itself on a dry run/],
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

  it("pins the directories the Resolve step accepts", () => {
    const script = stepNamed(VSCODE_PUBLISH.jobs.package, "pkg").run
    assert.ok(script.includes(VSCODE_APP_DIR.source.replaceAll("\\/", "/")))
  })
})

// ── CI scopes ───────────────────────────────────────────────────────────────

const scopeErrors = (mutate) => {
  const doc = structuredClone(readDoc(CI_WORKFLOW))
  mutate(doc)
  return checkCiScopes(doc)
}

describe("checkCiScopes", () => {
  it("passes the real ci.yml", () => {
    assert.deepEqual(checkCiScopes(readDoc(CI_WORKFLOW)), [])
  })

  it("rejects a job that does not wait for the changes job", () => {
    const errors = scopeErrors((doc) => delete doc.jobs.kotlin.needs)
    assert.ok(matches(errors, /job kotlin does not wait for the changes job/))
  })

  it("rejects a job that reads a scope through another job: needs holds its own needs only", () => {
    const errors = scopeErrors((doc) => (doc.jobs.kotlin.needs = ["template"]))
    assert.ok(matches(errors, /job kotlin reads a scope but does not list changes in its needs/))
    assert.ok(!matches(errors, /job kotlin does not wait/))
  })

  it("rejects a scope the changes job does not hand out, and an unknown output", () => {
    const errors = scopeErrors((doc) => {
      delete doc.jobs.changes.outputs.kotlin
      doc.jobs.changes.outputs.extra = "${{ steps.scopes.outputs.extra }}"
    })
    assert.ok(matches(errors, /does not hand out the scope "kotlin"/))
    assert.ok(matches(errors, /hands out "extra", which scripts\/ci-scopes\.mjs does not compute/))
  })

  it("rejects a job that reads an unknown scope, and a scope no job reads", () => {
    const errors = scopeErrors(
      (doc) => (doc.jobs.kotlin.if = "needs.changes.outputs.gradle == 'true'"),
    )
    assert.ok(matches(errors, /job kotlin reads the unknown scope "gradle"/))
    assert.ok(matches(errors, /no job runs in the scope "kotlin"/))
  })

  it("rejects a workflow whose required jobs all skip when the changes job fails", () => {
    for (const mutate of [
      (doc) => (doc.jobs.quality.if = "needs.changes.outputs.typescript == 'true'"),
      (doc) => doc.jobs.quality.steps.shift(),
    ]) {
      assert.ok(matches(scopeErrors(mutate), /a failed changes job would pass/))
    }
  })

  it("rejects a ci.yml without a changes job", () => {
    assert.ok(
      matches(
        scopeErrors((doc) => delete doc.jobs.changes),
        /no changes job/,
      ),
    )
  })
})

// ── release-please.yml: the release gate ────────────────────────────────────

describe("checkReleaseGate", () => {
  const release = () => readDoc(RELEASE_WORKFLOW)

  it("accepts the real release workflow", () => {
    assert.deepEqual(checkReleaseGate(release()), [])
  })

  it("rejects a publish job that skips the approval, directly or through another job", () => {
    const doc = release()
    doc.jobs["publish-cli"].needs = ["release-please"]
    const errors = checkReleaseGate(doc)
    assert.equal(errors.length, 2)
    assert.match(errors[0], /job publish-cli never waits for gate/)
    assert.match(errors[1], /job publish-homebrew never waits for gate/)
  })

  it("rejects a status check function in the if of a job past the approval", () => {
    const doc = release()
    doc.jobs["publish-cli"].if = "${{ always() }}"
    doc.jobs["publish-npm"].if = "${{ !cancelled() && inputs.dry_run == true }}"
    doc.jobs["publish-maven"].if = "${{ success() || true }}"
    doc.jobs["publish-docker"].if = "failure ()"
    doc.jobs["sync-template-mirror"].if = "${{ cancelled() }}"
    const errors = checkReleaseGate(doc)
    assert.equal(errors.length, 5)
    assert.match(errors[0], /job publish-maven's if uses the status check function success\(\)/)
    assert.match(errors[1], /job publish-docker's if uses the status check function failure \(\)/)
    assert.match(errors[2], /job publish-npm's if uses the status check function cancelled\(\)/)
    assert.match(errors[3], /job publish-cli's if uses the status check function always\(\)/)
    assert.match(errors[4], /job sync-template-mirror's .* cancelled\(\): it would run after/)
    // the gate's own condition and an output named like a function stay allowed
    const quiet = release()
    quiet.jobs.gate.if = "${{ always() }}"
    quiet.jobs["publish-homebrew"].if = "${{ needs.release-please.outputs.successful == 'true' }}"
    assert.deepEqual(checkReleaseGate(quiet), [])
  })

  it("rejects a gate outside the release environment", () => {
    const doc = release()
    delete doc.jobs.gate.environment
    assert.match(checkReleaseGate(doc)[0], /job gate must run in the environment release/)
  })

  it("survives a cycle and an unknown need", () => {
    const doc = {
      jobs: { gate: { environment: "release" }, a: { needs: ["b"] }, b: { needs: ["a", "nope"] } },
    }
    assert.equal(checkReleaseGate(doc).length, 2)
    assert.deepEqual(BEFORE_THE_GATE, ["release-please", "gate"])
  })
})

// ── publish-cli.yml + publish-homebrew.yml ──────────────────────────────────

describe("checkCliPublishWorkflows", () => {
  const workflows = () =>
    new Map([RELEASE_WORKFLOW, ...CLI_PUBLISH_WORKFLOWS].map((file) => [file, readDoc(file)]))

  it("accepts the real workflows", () => {
    assert.deepEqual(checkCliPublishWorkflows(workflows()), [])
  })

  it("rejects a package manager next to a write grant, not in a contents: read job", () => {
    const docs = workflows()
    const cli = docs.get(CLI_PUBLISH_WORKFLOWS[0])
    cli.jobs.image.steps.splice(1, 0, { run: "pnpm install --frozen-lockfile" })
    cli.jobs.assets.steps.push({ run: "npx some-tool" })
    const errors = checkCliPublishWorkflows(docs)
    assert.equal(errors.length, 2)
    assert.match(errors[0], /job assets holds .* and runs "npx"/)
    assert.match(errors[1], /job image holds .* and runs "pnpm"/)
  })

  it("rejects a package manager next to an App token, a secret or a minted token", () => {
    const docs = workflows()
    const brew = docs.get(CLI_PUBLISH_WORKFLOWS[1])
    brew.jobs.publish.steps.splice(2, 0, { run: "npx some-tool" })
    brew.jobs.formula.steps.push({
      env: { NPM_TOKEN: "${{ secrets.NPM_TOKEN }}" },
      run: "npm ci",
    })
    brew.jobs.verify.steps.push({
      env: { GH_TOKEN: "${{ needs.formula.outputs.tap-token }}" },
      run: "yarn install",
    })
    const errors = checkCliPublishWorkflows(docs)
    assert.equal(errors.length, 3)
    assert.match(errors[0], /job formula holds a secret and runs "npm ci"/)
    assert.match(errors[1], /job verify holds a minted token and runs "yarn"/)
    assert.match(errors[2], /job publish holds an App token and runs "npx"/)
  })

  it("lets a contents: read job with only its own GITHUB_TOKEN run a package manager", () => {
    const docs = workflows()
    const cli = docs.get(CLI_PUBLISH_WORKFLOWS[0])
    cli.jobs.bundle.steps.push({
      env: { GH_TOKEN: "${{ secrets.GITHUB_TOKEN }}" },
      run: "pnpm --version",
    })
    assert.deepEqual(checkCliPublishWorkflows(docs), [])
  })

  it("rejects string permissions, top-level grants, caches, persisted credentials and expressions in run", () => {
    const docs = workflows()
    const brew = docs.get(CLI_PUBLISH_WORKFLOWS[1])
    brew.permissions = { contents: "read" }
    brew.jobs.publish.permissions = "write-all"
    brew.jobs.formula.steps[0].with = {}
    brew.jobs.verify.steps.push({ uses: "actions/cache@v6.1.0", with: { path: "x", key: "y" } })
    brew.jobs.verify.steps.push({ run: 'echo "${{ inputs.version }}"' })
    const errors = checkCliPublishWorkflows(docs)
    assert.equal(errors.length, 5)
    assert.match(errors[0], /top-level permissions must be \{\}/)
  })

  it("demands that the release calls each one and that it runs on its own triggers only", () => {
    const docs = workflows()
    delete docs.get(RELEASE_WORKFLOW).jobs["publish-homebrew"]
    docs.get(CLI_PUBLISH_WORKFLOWS[0]).on.workflow_dispatch = {}
    docs.get(CLI_PUBLISH_WORKFLOWS[1]).on.push = { branches: ["main"] }
    const errors = checkCliPublishWorkflows(docs)
    assert.equal(errors.length, 3)
    assert.match(
      errors[0],
      /publish-cli\.yml: runs on workflow_dispatch; it runs on workflow_call only/,
    )
    assert.match(errors[1], /no job calls \.\/\.github\/workflows\/publish-homebrew\.yml/)
    assert.match(errors[2], /publish-homebrew\.yml: runs on push; it runs on workflow_call and/)
    assert.deepEqual(Object.keys(CLI_PUBLISH_TRIGGERS), CLI_PUBLISH_WORKFLOWS)
  })

  it("names a missing workflow, and a release that calls nothing", () => {
    const docs = workflows()
    docs.delete(CLI_PUBLISH_WORKFLOWS[1])
    assert.match(checkCliPublishWorkflows(docs)[0], /publish-homebrew\.yml is missing/)
    docs.delete(RELEASE_WORKFLOW)
    assert.match(
      checkCliPublishWorkflows(docs)[0],
      /no job calls \.\/\.github\/workflows\/publish-cli\.yml/,
    )
  })
})

describe("checkPluginVersions", () => {
  const config = () =>
    JSON.parse(readFileSync(path.join(ROOT, "release-please-config.json"), "utf8"))

  it("accepts the real config and finds every app's plugin manifest", () => {
    const manifests = pluginManifests(ROOT, readWorkspace(ROOT))
    assert.deepEqual(checkPluginVersions(config(), manifests), [])
  })

  it("demands a plugin manifest an app ships", () => {
    const root = tempDir("plugin-manifests-")
    writeFile(root, "apps/cli/skills/pulse-cli/.claude-plugin/plugin.json", '{"version":"0.0.0"}\n')
    writeFile(root, "apps/cli/skills/notes.md", "no plugin\n")
    writeFile(root, "packages/core/x/skills/y/.claude-plugin/plugin.json", "{}\n")
    const manifests = pluginManifests(root, [{ dir: "apps/cli" }, { dir: "packages/core/x" }])
    assert.deepEqual(manifests, ["apps/cli/skills/pulse-cli/.claude-plugin/plugin.json"])
    assert.match(
      checkPluginVersions({ packages: { ".": { "extra-files": [] } } }, manifests)[0],
      /plugin\.json is missing from extra-files/,
    )
  })
})
