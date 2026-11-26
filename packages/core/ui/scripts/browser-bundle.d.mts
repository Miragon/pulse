/** The declarations of browser-bundle.mjs, which the package's suites read. */
import type { BuildResult } from "esbuild"

export declare const PACKAGE: string
export declare const RUNTIME: "pulse-ui.js"
export declare const STYLESHEET: "pulse-ui.css"
/** The module whose import puts the stylesheet into the page as one `<style>`. */
export declare const STYLESHEET_MODULE: "pulse-ui-css.js"
/** The attribute that marks that `<style>`; its value is the package's version. */
export declare const STYLESHEET_MARK: "data-pulse-ui"
export declare const BROWSER_ENTRIES: Readonly<Record<string, string>>
export declare const SHARED_MODULES: readonly string[]
/** lucide-react's context module, which pulse-ui.js shares with every entry beside it. */
export declare const LUCIDE_CONTEXT: "lucide-react/dist/esm/context.mjs"

/** The Tailwind entry the stylesheet compiles, with the files Tailwind read for it. */
export interface InlinedStylesheetPlugin {
  readonly name: string
  readonly inlined: () => { entry: string; dependencies: string[] }[]
}

export interface BrowserBundle {
  /**
   * Each file's name and text: pulse-ui.js, every entry of `entries`, pulse-ui.css and
   * pulse-ui-css.js.
   */
  readonly files: Readonly<Record<string, string>>
  /** Each script's esbuild result (`metafile`, `outputFiles`), keyed by its file name. */
  readonly results: Readonly<Record<string, BuildResult<{ metafile: true; write: false }>>>
  /** The names pulse-ui.js exports. */
  readonly runtimeExports: readonly string[]
  readonly stylesheet: InlinedStylesheetPlugin
}

export interface BrowserBundleOptions {
  /** Default true; false keeps the modules' comments, as the licence list reads them. */
  readonly minify?: boolean
  /** The entries beside pulse-ui.js; default `BROWSER_ENTRIES`. */
  readonly entries?: Readonly<Record<string, string>>
}

/** Each shared module's public names, as its production build exports them. */
export declare function sharedNames(): Record<string, string[]>
export declare function buildBrowserBundle(options?: BrowserBundleOptions): Promise<BrowserBundle>
/** The stylesheet compiled from `css`, a Tailwind entry read as if it were scripts/browser-bundle.css. */
export declare function compileStylesheet(
  css: string,
  options?: { minify?: boolean },
): Promise<string>
export declare function writeBrowserBundle(outdir: string): Promise<string[]>
