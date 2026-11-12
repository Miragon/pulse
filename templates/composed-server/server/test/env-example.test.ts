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

/** `FOO=…` lines as name and value, commented-out (`# FOO=…`) examples included. */
function documented(content: string): Array<[name: string, value: string]> {
  return content
    .split("\n")
    .map((line) => /^#?\s*([A-Z][A-Z0-9_]*)=(.*)$/.exec(line))
    .filter((match): match is RegExpExecArray => match !== null)
    .map((match) => [match[1], match[2]])
}

/** Keys from `FOO=…` lines, commented-out (`# FOO=…`) examples included. */
function documentedKeys(content: string): string[] {
  return documented(content).map(([name]) => name)
}

/**
 * The variables the documented settings name themselves, read as the boot reads them: each
 * module's `referencedEnvVars` (the engine module's profiles name their ENGINE_SECRET_*
 * variables). The server reads those too, so a copied .env sets them without a warning. Each
 * documented line on its own: the commented examples are alternatives (ENGINES_FILE would win
 * over ENGINES_JSON).
 */
function referencedKeys(content: string): string[] {
  return documented(content).flatMap(([name, value]) =>
    MODULES.flatMap((module) => [...(module.referencedEnvVars?.({ [name]: value }) ?? [])]),
  )
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
  const content = fs.readFileSync(ENV_EXAMPLE, "utf8")
  const keys = documentedKeys(content)
  const allowed = composedEnvVars(MODULES)
  const referenced = referencedKeys(content)

  it("documents no variable the server ignores (a copied .env would warn at boot)", () => {
    expect(keys.filter((key) => !allowed.has(key) && !referenced.includes(key))).toEqual([])
  })

  it("documents every variable its own example settings name", () => {
    expect(referenced.length).toBeGreaterThan(0)
    expect(referenced.filter((key) => !keys.includes(key))).toEqual([])
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

  it("names every composed module (one it leaves out is off, its tools absent)", () => {
    expect(composed.filter((name) => !listed.includes(name))).toEqual([])
  })
})
