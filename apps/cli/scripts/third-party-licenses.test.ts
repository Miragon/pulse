import { execFileSync, spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, relative, sep } from "node:path"
import { beforeAll, describe, expect, it } from "vitest"
import { bundledModules, CLI_LAYOUT, LICENCES_FILE } from "./licenses/bundles.js"
import { type BundleName, type Inventory, inventoryOf } from "./licenses/inventory.js"
import { licenceFindings } from "./licenses/render.js"

const cliFile = (path: string): string => readFileSync(join(CLI_LAYOUT.cli, path), "utf8")
const script = (name: string): string => join(CLI_LAYOUT.cli, "scripts", name)

/** The strings of an OpenAPI document under `summary` and `description`, `min` characters or longer. */
function specTexts(node: unknown, min: number): string[] {
  if (Array.isArray(node)) return node.flatMap((item) => specTexts(item, min))
  if (node === null || typeof node !== "object") return []
  return Object.entries(node).flatMap(([key, value]) =>
    (key === "summary" || key === "description") && typeof value === "string"
      ? value.length >= min
        ? [value]
        : []
      : specTexts(value, min),
  )
}

/** The modules of the repository both bundles hold, by their paths in the CLI. */
function ownModules(modules: Readonly<Record<BundleName, readonly string[]>>): string[] {
  const nodeModules = `${sep}node_modules${sep}`
  const paths = [...modules.npm, ...modules.standalone]
    .filter((id) => !id.startsWith("\0"))
    .map((id) => realpathSync(id))
    .filter((path) => !path.includes(nodeModules))
  return [...new Set(paths)].map((path) => relative(CLI_LAYOUT.cli, path).split(sep).join("/"))
}

/**
 * apps/cli/CLAUDE.md, "Licences": THIRD_PARTY_LICENSES.txt is what the CLI's two bundles hold of
 * works of others, read from the module graphs tsdown builds of them; the planted cases are in
 * scripts/licenses/render.test.ts and scripts/licenses/inventory.test.ts.
 */
describe("THIRD_PARTY_LICENSES.txt", () => {
  let modules: Record<BundleName, string[]>
  let inventory: Inventory

  beforeAll(async () => {
    modules = await bundledModules()
    inventory = inventoryOf(modules, CLI_LAYOUT)
  })

  it("lists exactly the works of others the bundles hold, each with its licence and notice files", () => {
    expect(licenceFindings(readFileSync(LICENCES_FILE, "utf8"), inventory)).toEqual([])
  })

  it("finds the spec's texts only in the modules that name the spec, and lists it", () => {
    const source = CLI_LAYOUT.embedded["src/generated/catalog.json"]
    const spec: unknown = JSON.parse(readFileSync(join(source?.dir ?? "", "api.json"), "utf8"))
    // each text as it is and as a JSON or TypeScript string holds it
    const texts = new Set(
      specTexts(spec, 40).flatMap((text) => [text, JSON.stringify(text).slice(1, -1)]),
    )
    const carriers = ownModules(modules).filter((path) => {
      const code = cliFile(path)
      return [...texts].some((text) => code.includes(text))
    })
    // one text of the spec in a module is enough to need the spec's licence: the catalog is the
    // one module that carries them, and a module that starts to must name the spec too
    expect(carriers).toEqual(Object.keys(CLI_LAYOUT.embedded))
    expect(inventory.thirdParty.find(({ name }) => name === "Operaton REST API")?.bundles).toEqual([
      "npm",
      "standalone",
    ])
  })

  it("ships beside LICENSE in the npm package and the image", () => {
    const manifest = JSON.parse(cliFile("package.json")) as { files: string[] }
    expect(manifest.files).toEqual(expect.arrayContaining(["LICENSE", "THIRD_PARTY_LICENSES.txt"]))
    expect(cliFile(".dockerignore").split("\n")).toEqual(
      expect.arrayContaining(["!LICENSE", "!THIRD_PARTY_LICENSES.txt"]),
    )
    expect(cliFile("Dockerfile")).toContain(
      "\nCOPY LICENSE THIRD_PARTY_LICENSES.txt /usr/share/doc/pulse-cli/\n",
    )
  })

  describe.skipIf(process.platform === "win32")("the archive of an executable", () => {
    let dir = ""
    beforeAll(() => {
      dir = mkdtempSync(join(tmpdir(), "pulse-cli-pack-"))
      return () => {
        rmSync(dir, { recursive: true, force: true })
      }
    })

    it("ships it with LICENSE and the embedded Node.js's licence, which the formula installs", () => {
      writeFileSync(join(dir, "pulse-cli-linux-x64"), "#!/bin/sh\n")
      writeFileSync(join(dir, "LICENSE"), "Node.js's licence")
      const executable = join(dir, "pulse-cli-linux-x64")
      execFileSync("bash", [script("pack-binary.sh"), executable, join(dir, "LICENSE")])
      const archive = `${executable}.tar.xz`
      const listed = execFileSync("tar", ["-tJf", archive], { encoding: "utf8" })
      const entries = listed.trim().split("\n").toSorted()
      expect(entries).toEqual(["LICENSE", "NODE_LICENSE", "THIRD_PARTY_LICENSES.txt", "pulse-cli"])
      const read = (file: string) =>
        execFileSync("tar", ["-xJOf", archive, file], { encoding: "utf8" })
      expect(read("THIRD_PARTY_LICENSES.txt")).toBe(readFileSync(LICENCES_FILE, "utf8"))
      expect(read("NODE_LICENSE")).toBe("Node.js's licence")
      expect(execFileSync("tar", ["-tvJf", archive, "pulse-cli"], { encoding: "utf8" })).toMatch(
        /^-rwxr-xr-x/,
      )
      // the formula installs every file of the archive but LICENSE, which Homebrew installs itself
      const sums = join(dir, "pulse-cli-SHA256SUMS")
      const files = ["macos-arm64", "macos-x64", "linux-arm64", "linux-x64"]
      writeFileSync(
        sums,
        files.map((file) => `${"0".repeat(64)}  pulse-cli-${file}.tar.xz\n`).join(""),
      )
      const formula = execFileSync("bash", [script("homebrew-formula.sh"), "0.0.0", sums], {
        encoding: "utf8",
      })
      const installs = [...formula.matchAll(/^ +(?:bin|prefix)\.install (.+)$/gm)]
      const installed = installs.flatMap(([, names = ""]) =>
        names.split(", ").map((name) => JSON.parse(name) as string),
      )
      expect(["LICENSE", ...installed].toSorted()).toEqual(entries)
    })

    it("takes the Node.js licence build:exe keeps, never the one of the node on the PATH", () => {
      const executable = join(dir, "pulse-cli-unbuilt")
      writeFileSync(executable, "#!/bin/sh\n")
      const packed = spawnSync("bash", [script("pack-binary.sh"), executable], { encoding: "utf8" })
      expect(packed.status).toBe(1)
      expect(packed.stderr).toContain(
        `${join(CLI_LAYOUT.cli, "build/node-license/pulse-cli-unbuilt")} does not exist`,
      )
    })
  })
})
