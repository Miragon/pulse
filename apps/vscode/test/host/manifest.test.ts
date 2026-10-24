import { readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, test } from "vitest"
import { COMMAND } from "../../src/host/commands/command-ids.js"

const PACKAGE = fileURLToPath(new URL("../../", import.meta.url))

interface Manifest {
  readonly main: string
  readonly extensionDependencies?: readonly string[]
  readonly extensionPack?: readonly string[]
  readonly contributes: {
    readonly commands: readonly { readonly command: string }[]
    readonly menus: Readonly<Record<string, readonly { readonly command: string }[]>>
    readonly views: Readonly<Record<string, readonly { readonly id: string }[]>>
    readonly configuration: { readonly properties: Readonly<Record<string, unknown>> }
  }
}

const manifest = JSON.parse(readFileSync(join(PACKAGE, "package.json"), "utf8")) as Manifest

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name)
    return statSync(path).isDirectory() ? sourceFiles(path) : path.endsWith(".ts") ? [path] : []
  })
}

const source = sourceFiles(join(PACKAGE, "src"))
  .map((path) => readFileSync(path, "utf8"))
  .join("\n")

function registered(pattern: RegExp): string[] {
  return [...source.matchAll(pattern)].map((match) => match[1] ?? "")
}

describe("the extension manifest", () => {
  test("declares exactly the commands the extension registers", () => {
    const declared = manifest.contributes.commands.map((entry) => entry.command).sort()
    const commandKeys = registered(/readonly id = COMMAND\.(\w+);/g)
    const registeredCommands = commandKeys.map((key) => COMMAND[key as keyof typeof COMMAND]).sort()
    expect(registeredCommands).toEqual(declared)
    expect(Object.values(COMMAND).sort()).toEqual(declared)
    expect(source).toMatch(/registerCommand\(command\.id,/)
  })

  test("depends on no other extension, so Pulse works without the BPMN modeler", () => {
    expect(manifest.extensionDependencies).toBeUndefined()
    expect(manifest.extensionPack).toBeUndefined()
  })

  test("references only declared commands in its menus", () => {
    const declared = new Set(manifest.contributes.commands.map((entry) => entry.command))
    const referenced = Object.values(manifest.contributes.menus).flatMap((entries) =>
      entries.map((entry) => entry.command),
    )
    expect(referenced.filter((command) => !declared.has(command))).toEqual([])
  })

  test("registers a provider for every contributed view", () => {
    const views = Object.values(manifest.contributes.views).flatMap((entries) =>
      entries.map((entry) => entry.id),
    )
    const providers = [
      ...registered(/registerTreeDataProvider\('([\w.]+)'/g),
      ...registered(/createTreeView\('([\w.]+)'/g),
    ]
    expect(providers.sort()).toEqual(views.sort())
  })

  test("declares every setting the extension reads", () => {
    const read = registered(
      /getConfiguration\('pulse'\)\s*\.(?:get|inspect)(?:<.+?>)?\('(\w+)'\)/gs,
    ).map((key) => `pulse.${key}`)
    expect(read.length).toBeGreaterThan(0)
    expect(read.filter((key) => !(key in manifest.contributes.configuration.properties))).toEqual(
      [],
    )
  })

  test("lets only the user turn writes on, never a workspace or a dev container", () => {
    expect(manifest.contributes.configuration.properties["pulse.writes"]).toMatchObject({
      scope: "application",
      default: "localOnly",
    })
    expect(source).toMatch(/inspect\('writes'\)\?\.globalValue/)
    expect(source).not.toMatch(/get<[^>]*>\('writes'\)|\.get\('writes'\)/)
  })

  test("lets only the user turn live updates on, never a workspace or a dev container", () => {
    expect(manifest.contributes.configuration.properties["pulse.liveUpdates"]).toMatchObject({
      scope: "application",
      default: {},
    })
    expect(source).toMatch(/inspect\('liveUpdates'\)\?\.globalValue/)
    expect(source).not.toMatch(/\.get\('liveUpdates'\)/)
  })

  test("points main at the bundled host", () => {
    expect(manifest.main).toBe("./dist/extension.cjs")
  })
})
