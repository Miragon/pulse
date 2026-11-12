import { describe, expect, it } from "vitest"
import type { Inventory, ThirdParty } from "./inventory.js"
import { licenceFindings, listedWorks, renderLicences } from "./render.js"

const REGENERATE = "run `pnpm --fail-if-no-match --filter @miragon/pulse-cli third-party-licenses`"

const commander: ThirdParty = {
  name: "commander",
  version: "15.0.0",
  licence: "MIT",
  source: "https://github.com/tj/commander.js",
  holds: undefined,
  texts: [{ file: "LICENSE", text: "(The MIT License)\n\nCopyright (c) 2011 TJ Holowaychuk" }],
  bundles: ["standalone"],
}

const spec: ThirdParty = {
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

const INVENTORY: Inventory = {
  thirdParty: [commander, spec],
  own: ["@miragon/pulse-c7-core", "@miragon/pulse-http"],
  installed: ["commander 15.0.0"],
}

const leftPad: ThirdParty = { ...commander, name: "left-pad", version: "1.3.0", source: undefined }

describe("renderLicences", () => {
  const text = renderLicences(INVENTORY)

  it("sums up the works in columns, then Pulse's packages and npm's dependencies", () => {
    expect(text).toContain(
      [
        "Works of others in the bundles:",
        "",
        "  commander 15.0.0          MIT          the image and the executables",
        "  Operaton REST API 1.0.1   Apache-2.0   the npm package, the image and the executables",
        "",
        "Pulse's own packages in the bundles, under the MIT licence in LICENSE:",
        "",
        "  @miragon/pulse-c7-core",
        "  @miragon/pulse-http",
        "",
        "Dependencies npm installs beside the npm package, each with its own licence:",
        "",
        "  commander 15.0.0",
      ].join("\n"),
    )
  })

  it("gives each work its facts and every licence and notice file in full", () => {
    expect(text).toContain(
      [
        "=".repeat(80),
        "Operaton REST API 1.0.1",
        "Licence: Apache-2.0",
        "In: the npm package, the image and the executables",
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
    )
    expect(text).toContain(
      "commander 15.0.0\nLicence: MIT\nIn: the image and the executables\nSource:",
    )
    expect(text.endsWith("Tim Zöller\n")).toBe(true)
  })

  it("leaves out the sections nothing fills and names Node.js as not listed", () => {
    const bare = renderLicences({ thirdParty: [spec], own: [], installed: [] })
    expect(bare).not.toContain("Pulse's own packages")
    expect(bare).not.toContain("Dependencies npm installs")
    expect(bare).toContain("Node.js is not listed")
  })

  it("refuses a work no bundle holds", () => {
    expect(() => renderLicences({ ...INVENTORY, thirdParty: [{ ...spec, bundles: [] }] })).toThrow(
      "no bundle holds it",
    )
  })
})

describe("listedWorks", () => {
  it("reads the name of every work, also one with spaces, not the rules of a licence text", () => {
    const text = renderLicences({
      ...INVENTORY,
      thirdParty: [
        { ...commander, texts: [{ file: "LICENSE", text: `${"=".repeat(56)}\nnot a work` }] },
        spec,
      ],
    })
    expect(listedWorks(text)).toEqual(["commander", "Operaton REST API"])
  })
})

describe("licenceFindings", () => {
  const current = renderLicences(INVENTORY)

  it("finds nothing in the file the inventory renders", () => {
    expect(licenceFindings(current, INVENTORY)).toEqual([])
  })

  it("names a bundled work the file does not list", () => {
    const stale = renderLicences({ ...INVENTORY, thirdParty: [spec] })
    expect(licenceFindings(stale, INVENTORY)).toEqual([
      `commander 15.0.0 is in the image and the executables, but THIRD_PARTY_LICENSES.txt does not list it: ${REGENERATE}`,
    ])
  })

  it("names a listed work no bundle holds any more", () => {
    const stale = renderLicences({ ...INVENTORY, thirdParty: [commander, leftPad, spec] })
    expect(licenceFindings(stale, INVENTORY)).toEqual([
      `THIRD_PARTY_LICENSES.txt lists left-pad, which no bundle holds any more: ${REGENERATE}`,
    ])
  })

  it("names both at once", () => {
    const stale = renderLicences({ ...INVENTORY, thirdParty: [leftPad, spec] })
    expect(licenceFindings(stale, INVENTORY)).toHaveLength(2)
  })

  it.each([
    ["another version", { ...INVENTORY, thirdParty: [{ ...commander, version: "14.0.3" }, spec] }],
    [
      "another licence text",
      { ...INVENTORY, thirdParty: [commander, { ...spec, texts: spec.texts.slice(0, 1) }] },
    ],
    [
      "other bundles",
      {
        ...INVENTORY,
        thirdParty: [{ ...commander, bundles: ["npm", "standalone"] as const }, spec],
      },
    ],
    ["another own package", { ...INVENTORY, own: ["@miragon/pulse-http"] }],
  ])("finds the file out of date for %s", (_, inventory: Inventory) => {
    expect(licenceFindings(renderLicences(inventory), INVENTORY)).toEqual([
      `THIRD_PARTY_LICENSES.txt is out of date: ${REGENERATE}`,
    ])
  })

  it("finds a hand edit", () => {
    expect(licenceFindings(current.replace("Tim Zöller", "Tim Zoeller"), INVENTORY)).toEqual([
      `THIRD_PARTY_LICENSES.txt is out of date: ${REGENERATE}`,
    ])
  })
})
