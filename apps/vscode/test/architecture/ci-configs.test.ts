import { globSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { describe, expect, test } from "vitest"
import { APP_ROOT } from "./support/files.js"

type Options = Readonly<Record<string, unknown>>

const ENGINE_TESTS = "test/**/*.engine.test.ts"
const SMOKE_TESTS = "test/**/*.test.cjs"
const SWITCHES = ["passWithNoTests", "allowOnly", "bail", "testNamePattern", "include", "exclude"]

function filesOf(patterns: unknown): string[] {
  const globs = [patterns].flat().filter((pattern) => typeof pattern === "string")
  return globSync(globs, { cwd: APP_ROOT }).sort()
}

function optionsOf(value: unknown): Options {
  return typeof value === "object" && value !== null ? (value as Options) : {}
}

async function configOf(file: string): Promise<Options> {
  const loaded = (await import(pathToFileURL(join(APP_ROOT, file)).href)) as {
    readonly default: unknown
  }
  return optionsOf(loaded.default)
}

describe("the configs the CI jobs run by name", () => {
  test("are the ones the pinned test:engines and test:smoke scripts load", () => {
    const manifest = JSON.parse(readFileSync(join(APP_ROOT, "package.json"), "utf8")) as {
      readonly scripts: Readonly<Record<string, string>>
    }
    expect(manifest.scripts["test:engines"]).toBe("vitest run --config vitest.engines.config.ts")
    expect(manifest.scripts["test:smoke"]).toBe(
      "node scripts/build.mjs && vscode-test --config .vscode-test.mjs",
    )
  })

  test("run every engine test in one project that switches nothing off", async () => {
    const root = optionsOf((await configOf("vitest.engines.config.ts")).test)
    const projects = [root.projects].flat()
    expect(projects).toHaveLength(1)
    const project = optionsOf(optionsOf(projects[0]).test)
    expect(Object.keys(project).sort()).toEqual([
      "environment",
      "hookTimeout",
      "include",
      "name",
      "testTimeout",
    ])
    expect(filesOf(ENGINE_TESTS).length).toBeGreaterThan(0)
    expect(filesOf(project.include)).toEqual(filesOf(ENGINE_TESTS))
    for (const option of SWITCHES) {
      expect(root[option], option).toBeUndefined()
    }
  })

  test("run every smoke test against the built extension", async () => {
    const smoke = await configOf(".vscode-test.mjs")
    expect(filesOf(SMOKE_TESTS).length).toBeGreaterThan(0)
    expect(filesOf(smoke.files)).toEqual(filesOf(SMOKE_TESTS))
    expect(smoke.extensionDevelopmentPath).toBe(".")
    expect(statSync(join(APP_ROOT, String(smoke.workspaceFolder))).isDirectory()).toBe(true)
    expect(Object.keys(optionsOf(smoke.mocha)).sort()).toEqual(["timeout", "ui"])
    expect(Object.keys(smoke).sort()).toEqual([
      "extensionDevelopmentPath",
      "files",
      "launchArgs",
      "mocha",
      expect.stringMatching(/^(version|useInstallation)$/),
      "workspaceFolder",
    ])
  })
})
