// @vitest-environment happy-dom
import { createElement, type ReactNode } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, renderHook } from "@testing-library/react"
import { ShellHostProvider, type ShellHost } from "./shell-host.js"
import { useApplyTheme } from "./use-apply-theme.js"

const root = document.documentElement

afterEach(() => {
  cleanup()
  root.className = ""
  root.removeAttribute("data-theme")
  root.removeAttribute("style")
  vi.unstubAllGlobals()
})

/** Returns the change-listener registry. */
function stubOsPreference(dark: boolean) {
  const query = { matches: dark, addEventListener: vi.fn(), removeEventListener: vi.fn() }
  const matchMedia = vi.fn().mockReturnValue(query)
  vi.stubGlobal("matchMedia", matchMedia)
  return { query, matchMedia }
}

function inHost(host: Partial<ShellHost>) {
  const value: ShellHost = {
    connected: true,
    displayMode: "inline",
    availableDisplayModes: [],
    ...host,
  }
  return ({ children }: { children: ReactNode }) =>
    createElement(ShellHostProvider, { host: value, children })
}

/** The three document signals that must always agree. */
const documentTheme = () => ({
  dark: root.classList.contains("dark"),
  dataTheme: root.getAttribute("data-theme"),
  colorScheme: root.style.getPropertyValue("color-scheme"),
})

describe("useApplyTheme", () => {
  it("follows the OS preference outside a host, on .dark, data-theme and color-scheme alike", () => {
    stubOsPreference(true)
    const { result } = renderHook(() => useApplyTheme())
    expect(result.current).toBe("dark")
    expect(documentTheme()).toEqual({ dark: true, dataTheme: "dark", colorScheme: "dark" })

    cleanup()
    stubOsPreference(false)
    renderHook(() => useApplyTheme())
    expect(documentTheme()).toEqual({ dark: false, dataTheme: "light", colorScheme: "light" })
  })

  it("follows the HOST theme over the OS, both ways (#339: dark host, light OS)", () => {
    stubOsPreference(false)
    renderHook(() => useApplyTheme(), { wrapper: inHost({ theme: "dark" }) })
    expect(documentTheme()).toEqual({ dark: true, dataTheme: "dark", colorScheme: "dark" })

    cleanup()
    stubOsPreference(true)
    renderHook(() => useApplyTheme(), { wrapper: inHost({ theme: "light" }) })
    expect(documentTheme()).toEqual({ dark: false, dataTheme: "light", colorScheme: "light" })
  })

  it("keeps the host's transparent canvas", () => {
    stubOsPreference(true)
    renderHook(() => useApplyTheme(), { wrapper: inHost({ theme: "light" }) })
    expect(root.style.getPropertyValue("background-color")).toBe("")
  })

  it("maps the host palette onto the neutral roles only while the host names its theme", () => {
    stubOsPreference(false)
    const styleVariables = {
      "--color-background-primary": "#1f1e1d",
      "--color-text-primary": "#f5f4ef",
      "--color-ring-primary": "#c96442",
    }
    renderHook(() => useApplyTheme(), {
      wrapper: inHost({ theme: "dark", styleVariables }),
    })
    expect(root.style.getPropertyValue("--card")).toBe("#1f1e1d")
    expect(root.style.getPropertyValue("--foreground")).toBe("#f5f4ef")
    // The focus ring stays the theme's.
    expect(root.style.getPropertyValue("--ring")).toBe("")

    cleanup()
    renderHook(() => useApplyTheme(), { wrapper: inHost({ styleVariables }) })
    // No host theme, so the OS decides — the host's palette does not apply.
    expect(root.style.getPropertyValue("--card")).toBe("")
    expect(root.style.getPropertyValue("--foreground")).toBe("")
  })

  it("subscribes to the OS dark-mode query while mounted and re-resolves on its change", () => {
    const { query, matchMedia } = stubOsPreference(false)
    const { unmount } = renderHook(() => useApplyTheme())
    expect(matchMedia).toHaveBeenCalledWith("(prefers-color-scheme: dark)")
    expect(query.addEventListener).toHaveBeenCalledWith("change", expect.any(Function))
    expect(root.classList.contains("dark")).toBe(false)

    query.matches = true
    const onChange = query.addEventListener.mock.calls[0][1] as () => void
    act(() => onChange())
    expect(root.classList.contains("dark")).toBe(true)

    unmount()
    expect(query.removeEventListener).toHaveBeenCalledWith("change", onChange)
  })

  it("resolves light without a matchMedia (no OS signal is no dark signal)", () => {
    vi.stubGlobal("matchMedia", undefined)
    const { result } = renderHook(() => useApplyTheme())
    expect(result.current).toBe("light")
    expect(root.classList.contains("dark")).toBe(false)
  })
})
