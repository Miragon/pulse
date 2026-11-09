import { globSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { describe, expect, test } from "vitest"

type Options = Readonly<Record<string, unknown>>

const APP_ROOT = fileURLToPath(new URL("../../", import.meta.url))

const ENGINE_TESTS = "test/**/*.engine.test.ts"
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

describe("the config the engines CI job runs by name", () => {
  test("are the ones the pinned test:engines script loads", () => {
    const manifest = JSON.parse(readFileSync(join(APP_ROOT, "package.json"), "utf8")) as {
      readonly scripts: Readonly<Record<string, string>>
    }
    expect(manifest.scripts["test:engines"]).toBe("vitest run --config vitest.engines.config.ts")
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
})
