import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { after, before, describe, it } from "node:test"
import { fileURLToPath } from "node:url"
import { ESLint } from "eslint"
import { DEFAULT_PROJECT_FILES } from "../eslint.config.mjs"
import { lintConfigs, unbuiltTypes, workspaceTypeImports } from "./lint-configs.mjs"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

/** Self-test of `pnpm lint:configs` on planted files, with a config of its own and no type info. */
describe("lintConfigs", () => {
  let root
  let eslint

  before(() => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "lint-configs-")))
    fs.writeFileSync(path.join(root, "clean.config.mjs"), "export default {}\n")
    fs.writeFileSync(path.join(root, "bad.config.mjs"), "var planted = 1\nexport default planted\n")
    fs.writeFileSync(path.join(root, "ignored.config.mjs"), "export default {}\n")
    eslint = new ESLint({
      cwd: root,
      overrideConfigFile: true,
      overrideConfig: [{ ignores: ["ignored.config.mjs"] }, { rules: { "no-var": "error" } }],
    })
  })

  after(() => {
    fs.rmSync(root, { recursive: true, force: true })
  })

  it("passes clean files", async () => {
    assert.equal((await lintConfigs(["clean.config.mjs"], eslint)).clean, true)
  })

  it("fails a planted error and reports it", async () => {
    const { clean, report } = await lintConfigs(["clean.config.mjs", "bad.config.mjs"], eslint)
    assert.equal(clean, false)
    assert.match(report, /bad\.config\.mjs[\s\S]*no-var/)
  })

  it("fails a listed file ESLint ignores, which it reports as a warning only", async () => {
    assert.equal((await lintConfigs(["ignored.config.mjs"], eslint)).clean, false)
  })

  it("fails an empty list: a gate over nothing stays green", async () => {
    const { clean, report } = await lintConfigs([], eslint)
    assert.equal(clean, false)
    assert.match(report, /no files to lint/)
  })

  it("throws on a listed file that is gone", async () => {
    await assert.rejects(lintConfigs(["gone.config.mjs"], eslint), /gone\.config\.mjs/)
  })
})

/** The build check before the lint: typed linting without built types fails as no-unsafe-*. */
describe("unbuiltTypes", () => {
  let root

  before(() => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "lint-configs-build-")))
    const write = (file, text) => {
      fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true })
      fs.writeFileSync(path.join(root, file), text)
    }
    write("pnpm-workspace.yaml", 'packages:\n  - "packages/*"\n')
    write(
      "packages/shell/package.json",
      JSON.stringify({
        name: "@miragon/pulse-shell",
        exports: { "./server": { types: "./dist/server.d.ts", import: "./dist/server.js" } },
      }),
    )
    write(
      "packages/leaf/package.json",
      JSON.stringify({ name: "@miragon/pulse-leaf", types: "./dist/index.d.ts" }),
    )
    write(
      "vite.config.ts",
      [
        'import { defineConfig } from "vite"',
        'import { DEDUPE } from "@miragon/pulse-shell/server"',
        'import type { Leaf } from "@miragon/pulse-leaf"',
        'import "./side-effect"',
        "",
      ].join("\n"),
    )
  })

  after(() => {
    fs.rmSync(root, { recursive: true, force: true })
  })

  it("finds each workspace import with the types its package exports, and nothing else", () => {
    assert.deepEqual(workspaceTypeImports(root, ["vite.config.ts"]), [
      {
        file: "vite.config.ts",
        specifier: "@miragon/pulse-shell/server",
        types: "packages/shell/dist/server.d.ts",
      },
      {
        file: "vite.config.ts",
        specifier: "@miragon/pulse-leaf",
        types: "packages/leaf/dist/index.d.ts",
      },
    ])
  })

  it("names every types file that is not built, and none once it is", () => {
    const imports = workspaceTypeImports(root, ["vite.config.ts"])
    assert.deepEqual(unbuiltTypes(root, imports), [
      "vite.config.ts imports @miragon/pulse-shell/server: packages/shell/dist/server.d.ts is not built",
      "vite.config.ts imports @miragon/pulse-leaf: packages/leaf/dist/index.d.ts is not built",
    ])
    for (const { types } of imports) {
      fs.mkdirSync(path.dirname(path.join(root, types)), { recursive: true })
      fs.writeFileSync(path.join(root, types), "export {}\n")
    }
    assert.deepEqual(unbuiltTypes(root, imports), [])
  })

  it("reaches the real tree's workspace import: the MCP server's vite config and widget-shell", () => {
    assert.ok(
      workspaceTypeImports(repoRoot, DEFAULT_PROJECT_FILES).some(
        ({ file, types }) =>
          file === "apps/mcp-server/vite.config.ts" &&
          types === "packages/core/widget-shell/dist/server.d.ts",
      ),
      "the build check no longer sees vite.config.ts's widget-shell import",
    )
  })
})
