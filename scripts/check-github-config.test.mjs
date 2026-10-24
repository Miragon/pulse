import assert from "node:assert/strict"
import { execFileSync, spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { after, describe, it } from "node:test"
import { fileURLToPath } from "node:url"
import { parse } from "yaml"
import {
  CI_WORKFLOW,
  NIGHTLY_WORKFLOW,
  PUBLISHABLE_DIR,
  PUBLISH_WORKFLOW,
  RELEASE_WORKFLOW,
  checkArtifactGlobs,
  checkDependabot,
  checkNightlyMutation,
  checkPublishMatrix,
  checkPublishWorkflow,
  checkReleaseExtraFiles,
  checkRepo,
  checkRequiredChecks,
  isNpmPublished,
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

/** Today's workspace, as manifests. */
const TODAY = {
  "apps/mcp-server-camunda7": { name: "@miragon/pulse-mcp-server-camunda7", private: true },
  "packages/core/widget-shell": { name: "@miragon/pulse-widget-shell" },
  "packages/connectors/camunda/camunda7-client": { name: "@miragon/pulse-camunda7-client" },
  "packages/connectors/camunda/camunda7-connector": { name: "@miragon/pulse-camunda7-connector" },
  "packages/connectors/analytics/analytics-client": { name: "@miragon/pulse-analytics-client" },
  "packages/connectors/analytics/analytics-connector": {
    name: "@miragon/pulse-analytics-connector",
  },
  docs: { name: "@miragon/pulse-docs", private: true },
}
/** Packages that do not exist yet: a public CLI, a VS Code extension, a public domain package. */
const CLI = { "apps/cli": { name: "@miragon/pulse-cli", bin: { "pulse-cli": "dist/cli.js" } } }
const VSCODE = { "apps/vscode": { name: "pulse-vscode", engines: { vscode: "^1.101.0" } } }
const DOMAIN = {
  "packages/connectors/camunda/camunda7-domain": { name: "@miragon/pulse-camunda7-domain" },
}

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
const publishErrors = (mutate) => {
  const doc = structuredClone(PUBLISH)
  mutate(doc)
  return checkPublishWorkflow(doc)
}
const stepNamed = (job, name) => job.steps.find((step) => step.name === name || step.id === name)

describe("checkPublishWorkflow", () => {
  it("accepts the real workflow", () => {
    assert.deepEqual(checkPublishWorkflow(PUBLISH), [])
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
        /exactly one job may hold id-token: write .* found 0/,
      ),
    )
    assert.ok(
      matches(
        publishErrors((doc) => (doc.jobs.pack.permissions["id-token"] = "write")),
        /exactly one job may hold id-token: write .* found 2/,
      ),
    )
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

  it("rejects a checkout, a package manager or an install in the token job, one each", () => {
    for (const step of [
      { uses: "actions/checkout@v7.0.1" },
      { uses: "pnpm/action-setup@v6.1.0" },
      { run: "pnpm install --frozen-lockfile" },
      { run: "npm ci" },
      { run: "npm install -g npm@11" },
      { run: "npx foo" },
    ]) {
      const errors = publishErrors((doc) => doc.jobs.publish.steps.unshift(step))
      assert.equal(errors.length, 1, JSON.stringify({ step, errors }))
    }
  })

  it("rejects a dependency cache in either job", () => {
    for (const job of ["pack", "publish"]) {
      const errors = publishErrors((doc) => {
        const setup = doc.jobs[job].steps.find((s) => s.uses.startsWith("actions/setup-node@"))
        setup.with.cache = "pnpm"
      })
      assert.ok(matches(errors, /sets cache/), job)
    }
    assert.ok(
      matches(
        publishErrors((doc) => {
          const setup = doc.jobs.pack.steps.find((s) => s.uses.startsWith("actions/setup-node@"))
          delete setup.with["package-manager-cache"]
        }),
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
const matrixErrors = (packages, mutate = () => {}) => {
  const doc = structuredClone(RELEASE)
  mutate(doc)
  return checkPublishMatrix(doc, packages)
}
const addToMatrix = (dir) => (doc) => doc.jobs["publish-npm"].strategy.matrix.directory.push(dir)

describe("checkPublishMatrix", () => {
  it("accepts the real release workflow and workspace", () => {
    assert.deepEqual(checkPublishMatrix(RELEASE, REAL_PACKAGES), [])
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

describe("checkReleaseExtraFiles", () => {
  const config = JSON.parse(readFileSync(path.join(ROOT, "release-please-config.json"), "utf8"))
  const exists = (rel) => existsSync(path.join(ROOT, rel))

  it("accepts the real config", () => {
    assert.deepEqual(checkReleaseExtraFiles(config, REAL_PACKAGES, { fileExists: exists }), [])
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
    const broken = structuredClone(config)
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

// ── dependabot.yml ──────────────────────────────────────────────────────────

const DEPENDABOT = readDoc(".github/dependabot.yml")
const dirExists = (rel) => existsSync(path.join(ROOT, rel))
const dependabotErrors = (mutate, options = {}) => {
  const doc = structuredClone(DEPENDABOT)
  mutate(doc)
  return checkDependabot(doc, { packages: REAL_PACKAGES, dirExists, ...options })
}
const npmEntry = (doc) => doc.updates.find((entry) => entry["package-ecosystem"] === "npm")

describe("checkDependabot", () => {
  it("accepts the real config", () => {
    assert.deepEqual(checkDependabot(DEPENDABOT, { packages: REAL_PACKAGES, dirExists }), [])
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
      dependabotErrors(addCliImage, { dirExists: (rel) => rel === "apps/cli" || dirExists(rel) }),
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
    const errors = dependabotErrors((doc) => delete npmEntry(doc).ignore, {
      packages: workspace(TODAY),
    })
    assert.deepEqual(errors, [])
  })

  it("passes entries whose only group is a catch-all", () => {
    const doc = {
      updates: DEPENDABOT.updates.filter((entry) => entry["package-ecosystem"] !== "npm"),
    }
    assert.deepEqual(checkDependabot(doc, { packages: REAL_PACKAGES, dirExists }), [])
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

  it("rejects a mutation download below the repo root", () => {
    const errors = artifactErrors(({ ci }) => {
      ci.jobs.fitness.steps.find((s) => s.with?.name === "mutation-reports").with.path = "packages"
    })
    assert.deepEqual(errors.length, 1)
    assert.match(errors[0], /downloads mutation-reports into packages/)
  })

  it("bounds the diff gate at 60 minutes", () => {
    assert.ok(
      matches(
        artifactErrors(({ ci }) => delete ci.jobs.mutation["timeout-minutes"]),
        /at most 60/,
      ),
    )
    assert.ok(
      matches(
        artifactErrors(({ ci }) => (ci.jobs.mutation["timeout-minutes"] = 360)),
        /at most 60/,
      ),
    )
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
