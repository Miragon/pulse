import { readdirSync, readFileSync } from "node:fs"
import { builtinModules } from "node:module"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { build } from "esbuild"
import { describe, expect, it } from "vitest"

/**
 * `"sideEffects": false` in package.json lets a consumer's bundler keep only what it takes from
 * the `/widgets` barrel. Without it, one building block drags the view root along: ext-apps'
 * `App`, the MCP client, zod and react-dom (`countTone` alone measured 214 KB gzip instead of
 * 84 bytes). Each case bundles ONE export with esbuild, as a consumer's build would, and reads
 * the metafile. It bundles src, the module graph tsc emits to dist (this package's tests run
 * before its own build), and pulse-ui from its dist. Outside src/ui: it reads files from disk.
 */

const here = fileURLToPath(new URL(".", import.meta.url))

/** What no single building block needs: the MCP SDK and ext-apps, and the server half's libraries. */
const SERVER_CODE =
  /node_modules\/(?:\.pnpm\/[^/]+\/node_modules\/)?(@modelcontextprotocol\/[^/]+|zod|hono|@hono\/[^/]+|jose|prom-client)\//

/** A Node built-in stays external, so a leak shows as an import of the output. */
const NODE_BUILTINS = [...builtinModules, ...builtinModules.map((name) => `node:${name}`)]

const BLOCKS = ["ListTable", "countTone", "ConfirmDialog", "TestViewHost", "useToolQuery"]

/** Bundles one export of the barrel: the server-side packages in the output, and its imports. */
async function bundleOne(name: string) {
  const result = await build({
    stdin: { contents: `export { ${name} } from "./ui/index.js"`, resolveDir: here, loader: "ts" },
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
  const [output] = Object.values(result.metafile.outputs)
  const serverCode = new Set<string>()
  for (const [file, { bytesInOutput }] of Object.entries(output?.inputs ?? {})) {
    const match = SERVER_CODE.exec(file)
    if (match?.[1] && bytesInOutput > 0) serverCode.add(match[1])
  }
  return { serverCode: [...serverCode].sort(), imports: output?.imports.map((i) => i.path) ?? [] }
}

describe("the /widgets barrel tree-shakes", () => {
  it.each(BLOCKS)(
    "%s alone carries no MCP runtime, no server library and no Node built-in",
    async (name) => {
      const { serverCode, imports } = await bundleOne(name)
      expect(
        serverCode,
        `${name} pulls ${serverCode.join(", ")}: is "sideEffects": false still in package.json?`,
      ).toEqual([])
      expect(imports, `${name} imports ${imports.join(", ")}`).toEqual([])
    },
    30_000,
  )

  it("sees the runtime where it belongs: mountViews carries ext-apps", async () => {
    const { serverCode } = await bundleOne("mountViews")
    expect(serverCode).toContain("@modelcontextprotocol/ext-apps")
  }, 30_000)

  it("ships no stylesheet and no bare import, which false would let a bundler drop", () => {
    // Either needs an entry in "sideEffects" first.
    const files = readdirSync(here, { recursive: true, encoding: "utf8" })
    expect(files.filter((file) => file.endsWith(".css"))).toEqual([])
    const bare = files.filter(
      (file) =>
        /\.tsx?$/.test(file) &&
        !/\.test(-support)?\.tsx?$/.test(file) &&
        /^import\s+["']/m.test(readFileSync(join(here, file), "utf8")),
    )
    expect(bare).toEqual([])
  })
})
