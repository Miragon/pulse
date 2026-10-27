import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"
import { describe, it } from "node:test"
import { fileURLToPath } from "node:url"
import { expandWorkspaceGlobs, workspaceGlobs } from "./check-package-scripts.mjs"
import { PATH_RULES, SCOPES, mergeCommitFiles, scopesFor, withDependents } from "./ci-scopes.mjs"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

const pkg = (dir, name, dependencies = {}) => ({ dir, manifest: { name, dependencies } })

const PACKAGES = [
  pkg("packages/core/widget-shell", "@miragon/pulse-widget-shell"),
  pkg("packages/connectors/camunda/camunda7-client", "@miragon/pulse-camunda7-client"),
  pkg("packages/connectors/camunda/camunda7-connector", "@miragon/pulse-camunda7-connector", {
    "@miragon/pulse-camunda7-client": "workspace:*",
    "@miragon/pulse-widget-shell": "workspace:*",
  }),
  pkg("packages/connectors/analytics/analytics-client", "@miragon/pulse-analytics-client"),
  pkg("apps/mcp-server-camunda7", "@miragon/pulse-mcp-server-camunda7", {
    "@miragon/pulse-camunda7-connector": "workspace:*",
  }),
  pkg("apps/cli", "@miragon/pulse-cli"),
  pkg("apps/vscode", "pulse-cockpit"),
  pkg("docs", "@miragon/pulse-docs"),
]

const scopes = (...files) => [...scopesFor(files, PACKAGES)].sort()
const every = [...SCOPES].sort()

describe("scopesFor: prose reaches only the checks that read it", () => {
  it("runs only the .vsix dry run for the extension's Marketplace listing (PR 482)", () => {
    assert.deepEqual(scopes("apps/vscode/MARKETPLACE.md"), ["vscode-package"])
  })

  it("runs nothing beyond the always-on checks for a package README or a root Markdown file", () => {
    assert.deepEqual(scopes("packages/core/widget-shell/README.md", "CLAUDE.md", "TODOS.md"), [])
  })

  it("brand-lints the root README and the docs site", () => {
    assert.deepEqual(scopes("README.md", "docs/mcp/usage.md", "docs/public/logo/mark.png"), [
      "brand",
    ])
  })

  it("treats prose inside a package's code as code (a glossary its test reads)", () => {
    assert.deepEqual(
      scopes("packages/connectors/camunda/camunda7-connector/src/messages/GLOSSARY.md"),
      ["mcp", "template", "typescript"],
    )
  })

  it("treats the CLI's prose as code: its tests read its README and its skills", () => {
    assert.deepEqual(scopes("apps/cli/README.md"), ["brand", "cli", "typescript"])
    assert.deepEqual(scopes("apps/cli/skills/pulse-cli/SKILL.md"), ["cli", "typescript"])
  })

  it("runs the CLI's tests for its pages of the docs site", () => {
    assert.deepEqual(scopes("docs/cli/commands.md"), ["brand", "typescript"])
  })

  it("runs the token drift test for the vendored docs kit, not for the rest of the site's config", () => {
    assert.deepEqual(scopes("docs/.vitepress/miragon/cd-tokens.generated.css"), [
      "brand",
      "typescript",
    ])
    assert.deepEqual(scopes("docs/.vitepress/theme/HomeLanding.vue"), ["brand"])
  })
})

describe("scopesFor: a package's code reaches its dependents", () => {
  it("runs the MCP server's checks and the template for a client, through its connector", () => {
    assert.deepEqual(scopes("packages/connectors/camunda/camunda7-client/src/index.ts"), [
      "mcp",
      "template",
      "typescript",
    ])
  })

  it("runs only the CLI's checks for the CLI", () => {
    assert.deepEqual(scopes("apps/cli/src/workflow/deploy.ts"), ["cli", "typescript"])
  })

  it("runs the extension's checks for the extension", () => {
    assert.deepEqual(scopes("apps/vscode/src/core/index.ts"), [
      "typescript",
      "vscode",
      "vscode-package",
    ])
  })

  it("adds Kotlin for the metrics contract, which the engine plugin's test reads", () => {
    assert.deepEqual(
      scopes("packages/connectors/analytics/analytics-client/metrics-contract.json"),
      ["kotlin", "mcp", "template", "typescript"],
    )
  })
})

describe("scopesFor: paths outside the packages", () => {
  it("runs one Gradle build for each Gradle project", () => {
    assert.deepEqual(scopes("engine-plugins/gradle/libs.versions.toml"), ["kotlin"])
    assert.deepEqual(scopes("playground/cibseven-example/build.gradle.kts"), ["cibseven-example"])
  })

  it("runs the TypeScript job for the files the metrics contract and setup-env tests read", () => {
    assert.deepEqual(scopes("playground/docker/prometheus/alerts.yml"), ["typescript"])
    assert.deepEqual(scopes(".env.example"), ["typescript"])
  })

  it("runs the template and the TypeScript job for the template's code", () => {
    assert.deepEqual(scopes("templates/composed-server/server/src/ui/brand.css"), [
      "template",
      "typescript",
    ])
  })

  it("runs the TypeScript job for a workflow no pull request runs, so lint:github checks it", () => {
    assert.deepEqual(scopes(".github/workflows/publish-cli.yml", ".github/dependabot.yml"), [
      "typescript",
    ])
  })
})

describe("scopesFor fails closed", () => {
  for (const file of [
    "pnpm-lock.yaml",
    "package.json",
    "turbo.json",
    "vitest.shared.ts",
    "eslint.config.mjs",
    ".github/workflows/ci.yml",
    "scripts/check-ratchets.mjs",
    "some-new-root-file.json",
    "new-dir/anything.ts",
  ]) {
    it(`runs every scope for ${file}`, () => {
      assert.deepEqual(scopes("apps/vscode/MARKETPLACE.md", file), every)
    })
  }
})

describe("withDependents", () => {
  it("adds every package that depends on a changed one, transitively", () => {
    assert.deepEqual([...withDependents(["packages/core/widget-shell"], PACKAGES)].sort(), [
      "apps/mcp-server-camunda7",
      "packages/connectors/camunda/camunda7-connector",
      "packages/core/widget-shell",
    ])
  })

  it("reads every dependency stanza", () => {
    const packages = [
      pkg("packages/core/a", "a"),
      { dir: "packages/core/b", manifest: { name: "b", devDependencies: { a: "workspace:*" } } },
    ]
    assert.deepEqual([...withDependents(["packages/core/a"], packages)].sort(), [
      "packages/core/a",
      "packages/core/b",
    ])
  })
})

describe("mergeCommitFiles", () => {
  it("lists what the merge commit changes against its base", () => {
    const calls = []
    const git = (args) => {
      calls.push(args.join(" "))
      return args[0] === "diff" ? "apps/vscode/MARKETPLACE.md\n\n" : "abc\n"
    }
    assert.deepEqual(mergeCommitFiles(git), ["apps/vscode/MARKETPLACE.md"])
    assert.deepEqual(calls, ["rev-parse --verify --quiet HEAD^2", "diff --name-only HEAD^1 HEAD"])
  })

  it("reads nothing without a merge commit, so the caller runs every scope", () => {
    const git = () => {
      throw new Error("no HEAD^2")
    }
    assert.equal(mergeCommitFiles(git), undefined)
  })
})

describe("the real workspace", () => {
  const dirs = expandWorkspaceGlobs(
    repoRoot,
    workspaceGlobs(readFileSync(path.join(repoRoot, "pnpm-workspace.yaml"), "utf8")),
  )
  const packages = dirs.map((dir) => ({
    dir,
    manifest: JSON.parse(readFileSync(path.join(repoRoot, dir, "package.json"), "utf8")),
  }))

  it("leaves every package but the docs site to the package rules", () => {
    const shadowed = dirs.filter(
      (dir) =>
        dir !== "docs" && PATH_RULES.some(({ pattern }) => pattern.test(`${dir}/src/index.ts`)),
    )
    assert.deepEqual(shadowed, [])
  })

  it("runs the TypeScript job for the code of every package but the docs site", () => {
    const without = dirs.filter(
      (dir) => dir !== "docs" && !scopesFor([`${dir}/src/index.ts`], packages).has("typescript"),
    )
    assert.deepEqual(without, [])
  })

  it("keeps the CLI and the extension apart from the MCP server's packages", () => {
    assert.deepEqual([...scopesFor(["packages/core/widget-shell/src/index.ts"], packages)].sort(), [
      "mcp",
      "template",
      "typescript",
    ])
  })
})
