export type EffectiveTheme = "light" | "dark"

export function hostThemeOf(value: unknown): EffectiveTheme | undefined {
  return value === "light" || value === "dark" ? value : undefined
}

/** No in-app theme switch (#322 owner decision). */
export function resolveTheme(
  hostTheme: EffectiveTheme | undefined,
  osPrefersDark: boolean,
): EffectiveTheme {
  return hostTheme ?? (osPrefersDark ? "dark" : "light")
}

/** The languages the widgets ship catalogs for. */
const LOCALES = ["en", "de"] as const
export type Locale = (typeof LOCALES)[number]

/** The tag's primary language when the UI ships it (`de`, `de-DE`, `DE-ch`, `de_AT`). */
function shippedLanguage(tag: string | undefined): Locale | undefined {
  const primary = tag?.split(/[-_]/)[0]?.toLowerCase()
  return LOCALES.find((locale) => locale === primary)
}

/** The host locale's primary language when the UI ships it, else English. */
export function resolveLanguage(hostLocale: string | undefined): Locale {
  return shippedLanguage(hostLocale) ?? "en"
}

function canonicalTag(tag: string): string | undefined {
  try {
    return Intl.getCanonicalLocales(tag)[0]
  } catch {
    return undefined
  }
}

/**
 * The host's canonical tag when the UI ships its language (the bare language for a malformed
 * tag), else English.
 */
export function formattingLocale(hostLocale: string | undefined): string {
  const language = shippedLanguage(hostLocale)
  if (!hostLocale || !language) return "en"
  return canonicalTag(hostLocale) ?? language
}

/** An unknown zone would make every formatter throw. */
export function validTimeZone(timeZone: string | undefined): string | undefined {
  if (!timeZone) return undefined
  try {
    new Date(0).toLocaleString("en", { timeZone })
    return timeZone
  } catch {
    return undefined
  }
}

/** Neutral roles only, so a host palette can neither recolour the brand nor break contrast floors. */
const HOST_TOKEN_MAP: Readonly<Record<string, readonly string[]>> = {
  "--color-background-primary": ["--background", "--card", "--popover"],
  "--color-background-secondary": ["--muted", "--secondary"],
  "--color-text-primary": [
    "--foreground",
    "--card-foreground",
    "--popover-foreground",
    "--secondary-foreground",
  ],
  "--color-text-secondary": ["--muted-foreground"],
  "--color-border-primary": ["--border"],
}

export const HOST_MAPPED_TOKENS: readonly string[] = Object.values(HOST_TOKEN_MAP).flat()

export type HostStyleVariables = Readonly<Record<string, string | undefined>>

/** Empty unless the view renders in the HOST's theme: its palette describes its own canvas. */
export function hostTokenOverrides(
  variables: HostStyleVariables | undefined,
  followsHost: boolean,
): Record<string, string> {
  const overrides: Record<string, string> = {}
  if (!variables || !followsHost) return overrides
  for (const [source, tokens] of Object.entries(HOST_TOKEN_MAP)) {
    const value = variables[source]?.trim()
    if (!value) continue
    for (const token of tokens) overrides[token] = value
  }
  return overrides
}

export interface DocumentThemeInput {
  theme: EffectiveTheme
  hostTheme: EffectiveTheme | undefined
  hostVariables?: HostStyleVariables
}

/** pulse-ui's dark scope keys on `.dark` and `data-theme`; SEP-1865 hosts read `data-theme`. */
export function applyDocumentTheme(
  root: HTMLElement,
  { theme, hostTheme, hostVariables }: DocumentThemeInput,
): void {
  root.classList.toggle("dark", theme === "dark")
  root.setAttribute("data-theme", theme)
  root.style.setProperty("color-scheme", theme)
  const overrides = hostTokenOverrides(hostVariables, hostTheme === theme)
  for (const token of HOST_MAPPED_TOKENS) {
    const value = overrides[token]
    if (value === undefined) root.style.removeProperty(token)
    else root.style.setProperty(token, value)
  }
}
