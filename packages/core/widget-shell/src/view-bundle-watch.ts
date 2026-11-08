/**
 * The dev loop's view bundle: `pnpm dev` builds it once, then runs `vite build --watch` next to
 * `tsx watch`, which restarts the server whenever the bundle's files are written. The watcher's
 * first build writes the same bytes again and would restart the server right after its boot;
 * this plugin keeps an output whose bytes equal the file on disk unwritten in watch mode, so the
 * server restarts only for a bundle that changed. A plain `vite build` writes everything.
 */
import { readFileSync } from "node:fs"
import path from "node:path"

/** What the plugin reads of an output: a chunk's code or an asset's source. */
interface BundleOutput {
  type: "chunk" | "asset"
  code?: string
  source?: string | Uint8Array
}

const bytesOf = (output: BundleOutput) =>
  Buffer.from(output.type === "chunk" ? (output.code ?? "") : (output.source ?? ""))

function sameOnDisk(file: string, output: BundleOutput): boolean {
  try {
    return readFileSync(file).equals(bytesOf(output))
  } catch {
    // Not written yet.
    return false
  }
}

/** A Vite plugin for the view bundle's config: `plugins: [react(), tailwindcss(), viewBundleWatchPlugin()]`. */
export function viewBundleWatchPlugin() {
  return {
    name: "pulse:view-bundle-watch",
    apply: "build" as const,
    // After the CSS is emitted, so the stylesheet is compared too.
    enforce: "post" as const,
    generateBundle(
      this: { meta: { watchMode: boolean } },
      options: { dir?: string },
      bundle: Record<string, BundleOutput>,
    ) {
      const { dir } = options
      if (!this.meta.watchMode || dir === undefined) return
      for (const [file, output] of Object.entries(bundle)) {
        if (sameOnDisk(path.join(dir, file), output)) delete bundle[file]
      }
    },
  }
}
