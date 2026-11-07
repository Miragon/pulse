import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { composedEnvVars } from "@miragon/pulse-widget-shell/server"
import { MODULES } from "../src/setup.js"

/**
 * Keeps `.env.example` and the server's actual env surface in sync. Both
 * drift directions fail silently for the customer who copies the file:
 * a variable the server does NOT read prints an "Unknown environment
 * variable" warning on every boot (the boot's typo warner), and a
 * variable a module added but the example never documents is simply
 * undiscoverable. Add yours to `.env.example` when you add a module.
 */

const ENV_EXAMPLE = path.join(import.meta.dirname, "..", "..", ".env.example")

/** Keys from `FOO=…` lines, commented-out (`# FOO=…`) examples included. */
function documentedKeys(content: string): string[] {
  return content
    .split("\n")
    .map((line) => /^#?\s*([A-Z][A-Z0-9_]*)=/.exec(line)?.[1])
    .filter((key): key is string => key !== undefined)
}

/** The modules the live `MCP_ACTIVE_MODULES=` line runs, read as the boot reads it; unset or `all` runs every composed one. */
function listedModules(content: string, composed: readonly string[]): string[] {
  const value = /^MCP_ACTIVE_MODULES=(.*)$/m.exec(content)?.[1]?.trim()
  if (!value || value === "all") return [...composed]
  return value
    .split(",")
    .map((entry) => entry.replace(/:.*$/, "").trim())
    .filter(Boolean)
}

describe(".env.example matches the server's env surface", () => {
  const keys = documentedKeys(fs.readFileSync(ENV_EXAMPLE, "utf8"))
  const allowed = composedEnvVars(MODULES)

  it("documents no variable the server ignores (a copied .env would warn at boot)", () => {
    expect(keys.filter((key) => !allowed.has(key))).toEqual([])
  })

  it("documents every variable the app and its modules read", () => {
    expect([...allowed].filter((key) => !keys.includes(key)).sort()).toEqual([])
  })

  it("lists each variable exactly once", () => {
    const duplicates = keys.filter((key, i) => keys.indexOf(key) !== i)
    expect(duplicates).toEqual([])
  })
})

describe("the module list a copied .env starts with", () => {
  const composed = MODULES.map(({ name }) => name)
  const listed = listedModules(fs.readFileSync(ENV_EXAMPLE, "utf8"), composed)

  it("names only composed modules (the boot refuses an unknown one)", () => {
    expect(listed.filter((name) => !composed.includes(name))).toEqual([])
  })

  it("names each module once (the boot refuses a repeat)", () => {
    expect(listed.filter((name, i) => listed.indexOf(name) !== i)).toEqual([])
  })

  // Analytics may stay out: compose.yaml runs no Prometheus for it to read.
  it("names every other composed module (one it leaves out is off, its tools absent)", () => {
    expect(composed.filter((name) => name !== "analytics" && !listed.includes(name))).toEqual([])
  })
})
