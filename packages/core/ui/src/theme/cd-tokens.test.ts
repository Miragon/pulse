/// <reference types="node" />
import { createHash } from "node:crypto"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { CD_TOKENS, CD_TOKENS_VERSION } from "./cd-tokens.js"

/**
 * Drift guard for the vendored Miragon corporate-design tokens
 * (modeler-tool-design §13): the copy must stay the skill's file, unchanged.
 *
 * `cd-tokens.generated.css` = ONE marker line + the upstream file byte for
 * byte. Upstream is miragon-brand's `modeler-tool-design/assets/
 * cd-tokens.generated.css`. When a checkout of the plugin is reachable
 * (`MIRAGON_CD_TOKENS` or a Claude plugin cache under $HOME), the copy is
 * compared to it directly; everywhere else (CI) the pinned hash below holds it.
 *
 * To re-vendor: copy the new upstream file below the marker line, update the
 * version in the marker, CD_TOKENS_VERSION, UPSTREAM_SHA256 and CD_TOKENS,
 * then the version and sha256 in `tokens/manifest.json` (the token drift test
 * of the server app checks the copy against it).
 */
const UPSTREAM_SHA256 = "36d76f3a330a1250d332c6862be1dc4f7564d2461e7051d9a565ba723ef2c379"
const UPSTREAM_REL = join("skills", "modeler-tool-design", "assets", "cd-tokens.generated.css")
const MARKER =
  `/* Aus Miragon/corporate-identity übernommen (miragon-brand ${CD_TOKENS_VERSION}, ` +
  "modeler-tool-design/assets/cd-tokens.generated.css). Nicht ändern, zum Aktualisieren neu aus der Skill kopieren. */\n"

const vendored = readFileSync(new URL("../tokens/cd-tokens.generated.css", import.meta.url), "utf8")
const upstreamPart = vendored.slice(MARKER.length)

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

/** `--cd-name: value;` declarations of the vendored `:root`. */
function cssTokens(css: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const match of css.matchAll(/--cd-([a-z0-9-]+):\s*([^;]+);/g)) {
    out[match[1]] = match[2].trim()
  }
  return out
}

describe("cd-tokens.generated.css (vendored, never edited)", () => {
  it("starts with the generated-file marker naming the brand version", () => {
    expect(vendored.startsWith(MARKER)).toBe(true)
  })

  it("is the upstream file byte for byte below the marker (pinned hash)", () => {
    const hash = createHash("sha256").update(upstreamPart, "utf8").digest("hex")
    expect(hash, "re-vendor from the skill instead of editing the copy").toBe(UPSTREAM_SHA256)
  })

  it("is byte-identical to the skill's file when a plugin checkout is reachable", () => {
    const upstream = findUpstream()
    // Off-machine (CI) the pinned hash above is the guard; say so loudly.
    if (!upstream) {
      console.warn(
        `cd-tokens drift: no miragon-brand ${CD_TOKENS_VERSION} checkout found — relying on the pinned hash`,
      )
      return
    }
    expect(upstreamPart).toBe(readFileSync(upstream, "utf8"))
  })
})

describe("CD_TOKENS (the TS mirror of :root)", () => {
  const css = cssTokens(upstreamPart)

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
