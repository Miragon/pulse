import { globSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { describe, expect, test } from "vitest"
import { camunda7ImageOf, DEFAULT_ENGINE_IMAGE } from "../support/engine-image.js"

type Options = Readonly<Record<string, unknown>>

const APP_ROOT = fileURLToPath(new URL("../../", import.meta.url))
const CI_WORKFLOW = fileURLToPath(
  new URL("../../../../../../.github/workflows/ci.yml", import.meta.url),
)

const ENGINE_TESTS = "test/**/*.engine.test.ts"
const SWITCHES = ["passWithNoTests", "allowOnly", "bail", "testNamePattern", "include", "exclude"]
const CONFIG_IMPORT_LIMIT = { timeout: 15_000 }

function filesOf(patterns: unknown): string[] {
  const globs = [patterns].flat().filter((pattern) => typeof pattern === "string")
  return globSync(globs, { cwd: APP_ROOT }).sort()
}

function optionsOf(value: unknown): Options {
  return typeof value === "object" && value !== null ? (value as Options) : {}
}

function imagesOfTheEngineLegs(): string[] {
  const workflow = readFileSync(CI_WORKFLOW, "utf8")
  const legs = workflow.matchAll(/^ +- flavor: \S+\n +image: (\S+)$/gm)
  return [...legs].map(([, image]) => String(image))
}

async function configOf(file: string): Promise<Options> {
  const loaded = (await import(pathToFileURL(join(APP_ROOT, file)).href)) as {
    readonly default: unknown
  }
  return optionsOf(loaded.default)
}

describe("the config the engines CI job runs by name", CONFIG_IMPORT_LIMIT, () => {
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

describe("the image the engine tests start", () => {
  test("is a Camunda 7 engine on each image the Engines legs of CI hand over, and without one", () => {
    const images = imagesOfTheEngineLegs()
    expect(images).toEqual([
      "cibseven/cibseven:run-2.2.0",
      "cibseven/cibseven:run-3.0.0",
      "operaton/operaton:2.1.5",
    ])
    for (const image of [...images, DEFAULT_ENGINE_IMAGE]) {
      expect(camunda7ImageOf(image), image).toBe(true)
    }
  })

  test("is a Camunda 8 cluster on camunda/camunda by tag or digest, which the tests skip", () => {
    for (const image of ["camunda/camunda:8.10.9", "camunda/camunda@sha256:0123"]) {
      expect(camunda7ImageOf(image), image).toBe(false)
    }
  })

  test("is refused when it is neither, so a typo never passes as a skipped run", () => {
    for (const image of [
      "camunda/camunda-bpm-platform:7.24.0",
      "operaton/operaton",
      "docker.io/operaton/operaton:2.1.5",
      "pulse-cibseven:latest",
    ]) {
      expect(() => camunda7ImageOf(image), image).toThrow(
        `PULSE_ENGINE_IMAGE names ${image}, which is neither a Camunda 7 engine the suites start`,
      )
    }
  })
})
