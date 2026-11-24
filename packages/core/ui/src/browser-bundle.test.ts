/// <reference types="node" />
import { appendFileSync, readFileSync } from "node:fs"
import { gzipSync } from "node:zlib"
import * as lucide from "lucide-react"
import { beforeAll, describe, expect, it } from "vitest"
import type { BrowserBundle } from "../scripts/browser-bundle.mjs"
import { compileStylesheet, RUNTIME, sharedNames, STYLESHEET } from "../scripts/browser-bundle.mjs"
import {
  BUDGET,
  importsOf,
  inputsOf,
  PROBE,
  PROBE_SOURCE,
  shipped,
  suiteBundle,
} from "./browser-bundle.test-support.js"
import * as probe from "./browser-probe.test-support.js"
import * as ui from "./index.js"
import { stylesheetShapeFindings } from "./testing/index.js"

/**
 * The browser bundle (scripts/browser-bundle.mjs) as the npm package ships it in dist/browser/:
 * what pulse-ui.js exports, that React is in it once and every other entry takes React and the
 * kit's modules from it, the stylesheet's shape, and each file's gzip ceiling
 * (test/__golden__/bundle-budget.json). browser-page.test.ts renders a page over it.
 */

const BUILD = { timeout: 60_000 }
let bundle: BrowserBundle

beforeAll(async () => {
  bundle = await suiteBundle()
}, 60_000)

/** React and ReactDOM's own modules, wherever pnpm keeps them. */
const REACT_CODE = /node_modules\/(?:\.pnpm\/[^/]+\/node_modules\/)?(?:react|react-dom|scheduler)\//

const SOURCE = "scripts/browser-bundle.css"
const sourceCss = readFileSync(new URL(`../${SOURCE}`, import.meta.url), "utf8")

describe("pulse-ui.js", () => {
  it(
    "exports the root entry's names, React's and ReactDOM's public names and React and ReactDOM",
    BUILD,
    () => {
      const shared = Object.values(sharedNames()).flat()
      const expected = [...new Set([...Object.keys(ui), ...shared, "React", "ReactDOM"])].sort()
      expect([...bundle.runtimeExports].sort()).toEqual(expected)
      // A kit name equal to a React name would be shadowed by it: none is.
      expect(Object.keys(ui).filter((name) => shared.includes(name))).toEqual([])
      expect(shared).toEqual(
        expect.arrayContaining(["createElement", "createRoot", "jsx", "useState"]),
      )
      expect(shared.filter((name) => name.startsWith("__"))).toEqual([])
    },
  )

  it("holds React once and imports nothing: one ES module", BUILD, () => {
    const inputs = inputsOf(bundle, RUNTIME)
    expect(inputs.filter((input) => /react\/cjs\/react\.production\.js$/.test(input))).toHaveLength(
      1,
    )
    expect(inputs.some((input) => input.includes("react.development"))).toBe(false)
    expect(importsOf(bundle, RUNTIME)).toEqual([])
    expect(bundle.files[RUNTIME]).not.toMatch(/\brequire\(/)
  })
})

describe("the entries beside pulse-ui.js", () => {
  it(
    "take React, ReactDOM and the kit's modules from ./pulse-ui.js and bundle no copy",
    BUILD,
    () => {
      for (const file of Object.keys(bundle.results).filter((name) => name !== RUNTIME)) {
        const inputs = inputsOf(bundle, file)
        expect(
          inputs.filter((input) => REACT_CODE.test(input)),
          file,
        ).toEqual([])
        expect(importsOf(bundle, file), file).toEqual([`./${RUNTIME}`])
      }
    },
  )

  it("lucide.js: every icon lucide-react exports, by its names", BUILD, () => {
    const exports = Object.values(bundle.results["lucide.js"]?.metafile.outputs ?? {}).flatMap(
      (output) => output.exports,
    )
    // `default` is the test runner's interop for an ES module, which lucide-react has none of.
    expect(exports.sort()).toEqual(
      Object.keys(lucide)
        .filter((name) => name !== "default")
        .sort(),
    )
  })

  it(
    "an entry of the package takes the kit's modules it imports by path from pulse-ui.js",
    BUILD,
    () => {
      // Its names, as its source exports them.
      const outputs = Object.values(bundle.results[PROBE]?.metafile.outputs ?? {})
      expect(outputs.flatMap((output) => output.exports)).toEqual(Object.keys(probe))
      const inputs = inputsOf(bundle, PROBE)
      // Its own source only: the locale context and the button come as pulse-ui.js's.
      expect(inputs.filter((input) => input.startsWith("src/"))).toEqual([PROBE_SOURCE.slice(2)])
      expect(inputs.filter((input) => input.startsWith("pulse-ui-kit:")).sort()).toEqual([
        "pulse-ui-kit:src/locale/locale-provider.tsx",
        "pulse-ui-kit:src/primitives/button.tsx",
      ])
      expect(inputs.filter((input) => input.startsWith("pulse-ui-shared:")).sort()).toEqual([
        "pulse-ui-shared:react",
        "pulse-ui-shared:react/jsx-runtime",
      ])
    },
  )
})

describe("pulse-ui.css", () => {
  it("its entry keeps a page stylesheet's shape: no height floor, no forced or inlined font, no colour of its own", () => {
    expect(stylesheetShapeFindings(sourceCss, SOURCE)).toEqual([])
  })

  it(
    "adds no colour and no shape of its own to the theme it compiles: the kit's classes and the layout utilities use roles only",
    BUILD,
    async () => {
      // What Tailwind's base and the theme compile to alone: the vendored tokens and Tailwind's
      // own resets, the findings a compiled theme carries anyway.
      const theme = await compileStylesheet(
        '@import "tailwindcss" source(none);\n@import "../src/theme.css";\n',
      )
      const matches = (css: string) =>
        new Set(
          stylesheetShapeFindings(css, STYLESHEET).map((finding) => finding.replace(/^[^ ]+ /, "")),
        )
      const extra = [...matches(bundle.files[STYLESHEET] ?? "")].filter(
        (m) => !matches(theme).has(m),
      )
      expect(extra).toEqual([])
    },
  )

  it("holds every class the kit renders and the documented layout utilities", () => {
    const css = bundle.files[STYLESHEET] ?? ""
    for (const rule of [
      ".bg-card{",
      ".text-dense{",
      ".tabular-nums{",
      ".truncate{",
      ".gap-gutter{",
      ".p-gutter{",
      ".sm\\:grid-cols-2{",
      ".lg\\:grid-cols-4{",
      ".lg\\:flex-row{",
      ".lg\\:col-span-2{",
      ".max-w-7xl{",
      ".text-muted-foreground{",
    ]) {
      expect(css, rule).toContain(rule)
    }
    // Never a palette class: the brand gates' fixtures in src/testing stay out.
    expect(css).not.toMatch(/\.(?:bg|text|border)-(?:red|blue|green|zinc|slate|gray)-\d/)
    // The OS's dark mode, the theme's rule: a page needs no script for it.
    expect(css).toContain("@media (prefers-color-scheme:dark)")
  })
})

describe("the bundle's size (test/__golden__/bundle-budget.json)", () => {
  const ceilings = Object.entries(BUDGET).filter(
    (entry): entry is [string, number] => !entry[0].startsWith("$") && typeof entry[1] === "number",
  )

  it("has a ceiling for each file the package ships, and none for another", () => {
    expect(ceilings.map(([file]) => file).sort()).toEqual(shipped(bundle).sort())
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
      appendFileSync(summary, `\n### @miragon/pulse-ui dist/browser\n\n${table.join("\n")}\n`)
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
