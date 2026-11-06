import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"
import { describe, it } from "node:test"
import { fileURLToPath } from "node:url"
import { DEFAULT_PROJECT_FILES } from "../eslint.config.mjs"
import { expandWorkspaceGlobs, workspaceGlobs } from "./check-package-scripts.mjs"
import { PATH_RULES, SCOPES, mergeCommitFiles, scopesFor, withDependents } from "./ci-scopes.mjs"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

const pkg = (dir, name, dependencies = {}) => ({ dir, manifest: { name, dependencies } })

const PACKAGES = [
  pkg("packages/core/ui", "@miragon/pulse-ui"),
  pkg("packages/connectors/engine/engine-core", "@miragon/pulse-engine-core"),
  pkg("packages/core/widget-shell", "@miragon/pulse-widget-shell", {
    "@miragon/pulse-ui": "workspace:*",
  }),
  pkg("packages/connectors/engine/engine-client", "@miragon/pulse-engine-client"),
  pkg("packages/connectors/engine/engine-connector", "@miragon/pulse-engine-connector", {
    "@miragon/pulse-engine-client": "workspace:*",
    "@miragon/pulse-engine-core": "workspace:*",
    "@miragon/pulse-widget-shell": "workspace:*",
  }),
  pkg("packages/connectors/analytics/analytics-client", "@miragon/pulse-analytics-client"),
  pkg("apps/mcp-server", "@miragon/pulse-mcp-server", {
    "@miragon/pulse-engine-connector": "workspace:*",
  }),
  // The CLI bundles engine-core: a devDependency reaches it too.
  {
    dir: "apps/cli",
    manifest: {
      name: "@miragon/pulse-cli",
      devDependencies: { "@miragon/pulse-engine-core": "workspace:*" },
    },
  },
  // The extension's C7 adapter bundles engine-core.
  pkg("apps/vscode", "pulse-cockpit", { "@miragon/pulse-engine-core": "workspace:*" }),
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
      scopes("packages/connectors/engine/engine-connector/src/messages/GLOSSARY.md"),
      ["mcp", "template", "typescript"],
    )
  })

  it("treats the CLI's prose as code: its tests read its README and its skills", () => {
    assert.deepEqual(scopes("apps/cli/README.md"), ["brand", "cli", "typescript"])
    assert.deepEqual(scopes("apps/cli/skills/pulse-cli/SKILL.md"), ["cli", "typescript"])
  })

  it("runs the CLI's tests and builds for its pages of the docs site", () => {
    assert.deepEqual(scopes("docs/cli/commands.md"), ["brand", "cli", "typescript"])
  })

  it("runs the token drift test for the vendored docs kit, not for the rest of the site's config", () => {
    assert.deepEqual(scopes("docs/.vitepress/miragon/cd-tokens.generated.css"), [
      "brand",
      "typescript",
    ])
    assert.deepEqual(scopes("docs/.vitepress/theme/HomeLanding.vue"), ["brand"])
  })

  it("runs the token drift scan for a stylesheet anywhere in the docs site", () => {
    assert.deepEqual(scopes("docs/.vitepress/theme/custom.css"), ["brand", "typescript"])
  })

  it("runs pnpm lint for every config file lint:configs lints, the docs site's too", () => {
    for (const file of DEFAULT_PROJECT_FILES) {
      assert.ok(scopes(file).includes("typescript"), file)
    }
    assert.deepEqual(scopes("docs/.vitepress/config.ts"), ["brand", "typescript"])
  })
})

describe("scopesFor: a package's code reaches its dependents", () => {
  it("runs the MCP server's checks and the template for pulse-ui's stylesheet, through widget-shell", () => {
    assert.deepEqual(scopes("packages/core/ui/src/theme.css"), ["mcp", "template", "typescript"])
    assert.ok(withDependents(["packages/core/ui"], PACKAGES).has("packages/core/widget-shell"))
  })

  it("runs the MCP server's checks and the template for a client, through its connector", () => {
    assert.deepEqual(scopes("packages/connectors/engine/engine-client/src/index.ts"), [
      "mcp",
      "template",
      "typescript",
    ])
  })

  it("runs the CLI's, the extension's and the MCP server's checks and the template for engine-core, its three users", () => {
    assert.deepEqual(scopes("packages/connectors/engine/engine-core/src/inspect.ts"), [
      "cli",
      "mcp",
      "template",
      "typescript",
      "vscode",
      "vscode-package",
    ])
  })

  it("runs the MCP server's checks for the server app itself, not only through a package", () => {
    assert.deepEqual(scopes("apps/mcp-server/src/app.ts"), ["mcp", "typescript"])
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

  it("runs the TypeScript job for the files the metrics contract and server env-name tests read", () => {
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

  it("runs nothing beyond the always-on checks for the shared editor settings", () => {
    assert.deepEqual(scopes(".vscode/settings.json", ".vscode/extensions.json"), [])
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
      "apps/mcp-server",
      "packages/connectors/engine/engine-connector",
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

  it("runs the extension's checks for engine-core, which its C7 adapter bundles", () => {
    const changed = scopesFor(
      ["packages/connectors/engine/engine-core/src/root-cause.ts"],
      packages,
    )
    assert.ok(changed.has("vscode") && changed.has("vscode-package") && changed.has("cli"))
  })

  it("keeps the CLI and the extension apart from the MCP server's packages", () => {
    assert.deepEqual([...scopesFor(["packages/core/widget-shell/src/index.ts"], packages)].sort(), [
      "mcp",
      "template",
      "typescript",
    ])
  })
})
