import { readdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs"
import { join, relative } from "node:path"
import { fileURLToPath } from "node:url"
import { beforeAll, describe, expect, it } from "vitest"
import {
  type Inventory,
  inventoryOf,
  type Layout,
  licenceFindings,
  type LicenceFileText,
  openApiTexts,
  openApiWork,
  renderLicences,
} from "../../../../../scripts/third-party-licenses.mjs"

/**
 * THIRD_PARTY_LICENSES.txt, which the tarball ships beside LICENSE (README.md, "License"): what
 * the generated SDK holds of works of others, read from the files `pnpm generate` writes into
 * src/generated (tsc compiles them into dist/generated). The SDK's descriptions are the texts of
 * the Operaton REST API's OpenAPI document (Apache-2.0), its client runtime (client/, core/) is a
 * copy of the fetch client @hey-api/openapi-ts ships (MIT), and openapi-ts writes comments of its
 * own into client.gen.ts and sdk.gen.ts. Every source the tarball ships is scanned for both
 * kinds of text, so neither reaches a file the list does not name. The licence list's planted
 * cases are in scripts/third-party-licenses.test.mjs of the repository. With
 * THIRD_PARTY_LICENSES_UPDATE=1 (`pnpm --fail-if-no-match --filter @miragon/pulse-c7-client
 * third-party-licenses`) the test writes the file instead.
 */

const PACKAGE = realpathSync(fileURLToPath(new URL("..", import.meta.url)))
const REPO = join(PACKAGE, "../../../..")
const GENERATED = join(PACKAGE, "src/generated")
const LICENCES_FILE = join(PACKAGE, "THIRD_PARTY_LICENSES.txt")
const SPEC_DIR = join(REPO, "packages/connectors/c7/c7-core/spec")
const HEY_API = realpathSync(join(PACKAGE, "node_modules/@hey-api/openapi-ts"))

/** What the SDK holds of openapi-ts (its fetch client, its comments), as a module of its graph. */
const CLIENT_COPY = "\0@hey-api/openapi-ts/clients"

/** The generated files that carry the spec's texts, by their paths in the package. */
const SPEC_CARRIERS = ["src/generated/sdk.gen.ts", "src/generated/types.gen.ts"]

/** The generated files outside client/ and core/ that carry comments openapi-ts writes. */
const HEY_API_CARRIERS = ["client.gen.ts", "sdk.gen.ts"]

const specWork = () =>
  openApiWork({
    dir: SPEC_DIR,
    spec: "api.json",
    licence: "Apache-2.0",
    licenceName: "Apache License 2.0",
    // Apache-2.0 section 4(b): say that they are changed
    holds:
      "the descriptions of the operations, parameters and types of the generated SDK " +
      "(src/generated/sdk.gen.ts and types.gen.ts, and what tsc compiles of them into " +
      "dist/generated), taken from its OpenAPI specification and changed by Miragon GmbH: " +
      "packages/connectors/c7/c7-core/spec/patches.json corrects some of them",
    source:
      "https://github.com/operaton/operaton (engine-rest/engine-rest-openapi), by way of " +
      "https://github.com/operaton/operaton-mcp (resources/operaton-rest-api.json)",
  })

const LAYOUT: Layout = {
  repo: REPO,
  home: PACKAGE,
  bundles: ["sdk"],
  virtual: {
    [CLIENT_COPY]: {
      dir: HEY_API,
      holds:
        "its fetch client, which openapi-ts copies into the SDK as src/generated/client and " +
        "src/generated/core, and the comments it writes into src/generated/client.gen.ts and " +
        "sdk.gen.ts (tsc compiles them into dist/generated)",
    },
  },
  embedded: Object.fromEntries(
    SPEC_CARRIERS.map((path) => [`packages/connectors/c7/c7-client/${path}`, specWork]),
  ),
}

const TEXT: LicenceFileText = {
  regenerate: "pnpm --fail-if-no-match --filter @miragon/pulse-c7-client third-party-licenses",
  intro: [
    "Third-party licences of @miragon/pulse-c7-client",
    "",
    "The npm package @miragon/pulse-c7-client holds Miragon's own code, under the MIT licence in",
    "LICENSE, and the SDK @hey-api/openapi-ts generates from the OpenAPI document of the Operaton",
    "REST API, which holds the works listed here, each under its own licence.",
    "packages/connectors/c7/c7-client/src/third-party-licenses.test.ts of",
    "https://github.com/Miragon/pulse writes this file from the generated SDK: src/generated,",
    "which tsc compiles into dist/generated.",
  ],
  notes: [],
  artifacts: { sdk: "the generated SDK" },
  titles: {
    works: "Works of others in the SDK:",
    own: "Pulse's own packages in the SDK, under the MIT licence in LICENSE:",
  },
}

/** Every file below `dir`, relative to it, with forward slashes. */
const filesBelow = (dir: string): string[] =>
  readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relative(dir, join(entry.parentPath, entry.name)).replaceAll("\\", "/"))
    .sort()

/** Every file of the generated SDK, relative to src/generated. */
const generatedFiles = (): string[] => filesBelow(GENERATED)

/** What the tarball leaves out of src (package.json's `files`), as patterns of paths below it. */
const NOT_SHIPPED: Readonly<Record<string, RegExp>> = {
  "!src/**/*.test.*": /(?:^|\/)[^/]*\.test\.[^/]*$/,
  "!src/**/*.test-support.*": /(?:^|\/)[^/]*\.test-support\.[^/]*$/,
  "!src/**/test-support": /(?:^|\/)test-support\//,
  "!src/**/tsconfig.json": /(?:^|\/)tsconfig\.json$/,
}

/** Every source the tarball ships, relative to the package: what tsc compiles into dist, too. */
const shippedSources = (): string[] =>
  filesBelow(join(PACKAGE, "src"))
    .filter((file) => Object.values(NOT_SHIPPED).every((pattern) => !pattern.test(file)))
    .map((file) => `src/${file}`)

/** openapi-ts's fetch client and its core, as it copies them into the SDK's client/ and core/. */
const TEMPLATE_DIRS: Readonly<Record<string, string>> = { client: "fetch", core: "core" }

/** The templates of every client openapi-ts ships, by their paths in its package. */
const TEMPLATES = join(HEY_API, "dist/clients")

/** A generated file of client/ or core/, which openapi-ts copies from its templates. */
const isTemplateCopy = (file: string): boolean =>
  file.includes("/") && TEMPLATE_DIRS[file.split("/")[0] ?? ""] !== undefined

/** A generated file of client/ or core/ as its template reads: no header, no .gen.js specifiers. */
const asTemplate = (code: string): string =>
  code
    .replace(/^\/\/ This file is auto-generated by @hey-api\/openapi-ts\n\n/, "")
    .replaceAll(/(from '[^']+)\.gen\.js'/g, "$1'")

/** The lines of a file's doc comments, 30 characters or longer, without their stars. */
const docLines = (code: string): string[] =>
  [...code.matchAll(/\/\*\*[\s\S]*?\*\//g)].flatMap(([comment]) =>
    comment
      .split("\n")
      .map((line) => line.replace(/^\s*(?:\/\*\*|\*\/|\*)?\s?/, "").replace(/\s*\*\/$/, ""))
      .filter((line) => line.length >= 30),
  )

/** The strings openapi-ts's code writes into the files it generates (doc comments among them). */
function heyApiStrings(): Set<string> {
  const code = readdirSync(join(HEY_API, "dist"))
    .filter((file) => file.endsWith(".mjs"))
    .map((file) => readFileSync(join(HEY_API, "dist", file), "utf8"))
    .join("\n")
  return new Set([...code.matchAll(/"((?:[^"\\\n]|\\.)*)"/g)].map(([, text = ""]) => text))
}

/**
 * The SDK's module graph: a file of client/ or core/ is a copy of openapi-ts's fetch client
 * (which must equal its template), every other file is the package's own, and one that carries
 * openapi-ts's comments holds that work, too.
 */
function sdkModules(): string[] {
  return generatedFiles().flatMap((file) => {
    if (!isTemplateCopy(file)) {
      return [join(GENERATED, file), ...(HEY_API_CARRIERS.includes(file) ? [CLIENT_COPY] : [])]
    }
    const [folder = "", name = ""] = file.split("/")
    const template = join(
      TEMPLATES,
      TEMPLATE_DIRS[folder] ?? "",
      name.replace(/(\.gen)?\.ts$/, ".ts"),
    )
    const copied = readFileSync(join(GENERATED, file), "utf8")
    expect(asTemplate(copied), `src/generated/${file} is no copy of ${template}`).toBe(
      readFileSync(template, "utf8"),
    )
    return [CLIENT_COPY]
  })
}

describe("THIRD_PARTY_LICENSES.txt", () => {
  let inventory: Inventory

  beforeAll(() => {
    inventory = inventoryOf({ sdk: sdkModules() }, LAYOUT)
  })

  it("lists exactly the works of others the generated SDK holds, with their licence files", () => {
    if (process.env.THIRD_PARTY_LICENSES_UPDATE === "1") {
      expect(process.env.CI, "the file is written locally, never in CI").toBeUndefined()
      writeFileSync(LICENCES_FILE, renderLicences(inventory, TEXT))
    }
    expect(licenceFindings(readFileSync(LICENCES_FILE, "utf8"), inventory, TEXT)).toEqual([])
    expect(inventory.thirdParty.map(({ name, licence }) => `${name} ${licence}`)).toEqual([
      "@hey-api/openapi-ts MIT",
      "Operaton REST API Apache-2.0",
    ])
  })

  it("fails while it misses a work the SDK holds, or lists one the SDK holds no more", () => {
    const [heyApi, spec] = inventory.thirdParty
    const without = { ...inventory, thirdParty: [heyApi].filter((work) => work !== undefined) }
    const regenerate = `run \`${TEXT.regenerate}\``
    expect(licenceFindings(renderLicences(without, TEXT), inventory, TEXT)).toEqual([
      `Operaton REST API ${spec?.version ?? ""} is in the generated SDK, but THIRD_PARTY_LICENSES.txt does not list it: ${regenerate}`,
    ])
    expect(licenceFindings(renderLicences(inventory, TEXT), without, TEXT)).toEqual([
      `THIRD_PARTY_LICENSES.txt lists Operaton REST API, which no bundle holds any more: ${regenerate}`,
    ])
  })

  it("takes a file of client/ or core/ for openapi-ts's own only while it equals the template", () => {
    const generated =
      "// This file is auto-generated by @hey-api/openapi-ts\n\nimport { a } from '../core/auth.gen.js';\n"
    expect(asTemplate(generated)).toBe("import { a } from '../core/auth';\n")
    expect(asTemplate(`${generated}export const changed = 1;\n`)).not.toBe(
      "import { a } from '../core/auth';\n",
    )
  })

  it("finds the spec's texts only in the files that name the spec, of all it ships", () => {
    const spec: unknown = JSON.parse(readFileSync(join(SPEC_DIR, "api.json"), "utf8"))
    // each text as it is and as a JSON or TypeScript string holds it
    const texts = new Set(
      openApiTexts(spec, 40).flatMap((text) => [text, JSON.stringify(text).slice(1, -1)]),
    )
    const carriers = shippedSources().filter((file) => {
      const code = readFileSync(join(PACKAGE, file), "utf8")
      return [...texts].some((text) => code.includes(text))
    })
    expect(carriers).toEqual(SPEC_CARRIERS)
  })

  it("finds openapi-ts's own comments only in the files that name it", () => {
    const strings = heyApiStrings()
    const carriers = generatedFiles()
      .filter((file) => !isTemplateCopy(file))
      .filter((file) =>
        docLines(readFileSync(join(GENERATED, file), "utf8")).some((line) => strings.has(line)),
      )
    expect(carriers).toEqual(HEY_API_CARRIERS)
  })

  it("reads the lines of doc comments as openapi-ts's code writes them", () => {
    const comment =
      "  /**\n   * A line of a doc comment, long enough to count.\n   * Too short.\n   */\n"
    expect(docLines(comment)).toEqual(["A line of a doc comment, long enough to count."])
    expect(heyApiStrings()).toContain(
      "You can provide a client instance returned by `createClient()` instead of",
    )
  })

  it("takes no file outside client/ and core/ for the package's own while it copies a template", () => {
    const templates = new Set(
      filesBelow(TEMPLATES).map((file) => readFileSync(join(TEMPLATES, file), "utf8")),
    )
    const copies = generatedFiles().filter(
      (file) =>
        !isTemplateCopy(file) &&
        templates.has(asTemplate(readFileSync(join(GENERATED, file), "utf8"))),
    )
    expect(copies).toEqual([])
  })

  it("scans what the tarball ships of src, as package.json's files leave it out", () => {
    const manifest = JSON.parse(readFileSync(join(PACKAGE, "package.json"), "utf8")) as {
      readonly files: readonly string[]
    }
    expect(manifest.files.filter((entry) => entry.startsWith("!src/"))).toEqual(
      Object.keys(NOT_SHIPPED),
    )
    expect(shippedSources()).toEqual(
      expect.arrayContaining(["src/client.ts", "src/sdk-reads/reads.ts", ...SPEC_CARRIERS]),
    )
    expect(shippedSources().filter((file) => /test/.test(file))).toEqual([])
  })

  it("ships beside LICENSE in the tarball", () => {
    const manifest = JSON.parse(readFileSync(join(PACKAGE, "package.json"), "utf8")) as {
      readonly files: readonly string[]
    }
    expect(manifest.files).toContain("THIRD_PARTY_LICENSES.txt")
  })
})
