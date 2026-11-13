import { readFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { compile, optimize } from "@tailwindcss/node"
import { Scanner } from "@tailwindcss/oxide"

export class TailwindEntries {
  name = "pulse-tailwind-entries"
  #entries
  #production
  #inlined = new Map()

  constructor({ entries, production }) {
    this.#entries = entries.map((entry) => resolve(entry))
    this.#production = production
  }

  setup = (build) => {
    const minify = build.initialOptions.minify === true
    for (const entry of this.#entries) {
      build.onLoad({ filter: TailwindEntries.#exactly(entry) }, () => this.#load(entry, minify))
    }
  }

  inlined() {
    return [...this.#inlined].map(([entry, dependencies]) => ({ entry, dependencies }))
  }

  async #load(entry, minify) {
    const base = dirname(entry)
    const dependencies = []
    const compiler = await compile(await readFile(entry, "utf8"), {
      base,
      shouldRewriteUrls: true,
      onDependency: (path) => dependencies.push(path),
    })
    const scanner = new Scanner({ sources: TailwindEntries.#sources(compiler, base) })
    const css = compiler.build(scanner.scan())
    this.#inlined.set(entry, [...new Set(dependencies)])
    return {
      contents: this.#production ? optimize(css, { file: entry, minify }).code : css,
      loader: "css",
      resolveDir: base,
      watchFiles: [...dependencies, ...scanner.files],
    }
  }

  static #sources({ root, sources }, base) {
    if (root === "none") return sources
    return [{ ...(root ?? { base, pattern: "**/*" }), negated: false }, ...sources]
  }

  static #exactly(path) {
    return new RegExp(`^${path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`)
  }
}
