import assert from "node:assert/strict"
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { after, before, describe, it } from "node:test"
import * as list from "./third-party-licenses.mjs"
import {
  cssDependencies,
  ESBUILD_RUNTIME,
  esbuildModules,
  inlinedStylesheets,
  inventoryOf,
  licenceFindings,
  licenceTexts,
  listedWorks,
  openApiTexts,
  openApiWork,
  originOf,
  renderedModules,
  renderLicences,
} from "./third-party-licenses.mjs"

/**
 * A repository on disk: an artifact, two of Pulse's packages, docs, a vendored spec,
 * node_modules (a package without licence files among them, with its copy in the repository).
 */
const FILES = {
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
  "repo/packages/core/ui/package.json": JSON.stringify({
    name: "@miragon/pulse-ui",
    license: "MIT",
  }),
  "repo/packages/core/ui/dist/primitives/button.js": "export {}",
  "repo/packages/core/ui/dist/primitives/card.js": "export {}",
  "repo/packages/core/ui/src/primitives/LICENSE.md": "MIT, the kit's",
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
  "repo/licences/bare/LICENSE": "MIT, from bare's repository",
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
    { name: "@scope/util", version: "2.0.0", license: "Apache-2.0", homepage: "https://ex.org/u" },
  ),
  "repo/node_modules/.pnpm/@scope+util@2.0.0/node_modules/@scope/util/NOTICE.md": "Util notice",
  "repo/node_modules/.pnpm/@scope+util@2.0.0/node_modules/@scope/util/LICENSE-APACHE": "Apache",
  "repo/node_modules/.pnpm/@scope+util@2.0.0/node_modules/@scope/util/README.md": "no licence",
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
  "repo/node_modules/.pnpm/tw@1.0.0/node_modules/tw/package.json": JSON.stringify({
    name: "tw",
    version: "1.0.0",
    license: "MIT",
  }),
  "repo/node_modules/.pnpm/tw@1.0.0/node_modules/tw/LICENSE": "MIT, tw's",
  "repo/node_modules/.pnpm/tw@1.0.0/node_modules/tw/index.css": "@layer base {}",
  "repo/node_modules/.pnpm/styled@1.0.0/node_modules/styled/package.json": JSON.stringify({
    name: "styled",
    version: "1.0.0",
    license: "MIT",
    exports: { ".": { style: "./dist/styled.css", import: "./index.js" } },
  }),
  "repo/node_modules/.pnpm/styled@1.0.0/node_modules/styled/index.js": "x",
  "repo/node_modules/.pnpm/styled@1.0.0/node_modules/styled/dist/styled.css": "b {}",
  "repo/node_modules/.pnpm/styled@1.0.0/node_modules/styled/extra.css":
    '@import "./dist/styled.css";',
  "repo/node_modules/.pnpm/patterned@1.0.0/node_modules/patterned/package.json": JSON.stringify({
    name: "patterned",
    version: "1.0.0",
    license: "MIT",
    exports: {
      ".": "./index.js",
      "./*.css": { style: "./css/*.css" },
      "./deep/*": "./deep-dist/*",
    },
  }),
  "repo/node_modules/.pnpm/patterned@1.0.0/node_modules/patterned/css/theme.css": "e {}",
  "repo/node_modules/.pnpm/patterned@1.0.0/node_modules/patterned/css/deep/x.css": "f {}",
  "repo/node_modules/.pnpm/patterned@1.0.0/node_modules/patterned/deep-dist/x.css": "g {}",
  "repo/apps/cli/src/ui/patterned.css":
    '@import "patterned/theme.css";\n@import "patterned/deep/x.css";\n',
  "repo/apps/cli/src/ui/unmatched.css": '@import "patterned/readme.md";\n',
  "repo/apps/cli/src/ui/main.css":
    '@import "tw";\n/* @import "gone"; */\n@import "./theme" layer(theme);\n' +
    '@import url("https://fonts.example.org/a.css");\n',
  "repo/apps/cli/src/ui/theme.css": "@import 'styled';\n",
  "repo/apps/cli/src/ui/scanned.css": "c {}",
  "repo/apps/cli/src/ui/other.scss": "d {}",
  "repo/apps/cli/src/ui/plugin.css": '@plugin "./p.js";\n',
  "bundler/package.json": JSON.stringify({ name: "bundler", version: "9.0.0", license: "MIT" }),
  "bundler/LICENSE": "MIT, the bundler's",
  "outside/x.js": "x",
}

/** The packages of the artifact's node_modules, as pnpm links them. */
const LINKS = {
  "repo/apps/cli/node_modules/tw": "repo/node_modules/.pnpm/tw@1.0.0/node_modules/tw",
  "repo/apps/cli/node_modules/styled": "repo/node_modules/.pnpm/styled@1.0.0/node_modules/styled",
  "repo/apps/cli/node_modules/patterned":
    "repo/node_modules/.pnpm/patterned@1.0.0/node_modules/patterned",
}

let root = ""
let layout
const at = (path) => join(root, path)
const LEFT_PAD = "repo/node_modules/.pnpm/left-pad@1.3.0/node_modules/left-pad"
const UTIL = "repo/node_modules/.pnpm/@scope+util@2.0.0/node_modules/@scope/util"
const BARE = "repo/node_modules/.pnpm/bare@1.0.0/node_modules/bare"

const specWork = (licenceName = "Apache License 2.0") =>
  openApiWork({
    dir: at("repo/spec"),
    spec: "api.json",
    licence: "Apache-2.0",
    licenceName,
    holds: "the command descriptions",
    source: "https://example.org/spec",
  })

const kitWork = () => ({
  name: "kit",
  version: "4",
  licence: "MIT",
  source: undefined,
  holds: "its components, changed",
  texts: licenceTexts(at("repo/packages/core/ui/src/primitives"), "kit 4"),
})

before(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "pulse-licences-")))
  for (const [path, text] of Object.entries(FILES)) {
    mkdirSync(dirname(at(path)), { recursive: true })
    writeFileSync(at(path), text)
  }
  for (const [path, target] of Object.entries(LINKS)) {
    mkdirSync(dirname(at(path)), { recursive: true })
    symlinkSync(at(target), at(path))
  }
  layout = {
    repo: at("repo"),
    home: at("repo/apps/cli"),
    bundles: ["npm", "standalone"],
    virtual: { "\0bundler/runtime.js": { dir: at("bundler"), holds: "its runtime helpers" } },
    embedded: {
      "apps/cli/src/generated/catalog.json": () => specWork(),
      "packages/core/ui/dist/primitives/": kitWork,
    },
    licenceFiles: { "bare@1.0.0": { dir: "licences/bare", from: "bare's repository" } },
  }
})

after(() => {
  rmSync(root, { recursive: true, force: true })
})

const graph = (npm, standalone) => ({
  npm: npm.map(at),
  standalone: standalone.map((id) => (id.startsWith("\0") ? id : at(id))),
})

describe("originOf", () => {
  it("maps a module under node_modules onto its package, a scoped one included", () => {
    assert.deepEqual(originOf(at(`${LEFT_PAD}/lib/pad.js`), layout), {
      kind: "third-party",
      dir: at(LEFT_PAD),
    })
    assert.deepEqual(originOf(at(`${UTIL}/lib/x.js`), layout), {
      kind: "third-party",
      dir: at(UTIL),
    })
  })

  it("maps a virtual module onto the package that writes it", () => {
    assert.deepEqual(originOf("\0bundler/runtime.js", layout), {
      kind: "third-party",
      dir: at("bundler"),
      holds: "its runtime helpers",
    })
  })

  it("keeps the artifact's and the repository's files and Pulse's packages as their own", () => {
    assert.deepEqual(originOf(at("repo/apps/cli/src/main.ts"), layout), { kind: "own" })
    assert.deepEqual(originOf(at("repo/docs/cli/guide.md"), layout), { kind: "own" })
    assert.deepEqual(originOf(at("repo/packages/core/http/dist/index.js"), layout), {
      kind: "own",
      packageDir: at("repo/packages/core/http"),
    })
  })

  it("fails on a virtual module nobody named and on a module outside node_modules and the repository", () => {
    assert.throws(
      () => originOf("\0other/helper.js", layout),
      /virtual module "\\u0000other\/helper\.js"/,
    )
    assert.throws(
      () => originOf(at("outside/x.js"), layout),
      /neither in node_modules nor in the repository/,
    )
  })
})

describe("licenceTexts", () => {
  it("reads every licence and notice file, sorted, with LF line ends and no blanks around, no code", () => {
    assert.deepEqual(licenceTexts(at(UTIL), "util"), [
      { file: "LICENSE-APACHE", text: "Apache" },
      { file: "NOTICE.md", text: "Util notice" },
    ])
    assert.deepEqual(licenceTexts(at("repo/spec"), "spec"), [
      { file: "LICENSE", text: "Apache License\nVersion 2.0" },
      { file: "NOTICE", text: "Some API\nCopyright Someone" },
    ])
  })

  it("fails on a work without a licence file", () => {
    assert.throws(
      () => licenceTexts(at(BARE), "bare 1.0.0"),
      /bare 1\.0\.0 .* ships no licence file/,
    )
  })

  it("fails on a work that keeps licence texts in a folder", () => {
    assert.throws(
      () =>
        licenceTexts(at("repo/node_modules/.pnpm/reuse@1.0.0/node_modules/reuse"), "reuse 1.0.0"),
      /reuse 1\.0\.0 .* keeps licence texts in the folder LICENSES: read them/,
    )
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
    assert.deepEqual(
      inventory.thirdParty.map(({ name, version, licence, bundles }) => [
        name,
        version,
        licence,
        bundles,
      ]),
      [
        ["@scope/util", "2.0.0", "Apache-2.0", ["standalone"]],
        ["bundler", "9.0.0", "MIT", ["standalone"]],
        ["left-pad", "1.3.0", "WTFPL", ["npm", "standalone"]],
        ["Some API", "1.0.1", "Apache-2.0", ["npm", "standalone"]],
      ],
    )
    assert.deepEqual(inventory.own, ["@miragon/pulse-http"])
    assert.deepEqual(inventory.installed, ["left-pad 1.3.0"])
  })

  it("names where a work comes from and what of it the bundle holds", () => {
    const { thirdParty } = inventoryOf(
      graph(
        [`${LEFT_PAD}/index.js`, "repo/apps/cli/src/generated/catalog.json"],
        ["\0bundler/runtime.js", `${UTIL}/lib/x.js`],
      ),
      layout,
    )
    assert.deepEqual(
      thirdParty.map(({ name, source, holds }) => [name, source, holds]),
      [
        ["@scope/util", "https://ex.org/u", undefined],
        ["bundler", undefined, "its runtime helpers"],
        ["left-pad", "https://github.com/left-pad/left-pad", undefined],
        ["Some API", "https://example.org/spec", "the command descriptions"],
      ],
    )
  })

  it("takes a folder entry of the embedded works for every module below it, once", () => {
    const { thirdParty, own } = inventoryOf(
      graph(
        ["repo/packages/core/ui/dist/primitives/button.js"],
        ["repo/packages/core/ui/dist/primitives/card.js"],
      ),
      layout,
    )
    assert.deepEqual(
      thirdParty.map(({ name, bundles, texts }) => [name, bundles, texts]),
      [["kit", ["npm", "standalone"], [{ file: "LICENSE.md", text: "MIT, the kit's" }]]],
    )
    assert.deepEqual(own, ["@miragon/pulse-ui"])
  })

  it("reads the licence of a package that ships none from the copy the layout names", () => {
    const { thirdParty } = inventoryOf(graph([`${BARE}/index.js`], []), layout)
    assert.deepEqual(
      thirdParty.map(({ name, texts, textsFrom }) => [name, texts, textsFrom]),
      [["bare", [{ file: "LICENSE", text: "MIT, from bare's repository" }], "bare's repository"]],
    )
    const stale = {
      ...layout,
      licenceFiles: { "left-pad@1.3.0": { dir: "licences/bare", from: "x" } },
    }
    assert.throws(
      () => inventoryOf(graph([`${LEFT_PAD}/index.js`], []), stale),
      /left-pad 1\.3\.0 .* ships a licence file now: drop its copy/,
    )
  })

  it("fails on a package of Pulse's under another licence than the artifact's", () => {
    assert.throws(
      () => inventoryOf(graph(["repo/packages/core/other/dist/index.js"], []), layout),
      {
        message:
          "@miragon/pulse-other is under ISC, not under MIT like @miragon/pulse-cli: list it as a third party",
      },
    )
  })

  it("fails on a package without a licence file and on a spec that names another licence", () => {
    const without = { ...layout, licenceFiles: {} }
    assert.throws(
      () => inventoryOf(graph([], [`${BARE}/index.js`]), without),
      /ships no licence file/,
    )
    const changed = {
      ...layout,
      embedded: { "apps/cli/src/generated/catalog.json": () => specWork("MIT License") },
    }
    assert.throws(
      () => inventoryOf(graph(["repo/apps/cli/src/generated/catalog.json"], []), changed),
      /names the licence "Apache License 2\.0", not MIT License/,
    )
  })
})

const REGENERATE = "run `pnpm third-party-licenses`"

const TEXT = {
  regenerate: "pnpm third-party-licenses",
  intro: ["Third-party licences of a CLI"],
  notes: ["Node.js is not listed."],
  artifacts: {
    "npm standalone": "the package and the image",
    npm: "the package",
    standalone: "the image",
  },
  titles: {
    works: "Works of others in the bundles:",
    own: "Pulse's own packages in the bundles:",
    installed: "Dependencies npm installs:",
  },
}

const commander = {
  name: "commander",
  version: "15.0.0",
  licence: "MIT",
  source: "https://github.com/tj/commander.js",
  holds: undefined,
  texts: [{ file: "LICENSE", text: "(The MIT License)\n\nCopyright (c) 2011 TJ Holowaychuk" }],
  bundles: ["standalone"],
}

const spec = {
  name: "Operaton REST API",
  version: "1.0.1",
  licence: "Apache-2.0",
  source: "https://github.com/operaton/operaton",
  holds: "the descriptions of the commands",
  texts: [
    { file: "LICENSE", text: "Apache License\nVersion 2.0, January 2004" },
    { file: "NOTICE", text: "Operaton\nCopyright Andreas Klein, Andreas Zill, Tim Zöller" },
  ],
  bundles: ["npm", "standalone"],
}

const INVENTORY = {
  thirdParty: [commander, spec],
  own: ["@miragon/pulse-c7-core", "@miragon/pulse-http"],
  installed: ["commander 15.0.0"],
}

const leftPad = { ...commander, name: "left-pad", version: "1.3.0", source: undefined }

describe("renderLicences", () => {
  const text = renderLicences(INVENTORY, TEXT)

  it("sums up the works in columns, then Pulse's packages, npm's dependencies and the notes", () => {
    assert.ok(
      text.startsWith(
        [
          "Third-party licences of a CLI",
          "",
          "Works of others in the bundles:",
          "",
          "  commander 15.0.0          MIT          the image",
          "  Operaton REST API 1.0.1   Apache-2.0   the package and the image",
          "",
          "Pulse's own packages in the bundles:",
          "",
          "  @miragon/pulse-c7-core",
          "  @miragon/pulse-http",
          "",
          "Dependencies npm installs:",
          "",
          "  commander 15.0.0",
          "",
          "Node.js is not listed.",
          "",
          "=".repeat(80),
        ].join("\n"),
      ),
    )
  })

  it("gives each work its facts and every licence and notice file in full", () => {
    assert.ok(
      text.includes(
        [
          "=".repeat(80),
          "Operaton REST API 1.0.1",
          "Licence: Apache-2.0",
          "In: the package and the image",
          "Holds: the descriptions of the commands",
          "Source: https://github.com/operaton/operaton",
          "",
          "--- LICENSE ---",
          "",
          "Apache License\nVersion 2.0, January 2004",
          "",
          "--- NOTICE ---",
          "",
          "Operaton\nCopyright Andreas Klein, Andreas Zill, Tim Zöller",
        ].join("\n"),
      ),
    )
    assert.ok(text.includes("commander 15.0.0\nLicence: MIT\nIn: the image\nSource:"))
    assert.ok(text.endsWith("Tim Zöller\n"))
  })

  it("names where the licence files of a work come from when it ships none", () => {
    const copied = { ...leftPad, textsFrom: "the LICENSE of its repository" }
    const listed = renderLicences({ ...INVENTORY, thirdParty: [copied] }, TEXT)
    assert.ok(
      listed.includes("In: the image\nLicence files: the LICENSE of its repository\n\n--- LICENSE"),
    )
  })

  it("leaves out the sections nothing fills, a section without a title and empty notes", () => {
    const bare = renderLicences({ thirdParty: [spec], own: [], installed: [] }, TEXT)
    assert.ok(!bare.includes("Pulse's own packages"))
    assert.ok(!bare.includes("Dependencies npm installs"))
    assert.ok(bare.includes("Node.js is not listed"))
    const untitled = { ...TEXT, notes: [], titles: { works: "Works:", own: "Own:" } }
    const quiet = renderLicences(INVENTORY, untitled)
    assert.ok(!quiet.includes("commander 15.0.0\n\n"))
    assert.ok(!quiet.includes("Node.js"))
    assert.ok(quiet.includes("  @miragon/pulse-http\n\n" + "=".repeat(80)))
  })

  it("refuses a work no bundle holds and a set of bundles that names no artifact", () => {
    assert.throws(
      () => renderLicences({ ...INVENTORY, thirdParty: [{ ...spec, bundles: [] }] }, TEXT),
      /no bundle holds it/,
    )
    const unnamed = { ...TEXT, artifacts: { npm: "the package" } }
    assert.throws(() => renderLicences(INVENTORY, unnamed), /no bundle holds it: \["standalone"\]/)
  })
})

describe("listedWorks", () => {
  it("reads the name of every work, also one with spaces, not the rules of a licence text", () => {
    const text = renderLicences(
      {
        ...INVENTORY,
        thirdParty: [
          { ...commander, texts: [{ file: "LICENSE", text: `${"=".repeat(56)}\nnot a work` }] },
          spec,
        ],
      },
      TEXT,
    )
    assert.deepEqual(listedWorks(text), ["commander", "Operaton REST API"])
  })
})

describe("licenceFindings", () => {
  const current = renderLicences(INVENTORY, TEXT)

  it("finds nothing in the file the inventory renders", () => {
    assert.deepEqual(licenceFindings(current, INVENTORY, TEXT), [])
  })

  it("names a bundled work the file does not list", () => {
    const stale = renderLicences({ ...INVENTORY, thirdParty: [spec] }, TEXT)
    assert.deepEqual(licenceFindings(stale, INVENTORY, TEXT), [
      `commander 15.0.0 is in the image, but THIRD_PARTY_LICENSES.txt does not list it: ${REGENERATE}`,
    ])
  })

  it("names a listed work no bundle holds any more", () => {
    const stale = renderLicences({ ...INVENTORY, thirdParty: [commander, leftPad, spec] }, TEXT)
    assert.deepEqual(licenceFindings(stale, INVENTORY, TEXT), [
      `THIRD_PARTY_LICENSES.txt lists left-pad, which no bundle holds any more: ${REGENERATE}`,
    ])
  })

  it("names both at once", () => {
    const stale = renderLicences({ ...INVENTORY, thirdParty: [leftPad, spec] }, TEXT)
    assert.equal(licenceFindings(stale, INVENTORY, TEXT).length, 2)
  })

  for (const [what, inventory] of [
    ["another version", { ...INVENTORY, thirdParty: [{ ...commander, version: "14.0.3" }, spec] }],
    [
      "another licence text",
      { ...INVENTORY, thirdParty: [commander, { ...spec, texts: spec.texts.slice(0, 1) }] },
    ],
    [
      "other bundles",
      { ...INVENTORY, thirdParty: [{ ...commander, bundles: ["npm", "standalone"] }, spec] },
    ],
    ["another own package", { ...INVENTORY, own: ["@miragon/pulse-http"] }],
  ]) {
    it(`finds the file out of date for ${what}`, () => {
      assert.deepEqual(licenceFindings(renderLicences(inventory, TEXT), INVENTORY, TEXT), [
        `THIRD_PARTY_LICENSES.txt is out of date: ${REGENERATE}`,
      ])
    })
  }

  it("finds a hand edit", () => {
    assert.deepEqual(
      licenceFindings(current.replace("Tim Zöller", "Tim Zoeller"), INVENTORY, TEXT),
      [`THIRD_PARTY_LICENSES.txt is out of date: ${REGENERATE}`],
    )
  })
})

describe("openApiTexts", () => {
  it("collects the summaries and descriptions of a minimum length, at any depth", () => {
    const document = {
      info: { description: "An API that is described at length here." },
      paths: {
        "/a": { get: { summary: "Short", description: "A description long enough to count." } },
      },
      tags: [{ description: "A tag whose description is long enough." }],
    }
    assert.deepEqual(openApiTexts(document, 30), [
      "An API that is described at length here.",
      "A description long enough to count.",
      "A tag whose description is long enough.",
    ])
  })
})

describe("renderedModules", () => {
  it("takes the modules that render code in a chunk, never an empty one or an asset", () => {
    const chunks = [
      {
        type: "chunk",
        moduleIds: ["/a.js", "/b.js", "\0rolldown/runtime.js", "/c.css"],
        modules: {
          "/a.js": { renderedLength: 10 },
          "/b.js": { renderedLength: 0 },
          "\0rolldown/runtime.js": { renderedLength: 3 },
          "/c.css": { renderedLength: 0 },
        },
      },
      { type: "asset", fileName: "style.css" },
    ]
    assert.deepEqual(renderedModules(chunks), ["/a.js", "\0rolldown/runtime.js"])
  })
})

describe("esbuildModules", () => {
  const metafile = {
    outputs: {
      "dist/main.js": {
        inputs: {
          "src/main.ts": { bytesInOutput: 12 },
          "../node_modules/x/index.js": { bytesInOutput: 4 },
          "src/types.ts": { bytesInOutput: 0 },
          "ns:virtual": { bytesInOutput: 2 },
        },
      },
      "dist/fonts/a.woff2": { inputs: { "../node_modules/font/a.woff2": { bytesInOutput: 9 } } },
    },
  }

  it("takes every output's inputs that hold bytes in it, from the working directory", () => {
    assert.deepEqual(esbuildModules({ metafile }, "/work/app"), [
      "/work/app/src/main.ts",
      "/work/node_modules/x/index.js",
      "\0ns:virtual",
      "/work/node_modules/font/a.woff2",
    ])
  })

  it("adds esbuild's runtime when an output declares its helpers, never for a module's own name", () => {
    const outputs = (code) => [
      { path: "/work/app/dist/main.js", text: code },
      { path: "/work/app/dist/main.css", text: "var __toESM = 1;\n" },
    ]
    const runtimeIn = (code) =>
      esbuildModules({ metafile, outputFiles: outputs(code) }, "/work/app").includes(
        ESBUILD_RUNTIME,
      )
    const helpers = "var __defProp = Object.defineProperty;\nvar __export = (target, all) => {};\n"
    assert.equal(
      esbuildModules({ metafile, outputFiles: outputs(helpers) }, "/work/app")[0],
      ESBUILD_RUNTIME,
    )
    // indented inside an IIFE, after the comment of a helper's own code
    assert.ok(
      runtimeIn(
        `(() => {\n  // a note\n  var __commonJS = (cb, mod) => {};\n  // src/main.ts\n})();\n`,
      ),
    )
    // a helper no list names, after a banner
    assert.ok(runtimeIn("import { x } from 'y';\nvar __glob = (map) => (path) => map[path];\n"))
    assert.ok(runtimeIn("var __superGet = (cls, obj, key) => 1;\n// src/main.ts\nconst a = 1;\n"))
    // a module's own names come after the comment that opens it
    assert.ok(!runtimeIn("// src/main.ts\nvar __version = 1;\nconst x = { __toESM: 1 };\n"))
    assert.ok(
      !runtimeIn("(() => {\n  // ../node_modules/x/index.js\n  var __dirname2 = 1;\n})();\n"),
    )
  })
})

describe("cssDependencies", () => {
  const UI = "repo/apps/cli/src/ui"
  const TW = "repo/node_modules/.pnpm/tw@1.0.0/node_modules/tw/index.css"
  const STYLED = "repo/node_modules/.pnpm/styled@1.0.0/node_modules/styled"

  /** The list's plugin in a build whose CSS plugin watches `watched` in its transform hook. */
  async function built(watched) {
    const { plugin, files } = cssDependencies()
    const watchedByVite = []
    const transform = {
      name: "tailwind",
      transform: {
        filter: { id: /\.css$/ },
        handler(code) {
          for (const id of watched) this.addWatchFile(id)
          return `${code} ${this.meta.name}`
        },
      },
    }
    const load = {
      name: "css",
      load(id) {
        this.addWatchFile(at("repo/missing.css"))
        return id
      },
    }
    plugin.configResolved({ plugins: [transform, load, { name: "none" }] })
    const context = { meta: { name: "ctx" }, addWatchFile: (id) => watchedByVite.push(id) }
    assert.equal(await transform.transform.handler.call(context, "a{}", "/x.css"), "a{} ctx")
    assert.deepEqual(transform.transform.filter, { id: /\.css$/ })
    assert.equal(load.load.call(context, "/y.css"), "/y.css")
    assert.equal(watchedByVite.length, watched.length + 1)
    return files
  }

  const chunk = (...ids) => ({
    type: "chunk",
    moduleIds: [at("repo/apps/cli/src/main.ts"), "\0vite/preload-helper.js", ...ids.map(at)],
    modules: {},
  })

  it("follows the chunks' stylesheets' @imports to files the build read, not one it scanned", async () => {
    const files = await built([
      at(TW),
      at(`${UI}/theme.css`),
      at(`${STYLED}/dist/styled.css`),
      at(`${UI}/scanned.css`),
      at("repo/apps/cli/src/main.ts"),
      "src/**/*.{css,ts}",
    ])
    // a package's stylesheet a module imports, with its query
    const chunks = [chunk(`${UI}/main.css`, `${STYLED}/extra.css?direct`), { type: "asset" }]
    assert.deepEqual(
      files(chunks),
      [
        `${UI}/main.css`,
        `${UI}/theme.css`,
        `${STYLED}/dist/styled.css`,
        `${STYLED}/extra.css`,
        TW,
      ].map(at),
    )
  })

  it("fails on an @import that names no file the build read", async () => {
    const files = await built([at(TW), at(`${STYLED}/dist/styled.css`)])
    assert.throws(
      () => files([chunk(`${UI}/main.css`)]),
      /main\.css imports "\.\/theme", which names no stylesheet the build read/,
    )
  })

  it("fails on a stylesheet in another language and on code Tailwind loads", async () => {
    const files = await built([])
    assert.throws(() => files([chunk(`${UI}/other.scss`)]), /other\.scss is no CSS/)
    assert.throws(() => files([chunk(`${UI}/plugin.css`)]), /plugin\.css loads code into Tailwind/)
  })
})

describe("inlinedStylesheets", () => {
  const UI = "repo/apps/cli/src/ui"
  const TW = "repo/node_modules/.pnpm/tw@1.0.0/node_modules/tw/index.css"
  const STYLED = "repo/node_modules/.pnpm/styled@1.0.0/node_modules/styled"
  const MAIN = {
    entry: at(`${UI}/main.css`),
    dependencies: [
      TW,
      `${UI}/theme.css`,
      `${STYLED}/dist/styled.css`,
      `${UI}/scanned.css`,
      "repo/apps/cli/src/main.ts",
    ].map(at),
  }
  const plugin = (...inlined) => ({ name: "tailwind", setup() {}, inlined: () => inlined })
  const entry = (path, dependencies = []) => ({
    entry: at(path),
    dependencies: dependencies.map(at),
  })

  it("follows each entry's @imports to files of its dependency list, not a source it scanned", () => {
    const sheets = [`${UI}/main.css`, `${UI}/theme.css`, `${STYLED}/dist/styled.css`, TW].map(at)
    assert.deepEqual(inlinedStylesheets([plugin(MAIN)]), sheets)
    // an entry without imports, one whose sheets another pulled in, a plugin that inlines nothing
    const extra = entry(`${STYLED}/extra.css`, [`${STYLED}/dist/styled.css`])
    assert.deepEqual(inlinedStylesheets([plugin(MAIN, extra), plugin(entry(TW)), plugin()]), [
      ...sheets.slice(0, 3),
      at(`${STYLED}/extra.css`),
      at(TW),
    ])
    assert.deepEqual(inlinedStylesheets([]), [])
  })

  it("fails on a plugin that does not say what it inlines", () => {
    assert.throws(
      () => inlinedStylesheets([plugin(MAIN), { name: "bpmn", setup() {} }]),
      /the esbuild plugin bpmn does not say what it inlines/,
    )
  })

  it("fails on an @import that names no file of the entry's own dependency list", () => {
    const theme = entry(`${UI}/theme.css`, [`${STYLED}/dist/styled.css`])
    assert.throws(
      () => inlinedStylesheets([plugin(entry(`${UI}/main.css`, [TW]), theme)]),
      /main\.css imports "\.\/theme", which names no stylesheet the build read/,
    )
  })

  it("resolves a package's subpath patterns, the longest prefix first, under any condition", () => {
    const P = "repo/node_modules/.pnpm/patterned@1.0.0/node_modules/patterned"
    const read = [`${P}/css/theme.css`, `${P}/css/deep/x.css`, `${P}/deep-dist/x.css`]
    assert.deepEqual(inlinedStylesheets([plugin(entry(`${UI}/patterned.css`, read))]), [
      at(`${UI}/patterned.css`),
      at(`${P}/css/theme.css`),
      at(`${P}/deep-dist/x.css`),
    ])
    assert.throws(
      () => inlinedStylesheets([plugin(entry(`${UI}/unmatched.css`, read))]),
      /unmatched\.css imports "patterned\/readme\.md", which names no stylesheet the build read/,
    )
  })

  it("fails on a stylesheet in another language and on code Tailwind loads", () => {
    const of = (path) => inlinedStylesheets([plugin(entry(path))])
    assert.throws(() => of(`${UI}/other.scss`), /other\.scss is no CSS/)
    assert.throws(() => of(`${UI}/plugin.css`), /plugin\.css loads code into Tailwind/)
  })
})

describe("third-party-licenses.d.mts", () => {
  it("declares exactly the module's exports, which the TypeScript of the artifacts imports", () => {
    const declarations = readFileSync(
      new URL("./third-party-licenses.d.mts", import.meta.url),
      "utf8",
    )
    const declared = [...declarations.matchAll(/^export declare (?:function|const) (\w+)/gm)].map(
      ([, name]) => name,
    )
    assert.deepEqual(declared.toSorted(), Object.keys(list).toSorted())
  })
})
