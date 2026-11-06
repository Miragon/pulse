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
