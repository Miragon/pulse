/**
 * The web build of the tests (`test-support/build`: the page, its routes and one stylesheet), and
 * copies of it in a folder of their own, beside which a test can place a file outside the build.
 */
import { createHash } from "node:crypto"
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"

export const FIXTURE_BUILD = path.join(import.meta.dirname, "test-support", "build")

/** The fixture's page, as every page route answers it. */
export const INDEX_HTML = readFileSync(path.join(FIXTURE_BUILD, "index.html"), "utf8")

/** The fixture's one asset, where a browser requests it, and its content. */
export const STYLESHEET = "/app/assets/app-3f9a1c.css"
export const STYLESHEET_CSS = readFileSync(
  path.join(FIXTURE_BUILD, "assets/app-3f9a1c.css"),
  "utf8",
)

const made: string[] = []

/** `bytes` bytes of script that compress well. */
export const compressible = (bytes: number): string =>
  "export const answer = 42;\n".repeat(Math.ceil(bytes / 26)).slice(0, bytes)

/** `bytes` bytes that no encoding makes smaller, the same on every run. */
export function incompressible(bytes: number): Buffer {
  const blocks: Buffer[] = []
  for (let block = 0; blocks.length * 32 < bytes; block += 1) {
    blocks.push(createHash("sha256").update(String(block)).digest())
  }
  return Buffer.concat(blocks).subarray(0, bytes)
}

/** A copy of the fixture build in `<folder>/build`, with `files` (name: content) written over it. */
export function buildWith(files: Record<string, string> = {}): { build: string; folder: string } {
  const folder = mkdtempSync(path.join(os.tmpdir(), "pulse-web-build-"))
  made.push(folder)
  const build = path.join(folder, "build")
  cpSync(FIXTURE_BUILD, build, { recursive: true })
  for (const [name, content] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(build, name)), { recursive: true })
    writeFileSync(path.join(build, name), content)
  }
  return { build, folder }
}

/** Removes every copy {@link buildWith} made. */
export function removeBuilds(): void {
  for (const folder of made.splice(0)) rmSync(folder, { recursive: true, force: true })
}
