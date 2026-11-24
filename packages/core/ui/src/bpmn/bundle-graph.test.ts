import { builtinModules } from "node:module"
import { fileURLToPath } from "node:url"
import { build, type Metafile } from "esbuild"
import { beforeAll, describe, expect, it } from "vitest"

/**
 * What a page that imports the BPMN diagram bundles (issue #662): the diagram, bpmn-js, React and
 * the kit, never the MCP runtime, React Query or zod (widget-shell's `/widgets`, where the viewer
 * lived before, resolved them all). Each case bundles one entry from src with esbuild, as a page's
 * build would, every package included, and reads the metafile's inputs: what the module graph
 * reaches, whether or not the output keeps a byte of it. The root entry reaches no bpmn-js, so a
 * page without a diagram never resolves it (it is the kit's optional peer).
 */

const SRC = fileURLToPath(new URL("..", import.meta.url))

/** A package of the graph by its folder under node_modules (pnpm's store included). */
const PACKAGE = /node_modules\/(?:\.pnpm\/[^/]+\/node_modules\/)?((?:@[^/]+\/)?[^/]+)\//

/** A Node built-in stays external, so a leak shows as an import of the output. */
const NODE_BUILTINS = [...builtinModules, ...builtinModules.map((name) => `node:${name}`)]

interface Graph {
  readonly packages: readonly string[]
  readonly sources: readonly string[]
  readonly imports: readonly string[]
}

async function graphOf(entry: string): Promise<Graph> {
  const result = await build({
    entryPoints: [entry],
    absWorkingDir: SRC,
    bundle: true,
    write: false,
    metafile: true,
    format: "esm",
    platform: "browser",
    jsx: "automatic",
    external: NODE_BUILTINS,
    logLevel: "silent",
    outfile: "bundle.js",
  })
  const metafile: Metafile = result.metafile
  const inputs = Object.keys(metafile.inputs)
  const packages = new Set(inputs.flatMap((file) => PACKAGE.exec(file)?.[1] ?? []))
  const [output] = Object.values(metafile.outputs)
  return {
    packages: [...packages].sort(),
    sources: inputs.filter((file) => !file.includes("node_modules/")),
    imports: output?.imports.map((i) => i.path) ?? [],
  }
}

let bpmn: Graph
let root: Graph

beforeAll(async () => {
  ;[bpmn, root] = await Promise.all([graphOf("bpmn/index.ts"), graphOf("index.ts")])
}, 60_000)

describe("the ./bpmn entry's module graph", () => {
  it("reaches no MCP runtime, no React Query and no zod", () => {
    expect(
      bpmn.packages.filter((name) =>
        /^(?:@modelcontextprotocol\/|@tanstack\/|zod$|@miragon\/)/.test(name),
      ),
    ).toEqual([])
  })

  it("holds bpmn-js, React and the kit, and imports nothing left outside", () => {
    expect(bpmn.packages).toEqual(expect.arrayContaining(["bpmn-js", "diagram-js", "react"]))
    expect(bpmn.sources).toContain("index.ts")
    expect(bpmn.imports).toEqual([])
  })
})

describe("the root entry's module graph", () => {
  it("reaches no bpmn-js and no module of the ./bpmn entry", () => {
    expect(root.packages.filter((name) => /^(?:bpmn-js|diagram-js)$/.test(name))).toEqual([])
    expect(root.sources.filter((file) => file.startsWith("bpmn/"))).toEqual([])
  })
})
