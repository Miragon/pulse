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
  pkg("packages/connectors/c7/c7-core", "@miragon/pulse-c7-core"),
  pkg("packages/core/widget-shell", "@miragon/pulse-widget-shell", {
    "@miragon/pulse-ui": "workspace:*",
  }),
  pkg("packages/connectors/c7/c7-client", "@miragon/pulse-c7-client"),
  pkg("packages/connectors/engine/engine-connector", "@miragon/pulse-engine-connector", {
    "@miragon/pulse-c7-client": "workspace:*",
    "@miragon/pulse-c7-core": "workspace:*",
    "@miragon/pulse-widget-shell": "workspace:*",
  }),
  pkg("apps/mcp-server", "@miragon/pulse-mcp-server", {
    "@miragon/pulse-engine-connector": "workspace:*",
  }),
  // The CLI bundles c7-core: a devDependency reaches it too.
  {
    dir: "apps/cli",
    manifest: {
      name: "@miragon/pulse-cli",
      devDependencies: { "@miragon/pulse-c7-core": "workspace:*" },
    },
  },
  // The editor hosts share the runtime view and bundle the C7 adapter, which runs c7-core.
  pkg("packages/core/runtime-view", "@miragon/pulse-runtime-view"),
  pkg("packages/connectors/c7/c7-adapter", "@miragon/pulse-c7-adapter", {
    "@miragon/pulse-c7-core": "workspace:*",
    "@miragon/pulse-runtime-view": "workspace:*",
  }),
  pkg("apps/vscode", "pulse-cockpit", {
    "@miragon/pulse-c7-adapter": "workspace:*",
    "@miragon/pulse-runtime-view": "workspace:*",
  }),
  pkg("apps/orca", "@miragon/pulse-orca", {
    "@miragon/pulse-c7-adapter": "workspace:*",
    "@miragon/pulse-runtime-view": "workspace:*",
  }),
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

  it("runs pulse-ui's token tests for the brand-assets list and its checksums, not for the shots", () => {
    assert.deepEqual(scopes(".miragon/brand-assets.yaml", ".miragon/brand-assets.sha256"), [
      "brand",
      "typescript",
    ])
    assert.deepEqual(scopes(".miragon/product-shots.yaml", ".miragon/brand.json"), ["brand"])
  })

  it("runs the token drift scan for a stylesheet anywhere in the docs site", () => {
    assert.deepEqual(scopes("docs/.vitepress/theme/custom.css"), ["brand", "typescript"])
  })

  it("runs the script guards for the developer page, whose command local-env.test.mjs reads", () => {
    assert.deepEqual(scopes("docs/mcp/developer.md"), ["brand", "typescript"])
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
    assert.deepEqual(scopes("packages/connectors/c7/c7-client/src/index.ts"), [
      "mcp",
      "template",
      "typescript",
    ])
  })

  it("runs the CLI's, the MCP server's and the template's checks for c7-core, and the editor hosts' through the C7 adapter", () => {
    assert.deepEqual(scopes("packages/connectors/c7/c7-core/src/inspect.ts"), [
      "cli",
      "mcp",
      "orca",
      "template",
      "typescript",
      "vscode",
      "vscode-package",
    ])
  })

  it("runs the editor hosts' checks for the runtime view and the C7 adapter, not the MCP server's or the template", () => {
    for (const file of [
      "packages/core/runtime-view/src/core/index.ts",
      "packages/connectors/c7/c7-adapter/src/index.ts",
    ]) {
      assert.deepEqual(scopes(file), ["orca", "typescript", "vscode", "vscode-package"], file)
    }
  })

  it("runs the checks of the spec's readers for c7-core's spec and route table, dependents or not", () => {
    const spec = "packages/connectors/c7/c7-core/spec/api.json"
    const routes = "packages/connectors/c7/c7-core/src/generated/routes.json"
    assert.deepEqual(scopes(spec), scopes("packages/connectors/c7/c7-core/src/inspect.ts"))
    const alone = [pkg("packages/connectors/c7/c7-core", "@miragon/pulse-c7-core")]
    for (const file of [spec, "packages/connectors/c7/c7-core/spec/patches.json", routes]) {
      assert.deepEqual([...scopesFor([file], alone)].sort(), [
        "cli",
        "mcp",
        "template",
        "typescript",
      ])
    }
    const core = "packages/connectors/c7/c7-core/src/generated/core-routes.json"
    assert.deepEqual([...scopesFor([core], alone)].sort(), ["mcp", "template", "typescript"])
  })

  it("runs the MCP server's checks for the server app itself, not only through a package", () => {
    assert.deepEqual(scopes("apps/mcp-server/src/app.ts"), ["mcp", "typescript"])
  })

  it("runs only the CLI's checks for the CLI", () => {
    assert.deepEqual(scopes("apps/cli/src/workflow/deploy.ts"), ["cli", "typescript"])
  })

  it("runs the extension's checks for the extension", () => {
    assert.deepEqual(scopes("apps/vscode/src/host/extension.ts"), [
      "typescript",
      "vscode",
      "vscode-package",
    ])
  })

  it("runs only the Orca plugin's checks for the Orca plugin", () => {
    assert.deepEqual(scopes("apps/orca/src/worker/main.ts"), ["orca", "typescript"])
  })
})

describe("scopesFor: paths outside the packages", () => {
  it("runs the one Gradle build for the playground engine, its version catalog included", () => {
    assert.deepEqual(scopes("playground/cibseven-example/gradle/libs.versions.toml"), [
      "cibseven-example",
    ])
    assert.deepEqual(scopes("playground/cibseven-example/build.gradle.kts"), ["cibseven-example"])
  })

  it("runs the TypeScript job for the files the playground and server env-name tests read", () => {
    assert.deepEqual(scopes("playground/docker/docker-compose.yml"), ["typescript"])
    assert.deepEqual(scopes(".env.example"), ["typescript"])
  })

  it("runs the template and the TypeScript job for the template's code", () => {
    assert.deepEqual(scopes("templates/composed-server/server/src/ui/brand.css"), [
      "template",
      "typescript",
    ])
  })

  it("runs the template's job for the fixture module, and test:host for the document it renders too", () => {
    assert.deepEqual(scopes("templates/fixtures/prebuilt-module/src/index.ts"), [
      "template",
      "typescript",
    ])
    assert.deepEqual(scopes("templates/fixtures/prebuilt-module/src/board.html"), [
      "mcp",
      "template",
      "typescript",
    ])
  })

  it("starts the starter's try-out engine for its compose.yaml, next to the template's checks", () => {
    assert.deepEqual(scopes("templates/composed-server/compose.yaml"), [
      "starter-engine",
      "template",
      "typescript",
    ])
  })

  it("starts no engine for the rest of the template, its README with the container recipe too", () => {
    assert.deepEqual(scopes("templates/composed-server/README.md"), [])
    assert.ok(!scopes("templates/composed-server/server/src/app.ts").includes("starter-engine"))
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

  it("runs the editor hosts' checks for c7-core, which they bundle with their C7 adapter", () => {
    const changed = scopesFor(["packages/connectors/c7/c7-core/src/cause.ts"], packages)
    for (const scope of ["cli", "orca", "vscode", "vscode-package"]) {
      assert.ok(changed.has(scope), scope)
    }
  })

  it("runs the editor hosts' checks for the transport, which their C7 adapter sends through", () => {
    const changed = scopesFor(["packages/core/http/src/http.ts"], packages)
    for (const scope of ["cli", "mcp", "orca", "template", "vscode", "vscode-package"]) {
      assert.ok(changed.has(scope), scope)
    }
  })

  it("keeps the MCP server and the template apart from what only the editor hosts bundle", () => {
    for (const file of [
      "packages/core/runtime-view/src/core/index.ts",
      "packages/connectors/c7/c7-adapter/src/index.ts",
    ]) {
      assert.deepEqual(
        [...scopesFor([file], packages)].sort(),
        ["orca", "typescript", "vscode", "vscode-package"],
        file,
      )
    }
  })

  it("runs the CLI's checks for engine-core, which c7-core imports", () => {
    const changed = scopesFor(
      ["packages/connectors/engine/engine-core/src/model/root-causes.ts"],
      packages,
    )
    for (const scope of ["cli", "orca", "vscode", "vscode-package", "mcp", "template"]) {
      assert.ok(changed.has(scope), scope)
    }
  })

  it("keeps the CLI and the extension apart from the MCP server's packages", () => {
    assert.deepEqual([...scopesFor(["packages/core/widget-shell/src/index.ts"], packages)].sort(), [
      "mcp",
      "template",
      "typescript",
    ])
  })
})
