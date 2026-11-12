import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { type BundleName, type Layout, inventoryOf, licenceTexts, originOf } from "./inventory.js"

/** A repository on disk: the CLI, two of Pulse's packages, docs, a vendored spec, node_modules. */
const FILES: Readonly<Record<string, string>> = {
  "repo/package.json": JSON.stringify({ name: "root", private: true }),
  "repo/apps/cli/package.json": JSON.stringify({
    name: "@miragon/pulse-cli",
    license: "MIT",
    dependencies: { "left-pad": "1.3.0" },
  }),
  "repo/apps/cli/src/main.ts": "export {}",
  "repo/apps/cli/src/generated/catalog.json": "{}",
  "repo/packages/core/http/package.json": JSON.stringify({
    name: "@miragon/pulse-http",
    license: "MIT",
  }),
  "repo/packages/core/http/dist/index.js": "export {}",
  "repo/packages/core/other/package.json": JSON.stringify({
    name: "@miragon/pulse-other",
    license: "ISC",
  }),
  "repo/packages/core/other/dist/index.js": "export {}",
  "repo/docs/cli/guide.md": "# Guide",
  "repo/spec/api.json": JSON.stringify({
    info: { title: "Some API", version: "1.0.1", license: { name: "Apache License 2.0" } },
  }),
  "repo/spec/LICENSE": "Apache License\r\nVersion 2.0   \r\n\r\n",
  "repo/spec/NOTICE": "\nSome API\nCopyright Someone\n",
  "repo/node_modules/.pnpm/left-pad@1.3.0/node_modules/left-pad/package.json": JSON.stringify({
    name: "left-pad",
    version: "1.3.0",
    license: "WTFPL",
    repository: { type: "git", url: "git+https://github.com/left-pad/left-pad.git" },
  }),
  "repo/node_modules/.pnpm/left-pad@1.3.0/node_modules/left-pad/LICENSE": "WTFPL text",
  "repo/node_modules/.pnpm/left-pad@1.3.0/node_modules/left-pad/index.js": "module.exports = 1",
  "repo/node_modules/.pnpm/left-pad@1.3.0/node_modules/left-pad/lib/pad.js": "module.exports = 2",
  "repo/node_modules/.pnpm/@scope+util@2.0.0/node_modules/@scope/util/package.json": JSON.stringify(
    {
      name: "@scope/util",
      version: "2.0.0",
      license: "Apache-2.0",
      homepage: "https://example.org/util",
    },
  ),
  "repo/node_modules/.pnpm/@scope+util@2.0.0/node_modules/@scope/util/NOTICE.md": "Util notice",
  "repo/node_modules/.pnpm/@scope+util@2.0.0/node_modules/@scope/util/LICENSE-APACHE": "Apache",
  "repo/node_modules/.pnpm/@scope+util@2.0.0/node_modules/@scope/util/README.md": "not a licence",
  "repo/node_modules/.pnpm/@scope+util@2.0.0/node_modules/@scope/util/license.js": "code",
  "repo/node_modules/.pnpm/@scope+util@2.0.0/node_modules/@scope/util/notice.d.ts": "types",
  "repo/node_modules/.pnpm/@scope+util@2.0.0/node_modules/@scope/util/lib/x.js": "x",
  "repo/node_modules/.pnpm/bare@1.0.0/node_modules/bare/package.json": JSON.stringify({
    name: "bare",
    version: "1.0.0",
    license: "MIT",
  }),
  "repo/node_modules/.pnpm/bare@1.0.0/node_modules/bare/index.js": "x",
  "repo/node_modules/.pnpm/reuse@1.0.0/node_modules/reuse/LICENSE": "MIT, and see LICENSES",
  "repo/node_modules/.pnpm/reuse@1.0.0/node_modules/reuse/LICENSES/MIT.txt": "MIT",
  "bundler/package.json": JSON.stringify({ name: "bundler", version: "9.0.0", license: "MIT" }),
  "bundler/LICENSE": "MIT, the bundler's",
  "outside/x.js": "x",
}

let root = ""
let layout: Layout
const at = (path: string): string => join(root, path)
const LEFT_PAD = "repo/node_modules/.pnpm/left-pad@1.3.0/node_modules/left-pad"
const UTIL = "repo/node_modules/.pnpm/@scope+util@2.0.0/node_modules/@scope/util"

beforeAll(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "pulse-cli-licences-")))
  for (const [path, text] of Object.entries(FILES)) {
    mkdirSync(dirname(at(path)), { recursive: true })
    writeFileSync(at(path), text)
  }
  layout = {
    repo: at("repo"),
    cli: at("repo/apps/cli"),
    virtual: { "\0bundler/runtime.js": { dir: at("bundler"), holds: "its runtime helpers" } },
    embedded: {
      "src/generated/catalog.json": {
        dir: at("repo/spec"),
        spec: "api.json",
        licence: "Apache-2.0",
        licenceName: "Apache License 2.0",
        holds: "the command descriptions",
        source: "https://example.org/spec",
      },
    },
  }
})

afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})

const graph = (
  npm: readonly string[],
  standalone: readonly string[],
): Record<BundleName, string[]> => ({
  npm: npm.map(at),
  standalone: standalone.map((id) => (id.startsWith("\0") ? id : at(id))),
})

describe("originOf", () => {
  it("maps a module under node_modules onto its package, a scoped one included", () => {
    expect(originOf(at(`${LEFT_PAD}/lib/pad.js`), layout)).toEqual({
      kind: "third-party",
      dir: at(LEFT_PAD),
    })
    expect(originOf(at(`${UTIL}/lib/x.js`), layout)).toEqual({ kind: "third-party", dir: at(UTIL) })
  })

  it("maps a virtual module onto the package that writes it", () => {
    expect(originOf("\0bundler/runtime.js", layout)).toEqual({
      kind: "third-party",
      dir: at("bundler"),
      holds: "its runtime helpers",
    })
  })

  it("keeps the CLI's and the repository's files and Pulse's packages as their own", () => {
    expect(originOf(at("repo/apps/cli/src/main.ts"), layout)).toEqual({ kind: "own" })
    expect(originOf(at("repo/docs/cli/guide.md"), layout)).toEqual({ kind: "own" })
    expect(originOf(at("repo/packages/core/http/dist/index.js"), layout)).toEqual({
      kind: "own",
      packageDir: at("repo/packages/core/http"),
    })
  })

  it("fails on a virtual module nobody named and on a module outside node_modules and the repository", () => {
    expect(() => originOf("\0other/helper.js", layout)).toThrow(
      /virtual module "\\u0000other\/helper\.js"/,
    )
    expect(() => originOf(at("outside/x.js"), layout)).toThrow(
      /neither in node_modules nor in the repository/,
    )
  })
})

describe("licenceTexts", () => {
  it("reads every licence and notice file, sorted, with LF line ends and no blanks around, no code", () => {
    expect(licenceTexts(at(UTIL), "util")).toEqual([
      { file: "LICENSE-APACHE", text: "Apache" },
      { file: "NOTICE.md", text: "Util notice" },
    ])
    expect(licenceTexts(at("repo/spec"), "spec")).toEqual([
      { file: "LICENSE", text: "Apache License\nVersion 2.0" },
      { file: "NOTICE", text: "Some API\nCopyright Someone" },
    ])
  })

  it("fails on a work without a licence file", () => {
    expect(() =>
      licenceTexts(at("repo/node_modules/.pnpm/bare@1.0.0/node_modules/bare"), "bare 1.0.0"),
    ).toThrow(/bare 1\.0\.0 .* ships no licence file/)
  })

  it("fails on a work that keeps licence texts in a folder", () => {
    expect(() =>
      licenceTexts(at("repo/node_modules/.pnpm/reuse@1.0.0/node_modules/reuse"), "reuse 1.0.0"),
    ).toThrow(/reuse 1\.0\.0 .* keeps licence texts in the folder LICENSES: read them/)
  })
})

describe("inventoryOf", () => {
  it("lists each work once with the bundles that hold it, Pulse's packages and npm's dependencies", () => {
    const inventory = inventoryOf(
      graph(
        [
          "repo/apps/cli/src/main.ts",
          "repo/apps/cli/src/generated/catalog.json",
          `${LEFT_PAD}/index.js`,
        ],
        [
          "\0bundler/runtime.js",
          "repo/apps/cli/src/generated/catalog.json",
          "repo/packages/core/http/dist/index.js",
          `${LEFT_PAD}/index.js`,
          `${LEFT_PAD}/lib/pad.js`,
          `${UTIL}/lib/x.js`,
          "repo/docs/cli/guide.md",
        ],
      ),
      layout,
    )
    expect(
      inventory.thirdParty.map(({ name, version, licence, bundles }) => [
        name,
        version,
        licence,
        bundles,
      ]),
    ).toEqual([
      ["@scope/util", "2.0.0", "Apache-2.0", ["standalone"]],
      ["bundler", "9.0.0", "MIT", ["standalone"]],
      ["left-pad", "1.3.0", "WTFPL", ["npm", "standalone"]],
      ["Some API", "1.0.1", "Apache-2.0", ["npm", "standalone"]],
    ])
    expect(inventory.own).toEqual(["@miragon/pulse-http"])
    expect(inventory.installed).toEqual(["left-pad 1.3.0"])
  })

  it("names where a work comes from and what of it the bundle holds", () => {
    const { thirdParty } = inventoryOf(
      graph(
        [`${LEFT_PAD}/index.js`, "repo/apps/cli/src/generated/catalog.json"],
        ["\0bundler/runtime.js", `${UTIL}/lib/x.js`],
      ),
      layout,
    )
    const facts = thirdParty.map(({ name, source, holds }) => [name, source, holds])
    expect(facts).toEqual([
      ["@scope/util", "https://example.org/util", undefined],
      ["bundler", undefined, "its runtime helpers"],
      ["left-pad", "https://github.com/left-pad/left-pad", undefined],
      ["Some API", "https://example.org/spec", "the command descriptions"],
    ])
  })

  it("fails on a package of Pulse's under another licence than the CLI's", () => {
    expect(() =>
      inventoryOf(graph(["repo/packages/core/other/dist/index.js"], []), layout),
    ).toThrow("@miragon/pulse-other is under ISC, not the CLI's MIT: list it as a third party")
  })

  it("fails on a package without a licence file and on a spec that names another licence", () => {
    expect(() =>
      inventoryOf(
        graph([], ["repo/node_modules/.pnpm/bare@1.0.0/node_modules/bare/index.js"]),
        layout,
      ),
    ).toThrow(/ships no licence file/)
    const other = { ...layout.embedded["src/generated/catalog.json"]!, licenceName: "MIT License" }
    const changed = { ...layout, embedded: { "src/generated/catalog.json": other } }
    expect(() =>
      inventoryOf(graph(["repo/apps/cli/src/generated/catalog.json"], []), changed),
    ).toThrow(/names the licence "Apache License 2.0", not MIT License/)
  })
})
