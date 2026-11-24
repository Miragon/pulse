// @vitest-environment happy-dom
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"

const BRIDGE = readFileSync(join(import.meta.dirname, "../src/temporary/theme-bridge.js"), "utf8")

/** Runs the bridge with the OS in `dark` (or light); the returned function flips the OS. */
function runBridge(dark: boolean) {
  const listeners: (() => void)[] = []
  const media = {
    matches: dark,
    addEventListener: (_: string, listener: () => void) => listeners.push(listener),
  }
  vi.stubGlobal("matchMedia", () => media)
  window.matchMedia = (() => media) as unknown as typeof window.matchMedia
  new Function(BRIDGE)()
  return (next: boolean) => {
    media.matches = next
    for (const listener of listeners) listener()
  }
}

const root = () => document.documentElement

afterEach(() => {
  root().removeAttribute("data-theme")
  root().classList.remove("dark")
  root().style.colorScheme = ""
  vi.unstubAllGlobals()
})

describe("the theme bridge", () => {
  it("follows the OS without data-theme, and its change", () => {
    const setOs = runBridge(true)
    expect(root().classList.contains("dark")).toBe(true)
    expect(root().style.colorScheme).toBe("dark")
    setOs(false)
    expect(root().classList.contains("dark")).toBe(false)
    expect(root().style.colorScheme).toBe("light")
  })

  it("lets Claude's data-theme win in both directions, and never writes it", async () => {
    runBridge(true)
    root().setAttribute("data-theme", "light")
    await new Promise((done) => setTimeout(done, 0))
    expect(root().classList.contains("dark")).toBe(false)
    root().setAttribute("data-theme", "dark")
    await new Promise((done) => setTimeout(done, 0))
    expect(root().classList.contains("dark")).toBe(true)
    expect(root().getAttribute("data-theme")).toBe("dark")
  })

  it("declares no --cd-* token and writes no data-theme", () => {
    expect(BRIDGE).not.toMatch(/--cd-/)
    expect(BRIDGE).not.toMatch(/setAttribute\(\s*["']data-theme/)
  })
})
