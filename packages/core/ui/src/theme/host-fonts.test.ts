/// <reference types="node" />
import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import {
  adoptHostFontVariables,
  HOST_FONT_VARIABLES,
  type InlineStyleTarget,
} from "./host-fonts.js"

/** `element.style` as a map: the inline custom properties of one element. */
function inlineStyle(initial: Record<string, string> = {}): InlineStyleTarget & {
  props: Map<string, string>
} {
  const props = new Map(Object.entries(initial))
  return {
    props,
    getPropertyValue: (name) => props.get(name) ?? "",
    setProperty: (name, value) => void props.set(name, value),
    removeProperty: (name) => {
      const old = props.get(name) ?? ""
      props.delete(name)
      return old
    },
  }
}

/** What widget-shell's HostDocument does with the host's style variables. */
function applyHostStyleVariables(
  style: InlineStyleTarget,
  variables: Record<string, string | undefined>,
): void {
  for (const [name, value] of Object.entries(variables)) {
    if (value !== undefined) style.setProperty(name, value)
  }
}

const rootRole = (name: string): string => {
  const css = readFileSync(new URL("../theme.css", import.meta.url), "utf8").replace(
    /\/\*[\s\S]*?\*\//g,
    "",
  )
  const root = /(?:^|\})\s*:root\s*\{([^{}]*)\}/.exec(css)?.[1] ?? ""
  const decl = new RegExp(`${name}:([^;]+);`).exec(root)?.[1]
  if (!decl) throw new Error(`theme.css :root has no ${name}`)
  return decl.replace(/\s+/g, " ").trim()
}

/**
 * The font stack <html> renders with: an inline value of the role wins over
 * theme.css; otherwise the `:root` stack with `var(--host-font-*, fallback)`
 * resolved against the inline style.
 */
function renderedStack(style: InlineStyleTarget, role: "--font-sans" | "--font-mono"): string {
  const inline = style.getPropertyValue(role)
  if (inline) return inline
  return rootRole(role).replace(
    /var\((--host-font-[a-z]+), ([^)]+)\)/,
    (_all, slot: string, fallback: string) => style.getPropertyValue(slot) || fallback,
  )
}

describe("adoptHostFontVariables (host font → fallback slot)", () => {
  const HOST = { "--font-sans": '"Anthropic Sans", system-ui', "--font-mono": '"Host Mono"' }

  it("keeps Geist first when a SEP-1865 host sends --font-sans/--font-mono", () => {
    const html = inlineStyle()
    applyHostStyleVariables(html, HOST)
    // Without the kit's step the host replaces the whole stack:
    expect(renderedStack(html, "--font-sans")).toBe('"Anthropic Sans", system-ui')
    adoptHostFontVariables(html, HOST)
    expect(renderedStack(html, "--font-sans")).toBe(
      '"Geist", "Geist Variable", "Anthropic Sans", system-ui, system-ui, sans-serif',
    )
    expect(renderedStack(html, "--font-mono")).toBe(
      '"Geist Mono", "Geist Mono Variable", "Host Mono", SFMono-Regular, Menlo, Consolas, monospace',
    )
  })

  it("moves the host's values into the --host-font-* slots and clears the roles", () => {
    const html = inlineStyle()
    applyHostStyleVariables(html, HOST)
    adoptHostFontVariables(html, HOST)
    expect(Object.fromEntries(html.props)).toEqual({
      "--host-font-sans": '"Anthropic Sans", system-ui',
      "--host-font-mono": '"Host Mono"',
    })
  })

  it("leaves an app's own inline brand font on the role alone", () => {
    const html = inlineStyle({ "--font-sans": "Inter, sans-serif" })
    adoptHostFontVariables(html, { "--font-sans": "HostSans" })
    expect(html.props.get("--font-sans")).toBe("Inter, sans-serif")
    expect(html.props.get("--host-font-sans")).toBe("HostSans")
  })

  it("compares the host's value and the inline role without surrounding whitespace", () => {
    const html = inlineStyle({ "--font-sans": " HostSans " })
    adoptHostFontVariables(html, { "--font-sans": "HostSans\n" })
    expect(Object.fromEntries(html.props)).toEqual({ "--host-font-sans": "HostSans" })
  })

  it("is a no-op without host variables or with empty font values", () => {
    const html = inlineStyle({ "--font-sans": "X" })
    adoptHostFontVariables(html, undefined)
    adoptHostFontVariables(html, null)
    adoptHostFontVariables(html, { "--font-sans": "  ", "--font-mono": undefined })
    expect(Object.fromEntries(html.props)).toEqual({ "--font-sans": "X" })
    expect(renderedStack(inlineStyle(), "--font-sans")).toBe(
      '"Geist", "Geist Variable", ui-sans-serif, system-ui, sans-serif',
    )
  })

  it("is idempotent (the view host re-applies on every host-context update)", () => {
    const html = inlineStyle()
    for (let i = 0; i < 2; i++) {
      applyHostStyleVariables(html, HOST)
      adoptHostFontVariables(html, HOST)
    }
    expect(html.props.has("--font-sans")).toBe(false)
    expect(html.props.get("--host-font-sans")).toBe('"Anthropic Sans", system-ui')
  })

  it("names exactly the two SEP-1865 font variables", () => {
    expect(HOST_FONT_VARIABLES).toEqual({
      "--font-sans": "--host-font-sans",
      "--font-mono": "--host-font-mono",
    })
  })
})
