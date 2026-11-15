import { globSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { describe, expect, test } from "vitest"
import { APP_ROOT } from "./support/files.js"

type Options = Readonly<Record<string, unknown>>

const SMOKE_TESTS = "test/**/*.test.cjs"

function filesOf(patterns: unknown): string[] {
  const globs = [patterns].flat().filter((pattern) => typeof pattern === "string")
  return globSync(globs, { cwd: APP_ROOT }).sort()
}

function optionsOf(value: unknown): Options {
  return typeof value === "object" && value !== null ? (value as Options) : {}
}

async function smokeConfigsOf(file: string): Promise<Options[]> {
  const loaded = (await import(pathToFileURL(join(APP_ROOT, file)).href)) as {
    readonly default: unknown
  }
  return [loaded.default].flat().map(optionsOf)
}

const MANIFEST = JSON.parse(readFileSync(join(APP_ROOT, "package.json"), "utf8")) as {
  readonly scripts: Readonly<Record<string, string>>
}

describe("the configs the CI jobs run by name", () => {
  test("are the ones the pinned test:smoke script loads", () => {
    expect(MANIFEST.scripts["test:smoke"]).toBe(
      "node scripts/build.mjs && vscode-test --config .vscode-test.mjs",
    )
  })

  test("package the .vsix from the build that ships, with React's production build", () => {
    expect(MANIFEST.scripts.package).toMatch(
      /^node scripts\/build\.mjs --production && vsce package /,
    )
  })

  test("run every smoke test against the built extension, in a folder and without one", async () => {
    const [workspace, noFolder, ...others] = await smokeConfigsOf(".vscode-test.mjs")
    expect(others).toEqual([])
    expect(filesOf(SMOKE_TESTS).length).toBeGreaterThan(0)
    expect([...filesOf(workspace?.files), ...filesOf(noFolder?.files)].sort()).toEqual(
      filesOf(SMOKE_TESTS),
    )
    expect(statSync(join(APP_ROOT, String(workspace?.workspaceFolder))).isDirectory()).toBe(true)
    for (const [smoke, label, folder] of [
      [workspace, "workspace", ["workspaceFolder"]],
      [noFolder, "no-folder", []],
    ] as const) {
      const options = optionsOf(smoke)
      expect(options.label).toBe(label)
      expect(options.extensionDevelopmentPath).toBe(".")
      expect(Object.keys(optionsOf(options.mocha)).sort()).toEqual(["timeout", "ui"])
      const keys = Object.keys(options)
      expect(keys.filter((key) => /^(version|useInstallation)$/.test(key))).toHaveLength(1)
      expect(keys.filter((key) => !/^(version|useInstallation)$/.test(key)).sort()).toEqual(
        [
          "env",
          "extensionDevelopmentPath",
          "files",
          "label",
          "launchArgs",
          "mocha",
          ...folder,
        ].sort(),
      )
    }
  })
})
