/** The declarations of browser-bundle.mjs, which the package's suites read. */
import type { BuildResult } from "esbuild"

export declare const PACKAGE: string
export declare const BUNDLE: "claude-artifact.js"
export declare const ENTRIES: readonly string[]
export declare const SHARED_MODULES: readonly string[]
export declare const SHARED_NAMESPACE: "widget-shell-shared"
export declare const RUNTIME: "pulse-ui.js"

/** pulse-ui's installed package, which the bundle imports React and the kit from. */
export interface PulseUiRuntime {
  /** Its browser bundle's folder (dist/browser). */
  readonly dir: string
  readonly version: string
  /** The import the bundle names pulse-ui.js by: `../../../pulse-ui@<version>/dist/browser/pulse-ui.js`. */
  readonly specifier: string
}

export interface BrowserBundle {
  /** The file's name and text: claude-artifact.js. */
  readonly files: Readonly<Record<string, string>>
  /** esbuild's result (`metafile`, `outputFiles`). */
  readonly result: BuildResult<{ metafile: true; write: false }>
  readonly runtime: PulseUiRuntime
}

export interface BrowserBundleOptions {
  /** Default true; false keeps the modules' comments, as the licence list reads them. */
  readonly minify?: boolean
  /** The modules the bundle exports every name of; default `ENTRIES`. */
  readonly entries?: readonly string[]
}

/** pulse-ui's installed package; throws unless its version is this package's. */
export declare function pulseUiRuntime(): PulseUiRuntime
export declare function buildBrowserBundle(options?: BrowserBundleOptions): Promise<BrowserBundle>
export declare function writeBrowserBundle(outdir: string): Promise<string[]>
