// @vitest-environment happy-dom
import { describe, expect, it } from "vitest"
import {
  applyDocumentTheme,
  formattingLocale,
  HOST_MAPPED_TOKENS,
  hostThemeOf,
  hostTokenOverrides,
  resolveLanguage,
  resolveTheme,
  supportedLanguage,
  validTimeZone,
} from "./host-context.js"

describe("resolveTheme — host > OS, no in-app switch", () => {
  it("the host's theme wins over the OS, both ways", () => {
    expect(resolveTheme("dark", false)).toBe("dark")
    expect(resolveTheme("light", true)).toBe("light")
  })

  it("without a host theme the OS preference decides", () => {
    expect(resolveTheme(undefined, true)).toBe("dark")
    expect(resolveTheme(undefined, false)).toBe("light")
  })

  it("reads only a well-formed host theme", () => {
    expect(hostThemeOf("dark")).toBe("dark")
    expect(hostThemeOf("light")).toBe("light")
    expect(hostThemeOf("Dark")).toBeUndefined()
    expect(hostThemeOf(undefined)).toBeUndefined()
  })
})

describe("resolveLanguage — explicit profile > host locale > English", () => {
  it("an explicit profile language wins over the host locale", () => {
    expect(resolveLanguage("en", "de-DE")).toBe("en")
    expect(resolveLanguage("de", "en-US")).toBe("de")
  })

  it("system, a missing profile and an unshipped language follow the host locale", () => {
    for (const profile of ["system", undefined, "fr"]) {
      expect(resolveLanguage(profile, "de-AT")).toBe("de")
    }
  })

  it("falls back to English for an unsupported or missing host locale", () => {
    expect(resolveLanguage("system", "fr-FR")).toBe("en")
    expect(resolveLanguage(undefined, undefined)).toBe("en")
    expect(resolveLanguage("system", "")).toBe("en")
  })

  it("normalizes a host tag to its shipped language", () => {
    expect(supportedLanguage("de")).toBe("de")
    expect(supportedLanguage("DE-ch")).toBe("de")
    expect(supportedLanguage("en_GB")).toBe("en")
    expect(supportedLanguage("pt-BR")).toBeUndefined()
    expect(supportedLanguage(undefined)).toBeUndefined()
  })
})

describe("formattingLocale", () => {
  it("keeps the host's full tag when it speaks the effective language", () => {
    expect(formattingLocale("de", "de-AT")).toBe("de-AT")
    expect(formattingLocale("en", "en-gb")).toBe("en-GB")
  })

  it("uses the bare language when the host speaks another one or reports none", () => {
    expect(formattingLocale("de", "en-US")).toBe("de")
    expect(formattingLocale("en", undefined)).toBe("en")
  })

  it("never hands the formatters a malformed tag", () => {
    expect(formattingLocale("de", "de-")).toBe("de")
  })
})

describe("validTimeZone", () => {
  it("passes a zone the runtime knows and drops anything else", () => {
    expect(validTimeZone("Europe/Berlin")).toBe("Europe/Berlin")
    expect(validTimeZone("Mars/Olympus_Mons")).toBeUndefined()
    expect(validTimeZone(undefined)).toBeUndefined()
    expect(validTimeZone("")).toBeUndefined()
  })
})

describe("hostTokenOverrides", () => {
  const variables = {
    "--color-background-primary": "#1f1e1d",
    "--color-background-secondary": " #2a2927 ",
    "--color-text-primary": "#f5f4ef",
    "--color-text-secondary": "#b8b5a9",
    "--color-border-primary": "#3d3c39",
    "--color-ring-primary": "#c96442",
    "--color-text-danger": "#ff0000",
    "--font-sans": "Inter",
  }

  it("maps the host's neutral ramp onto the neutral roles while the view follows the host", () => {
    expect(hostTokenOverrides(variables, true)).toEqual({
      "--background": "#1f1e1d",
      "--card": "#1f1e1d",
      "--popover": "#1f1e1d",
      "--muted": "#2a2927",
      "--secondary": "#2a2927",
      "--foreground": "#f5f4ef",
      "--card-foreground": "#f5f4ef",
      "--popover-foreground": "#f5f4ef",
      "--secondary-foreground": "#f5f4ef",
      "--muted-foreground": "#b8b5a9",
      "--border": "#3d3c39",
    })
  })

  it("never lets the host set a brand, interaction or status role", () => {
    // Focus ring, 3:1 field edge, selection tint and tones stay the theme's.
    const brandRoles = [
      "--primary",
      "--primary-foreground",
      "--primary-hover",
      "--link",
      "--focus",
      "--ring",
      "--input",
      "--accent",
      "--accent-foreground",
      "--destructive",
      "--scrim",
    ]
    const tones = ["danger", "warning", "success", "info"].flatMap((tone) => [
      `--${tone}`,
      `--${tone}-soft`,
      `--${tone}-ink`,
    ])
    for (const role of [...brandRoles, ...tones]) expect(HOST_MAPPED_TOKENS).not.toContain(role)
    expect(Object.keys(hostTokenOverrides(variables, true))).toEqual(
      expect.not.arrayContaining([...brandRoles, ...tones]),
    )
  })

  it("maps nothing when the view renders in another theme than the host's, or the host sent nothing", () => {
    expect(hostTokenOverrides(variables, false)).toEqual({})
    expect(hostTokenOverrides(undefined, true)).toEqual({})
    expect(hostTokenOverrides({ "--color-background-primary": "  " }, true)).toEqual({})
  })
})

describe("applyDocumentTheme", () => {
  const root = () => document.createElement("html")
  const state = (el: HTMLElement) => ({
    dark: el.classList.contains("dark"),
    dataTheme: el.getAttribute("data-theme"),
    colorScheme: el.style.getPropertyValue("color-scheme"),
    background: el.style.getPropertyValue("background-color"),
  })

  it("drives .dark, data-theme and color-scheme from ONE theme, both ways, on the host's canvas", () => {
    const el = root()
    applyDocumentTheme(el, { theme: "dark", hostTheme: "dark" })
    expect(state(el)).toEqual({
      dark: true,
      dataTheme: "dark",
      colorScheme: "dark",
      background: "",
    })
    applyDocumentTheme(el, { theme: "light", hostTheme: "light" })
    expect(state(el)).toEqual({
      dark: false,
      dataTheme: "light",
      colorScheme: "light",
      background: "",
    })
    // Outside a host (the OS decides) the canvas stays transparent too.
    applyDocumentTheme(el, { theme: "dark", hostTheme: undefined })
    expect(state(el)).toMatchObject({ dark: true, background: "" })
  })

  it("sets the mapped roles while following the host and clears every one of them otherwise", () => {
    const el = root()
    const hostVariables = { "--color-background-primary": "#111111" }
    applyDocumentTheme(el, { theme: "dark", hostTheme: "dark", hostVariables })
    expect(el.style.getPropertyValue("--background")).toBe("#111111")

    el.style.setProperty("--muted", "stale")
    applyDocumentTheme(el, { theme: "light", hostTheme: undefined, hostVariables })
    for (const token of HOST_MAPPED_TOKENS) expect(el.style.getPropertyValue(token)).toBe("")
  })
})
