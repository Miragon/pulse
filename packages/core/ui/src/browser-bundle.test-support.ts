/// <reference types="node" />
import { readFileSync } from "node:fs"
import {
  BROWSER_ENTRIES,
  type BrowserBundle,
  buildBrowserBundle,
} from "../scripts/browser-bundle.mjs"

/**
 * The browser bundle as its suites build it (scripts/browser-bundle.mjs): every shipped entry and,
 * beside them, the probe of the kit's modules (browser-probe.test-support.tsx), the stand-in for a
 * later entry of the package.
 */

export const PROBE = "probe.js"
export const PROBE_SOURCE = "./src/browser-probe.test-support.tsx"

/** The files the npm package ships in dist/browser/: every file the build wrote but the probe's. */
export const shipped = (bundle: BrowserBundle): string[] =>
  Object.keys(bundle.files).filter((file) => file !== PROBE)

export const suiteBundle = (): Promise<BrowserBundle> =>
  buildBrowserBundle({ entries: { ...BROWSER_ENTRIES, [PROBE]: PROBE_SOURCE } })

/** The bundle's gzip ceilings, bytes per shipped file (shrink-only, scripts/check-ratchets.mjs). */
export const BUDGET = JSON.parse(
  readFileSync(new URL("../test/__golden__/bundle-budget.json", import.meta.url), "utf8"),
) as Readonly<Record<string, number | string>>

/** A build output's inputs, as its metafile names them (relative to the package). */
export function inputsOf(bundle: BrowserBundle, file: string): string[] {
  const result = bundle.results[file]
  if (result === undefined) throw new Error(`the bundle built no ${file}`)
  return Object.values(result.metafile.outputs).flatMap((output) => Object.keys(output.inputs))
}

/** The files a build output imports (external ones: the bundle's other files), each once. */
export function importsOf(bundle: BrowserBundle, file: string): string[] {
  const result = bundle.results[file]
  if (result === undefined) throw new Error(`the bundle built no ${file}`)
  const imports = Object.values(result.metafile.outputs).flatMap((output) =>
    output.imports.filter((each) => each.external === true).map((each) => each.path),
  )
  return [...new Set(imports)]
}
