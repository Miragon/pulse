import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { gzipSync } from "node:zlib"
import { beforeAll, describe, expect, it } from "vitest"
import {
  BUNDLE,
  type BrowserBundle,
  buildBrowserBundle,
  PACKAGE,
  RUNTIME,
  SHARED_MODULES,
  SHARED_NAMESPACE,
} from "../scripts/browser-bundle.mjs"

/**
 * The browser bundle (scripts/browser-bundle.mjs) as the npm package ships it in dist/browser/:
 * the names claude-artifact.js exports, its one import (pulse-ui.js beside it on a CDN, by this
 * release's version), that it holds neither React nor the kit, nothing of a chat's runtime, an MCP
 * client or a recording, and its gzip ceiling (test/__golden__/bundle-budget.json).
 * browser-page.test.ts renders a page over it.
 */

const BUILD = { timeout: 60_000 }
let bundle: BrowserBundle

beforeAll(async () => {
  bundle = await buildBrowserBundle()
}, 60_000)

const text = () => bundle.files[BUNDLE] ?? ""

/** What the metafile says of the one file the build wrote. */
function output() {
  const [meta] = Object.values(bundle.result.metafile.outputs)
  if (meta === undefined) throw new Error(`the build wrote no ${BUNDLE}`)
  return meta
}

/** The modules the file holds code of (relative to the package), each once. */
const inputs = () =>
  Object.entries(output().inputs)
    .filter(([, input]) => input.bytesInOutput > 0)
    .map(([path]) => path)

/** React's, ReactDOM's and the kit's own modules, wherever pnpm keeps them. */
const SHARED_CODE =
  /(?:node_modules\/(?:\.pnpm\/[^/]+\/node_modules\/)?(?:react|react-dom|scheduler|@miragon\/pulse-ui)\/|packages\/core\/ui\/)/

const readVersion = (dir: string) =>
  (JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as { version: string }).version

describe("claude-artifact.js", () => {
  it("exports every name of the page reads and of the Claude artifact's entry, and no other", () => {
    // A name added here is a promise to every page that loads the module, a name dropped a
    // breaking change: either is a decision made in review.
    expect([...output().exports].sort()).toEqual([
      "ARTIFACT_PAGE_HINTS",
      "CLAUDE_RUNTIME_CODES",
      "PageCallError",
      "PageGate",
      "claudeToolCaller",
      "createPageReader",
      "describePageFailure",
      "mountClaudeArtifact",
      "usePageReads",
      "useSectionRead",
    ])
  })

  it("imports pulse-ui.js only, beside it on jsDelivr and unpkg, by this release's version", () => {
    const version = readVersion(PACKAGE)
    expect(readVersion(join(bundle.runtime.dir, "..", ".."))).toBe(version)
    const specifier = `../../../pulse-ui@${version}/dist/browser/${RUNTIME}`
    expect(bundle.runtime.specifier).toBe(specifier)
    const imports = output().imports
    expect(imports.length).toBeGreaterThan(0)
    expect(new Set(imports.map(({ path, external }) => `${path} ${String(external)}`))).toEqual(
      new Set([`${specifier} true`]),
    )
    for (const cdn of ["https://cdn.jsdelivr.net/npm/", "https://unpkg.com/"]) {
      const at = `${cdn}@miragon/pulse-widget-shell@${version}/dist/browser/${BUNDLE}`
      expect(new URL(specifier, at).href).toBe(
        `${cdn}@miragon/pulse-ui@${version}/dist/browser/${RUNTIME}`,
      )
    }
  })

  it("holds no React, no ReactDOM and no copy of the kit: each comes as pulse-ui.js's", () => {
    expect(inputs().filter((input) => SHARED_CODE.test(input))).toEqual([])
    // What it imports of React and the kit, each through a module that stands for pulse-ui.js.
    const shared = inputs()
      .filter((input) => input.startsWith(`${SHARED_NAMESPACE}:`))
      .map((input) => input.slice(SHARED_NAMESPACE.length + 1))
    expect(shared.filter((id) => !SHARED_MODULES.includes(id))).toEqual([])
    expect(shared).toEqual(
      expect.arrayContaining(["react", "react/jsx-runtime", "@miragon/pulse-ui"]),
    )
    // React's internals and a slot only the kit renders.
    expect(text()).not.toContain("__CLIENT_INTERNALS_DO_NOT_USE")
    expect(text()).not.toContain('"section-state"')
    expect(text()).not.toMatch(/\brequire\(/)
  })

  it("holds TanStack Query once, and nothing of a chat's runtime, an MCP client, a Node module or a recording", () => {
    const held = inputs()
    expect(
      held.filter((input) => input.endsWith("query-core/build/modern/queryClient.js")),
    ).toHaveLength(1)
    expect(held.filter((input) => input.includes("@tanstack/react-query/"))).not.toEqual([])
    expect(
      held.filter((input) =>
        /@modelcontextprotocol|\/zod\/|^node:|ext-apps-host|view-runtime/.test(input),
      ),
    ).toEqual([])
    expect(held).not.toContain("src/ui/recording.ts")
    for (const literal of ["ui/initialize", "jsonrpc", "mcp-session-id", "No recorded answer"]) {
      expect(text(), literal).not.toContain(literal)
    }
  })

  it("fails the build on a name pulse-ui.js does not export", BUILD, async () => {
    const dir = mkdtempSync(join(tmpdir(), "widget-shell-browser-bundle-"))
    try {
      const planted = join(dir, "planted.ts")
      writeFileSync(
        planted,
        'import { useNoSuchHook } from "react"\nexport const hook = useNoSuchHook\n',
      )
      await expect(buildBrowserBundle({ entries: [planted] })).rejects.toThrow(
        /No matching export in "widget-shell-shared:react" for import "useNoSuchHook"/,
      )
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe("the bundle's size (test/__golden__/bundle-budget.json)", () => {
  const budget = JSON.parse(
    readFileSync(new URL("./__golden__/bundle-budget.json", import.meta.url), "utf8"),
  ) as Readonly<Record<string, number | string>>
  const ceilings = Object.entries(budget).filter(
    (entry): entry is [string, number] => !entry[0].startsWith("$") && typeof entry[1] === "number",
  )

  it("has a ceiling for each file the package ships, and none for another", () => {
    expect(ceilings.map(([file]) => file).sort()).toEqual(Object.keys(bundle.files).sort())
  })

  it("stays within each ceiling, and lowers one it fell well below", BUILD, () => {
    const sizes = ceilings.map(([file, ceiling]) => {
      const gzip = gzipSync(bundle.files[file] ?? "").length
      return { file, ceiling, gzip }
    })
    // In CI the job's summary shows each size beside its ceiling.
    const summary = process.env.GITHUB_STEP_SUMMARY
    if (summary) {
      const rows = sizes.map(({ file, gzip, ceiling }) => `| ${file} | ${gzip} | ${ceiling} |`)
      const table = ["| File | Gzip bytes | Ceiling |", "| --- | --- | --- |", ...rows]
      appendFileSync(
        summary,
        `\n### @miragon/pulse-widget-shell dist/browser\n\n${table.join("\n")}\n`,
      )
    }
    for (const { file, gzip, ceiling } of sizes) {
      expect(
        gzip,
        `${file} is ${String(gzip)} bytes gzip, over its ceiling: shrink it, or raise the ceiling in test/__golden__/bundle-budget.json with a Ratchet-Exception trailer that says why`,
      ).toBeLessThanOrEqual(ceiling)
      expect(
        gzip,
        `${file} is ${String(gzip)} bytes gzip, well below its ceiling of ${String(ceiling)}: lower the ceiling to about ${String(Math.ceil((gzip * 1.02) / 100) * 100)}`,
      ).toBeGreaterThan(ceiling * 0.9)
    }
  })
})
