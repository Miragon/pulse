import { readdirSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, test } from "vitest"
import type { EngineAdapter } from "../../src/contract/index.js"
import { APP_ROOT, readRepoFile } from "./support/files.js"

type AdapterClass = new () => EngineAdapter

const FOLDERS = readdirSync(join(APP_ROOT, "src/adapters"), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort()

async function adapterClassesOf(folder: string): Promise<(readonly [string, AdapterClass])[]> {
  const exported = (await import(`../../src/adapters/${folder}/index.ts`)) as Readonly<
    Record<string, unknown>
  >
  return Object.entries(exported).flatMap(([name, value]) =>
    name.endsWith("Adapter") && typeof value === "function"
      ? [[name, value as AdapterClass] as const]
      : [],
  )
}

describe("an engine is one adapter folder", () => {
  test.each(FOLDERS)("%s exports one adapter, whose id is the folder's name", async (folder) => {
    const ids = (await adapterClassesOf(folder)).map(([, Adapter]) => new Adapter().id)

    expect(ids).toEqual([folder])
  })

  test("the composition root imports and builds each adapter folder's adapter once", async () => {
    const root = readRepoFile("apps/vscode/src/host/composition-root.ts")
    const imported = [...root.matchAll(/from "\.\.\/adapters\/([^/"]+)\/index\.js"/g)].map(
      ([, folder]) => folder,
    )
    const built = [...root.matchAll(/new (\w+Adapter)\(\)/g)].map(([, name]) => name)
    const exported = (await Promise.all(FOLDERS.map((folder) => adapterClassesOf(folder))))
      .flat()
      .map(([name]) => name)

    expect(imported.sort()).toEqual(FOLDERS)
    expect(built.sort()).toEqual(exported.sort())
  })
})
