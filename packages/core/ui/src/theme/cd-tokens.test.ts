/// <reference types="node" />
import { createHash } from "node:crypto"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { CD_TOKENS, CD_TOKENS_VERSION } from "./cd-tokens.js"
import { rootTokens } from "./vendored-tokens.test-support.js"

/**
 * Drift guard for the vendored Miragon corporate-design tokens
 * (modeler-tool-design §13): the copy must stay the skill's file, unchanged.
 *
 * `cd-tokens.generated.css` is miragon-brand's `modeler-tool-design/assets/
 * cd-tokens.generated.css` byte for byte, copied by `brand-assets.mjs` as
 * `.miragon/brand-assets.yaml` lists it. When a checkout of the plugin is
 * reachable (`MIRAGON_CD_TOKENS` or a Claude plugin cache under $HOME), the
 * copy is compared to it directly; everywhere else (CI) its line in
 * `.miragon/brand-assets.sha256` holds it.
 *
 * To re-vendor: run `brand-assets.mjs` from the plugin, then update
 * CD_TOKENS_VERSION and CD_TOKENS.
 */
const COPY = "packages/core/ui/src/tokens/cd-tokens.generated.css"
const UPSTREAM_REL = join("skills", "modeler-tool-design", "assets", "cd-tokens.generated.css")

const fromRepo = (rel: string) =>
  readFileSync(new URL(`../../../../../${rel}`, import.meta.url), "utf8")

const vendored = readFileSync(new URL("../tokens/cd-tokens.generated.css", import.meta.url), "utf8")
const recordedSha256 = fromRepo(".miragon/brand-assets.sha256")
  .split("\n")
  .find((line) => line.endsWith(`  ${COPY}`))
  ?.split("  ")[0]
const copiedVersion = /^skillVersion: (\S+)$/m.exec(fromRepo(".miragon/brand-assets.yaml"))?.[1]

/** A reachable upstream copy of this version, or null (CI). */
function findUpstream(): string | null {
  const explicit = process.env.MIRAGON_CD_TOKENS
  if (explicit) return existsSync(explicit) ? explicit : null
  const home = homedir()
  let entries: string[]
  try {
    entries = readdirSync(home).filter((name) => name.startsWith(".claude"))
  } catch {
    return null
  }
  for (const dir of entries) {
    const candidate = join(
      home,
      dir,
      "plugins",
      "cache",
      "miragon-agent-skills",
      "miragon-brand",
      CD_TOKENS_VERSION,
      UPSTREAM_REL,
    )
    if (existsSync(candidate)) return candidate
  }
  return null
}

describe("cd-tokens.generated.css (vendored, never edited)", () => {
  it("names the brand version brand-assets.mjs copied it from", () => {
    expect(CD_TOKENS_VERSION).toBe(copiedVersion)
  })

  it("is the file brand-assets.mjs copied (its sha256 in .miragon/brand-assets.sha256)", () => {
    const hash = createHash("sha256").update(vendored, "utf8").digest("hex")
    expect(hash, "re-vendor with brand-assets.mjs instead of editing the copy").toBe(recordedSha256)
  })

  it("is byte-identical to the skill's file when a plugin checkout is reachable", () => {
    const upstream = findUpstream()
    // Off-machine (CI) the recorded hash above is the guard; say so loudly.
    if (!upstream) {
      console.warn(
        `cd-tokens drift: no miragon-brand ${CD_TOKENS_VERSION} checkout found — relying on the recorded hash`,
      )
      return
    }
    expect(vendored).toBe(readFileSync(upstream, "utf8"))
  })
})

describe("CD_TOKENS (the TS mirror of the top-level :root)", () => {
  const css = Object.fromEntries(
    [...rootTokens(vendored)].map(([name, value]) => [name.replace(/^--cd-/, ""), value]),
  )

  it("mirrors every --cd-* token value exactly", () => {
    for (const [name, value] of Object.entries(css)) {
      expect(CD_TOKENS[name as keyof typeof CD_TOKENS], `--cd-${name}`).toBe(value)
    }
  })

  it("declares no token the CSS does not", () => {
    expect(Object.keys(CD_TOKENS).sort()).toEqual(Object.keys(css).sort())
  })

  it("parses a non-trivial token set (the parser itself is alive)", () => {
    expect(Object.keys(css).length).toBeGreaterThanOrEqual(40)
    expect(css.blau).toBe("#335DE5")
  })
})
