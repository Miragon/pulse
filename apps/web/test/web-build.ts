import { mkdtempSync, realpathSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { build, type Plugin, type Rolldown } from "vite"
import { cssDependencies, renderedModules } from "../../../scripts/third-party-licenses.mjs"
import viteConfig from "../vite.config.js"

/** The app's folder, as the bundler reports its modules (real paths). */
export const APP = realpathSync(fileURLToPath(new URL("..", import.meta.url)))

export interface WebBuild {
  /** The folder the build was written to: what the server reads as its web build. */
  readonly dir: string
  /** The modules the bundle holds code of, and the stylesheets it inlines into its own. */
  readonly modules: readonly string[]
  readonly remove: () => void
}

/**
 * The web build as `vite build` makes it from vite.config.ts, for production (Vitest's
 * NODE_ENV=test would turn React into its development build), written to a folder of its own.
 */
export async function buildWeb(): Promise<WebBuild> {
  const dir = mkdtempSync(join(tmpdir(), "pulse-web-build-"))
  const css = cssDependencies()
  const nodeEnv = process.env.NODE_ENV
  process.env.NODE_ENV = "production"
  try {
    const output = await build({
      ...viteConfig,
      configFile: false,
      root: APP,
      mode: "production",
      logLevel: "silent",
      plugins: [...(viteConfig.plugins ?? []), css.plugin as Plugin],
      build: { ...viteConfig.build, outDir: dir, emptyOutDir: true },
    })
    const outputs = (Array.isArray(output) ? output : [output]) as Rolldown.RolldownOutput[]
    const chunks = outputs.flatMap(({ output: each }) => each)
    const modules = [...renderedModules(chunks), ...css.files(chunks)]
    return { dir, modules, remove: () => rmSync(dir, { recursive: true, force: true }) }
  } finally {
    if (nodeEnv === undefined) delete process.env.NODE_ENV
    else process.env.NODE_ENV = nodeEnv
  }
}
