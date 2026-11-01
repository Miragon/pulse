/**
 * The host's font, demoted to the fallback slot of the font roles.
 *
 * SEP-1865 hosts send their fonts as the style variables `--font-sans` and
 * `--font-mono`, the same names as the kit's font roles. A host runtime writes
 * them inline on `<html>`, where they beat the role stacks in `theme.css` and
 * replace them whole, so Geist never renders even when it is loaded. The
 * kit's rule is Geist first, the host's font next, the system stack last:
 * {@link adoptHostFontVariables} moves the host's value to
 * `--host-font-sans` / `--host-font-mono`, which the role stacks name right
 * after Geist. A host document layer runs it after every host-context update,
 * right after it applied the host variables (widget-shell's `HostDocument`,
 * for example).
 */

/** Each host font variable (SEP-1865 name) → where the kit keeps it. */
export const HOST_FONT_VARIABLES = {
  "--font-sans": "--host-font-sans",
  "--font-mono": "--host-font-mono",
} as const

/** The slice of `CSSStyleDeclaration` the helper touches (`element.style`). */
export interface InlineStyleTarget {
  getPropertyValue(property: string): string
  setProperty(property: string, value: string): void
  removeProperty(property: string): string
}

/**
 * Move the host's font variables off the role names on `style` (normally
 * `document.documentElement.style`, where the host variables were applied):
 * each non-empty `--font-sans` / `--font-mono` in `hostVariables` is written
 * to its {@link HOST_FONT_VARIABLES} slot, and the role is cleared when it
 * still holds exactly the host's value — an app's own inline brand font
 * stays. Idempotent; a no-op without host variables.
 *
 * @example
 * applyHostStyleVariables(vars) // the host layer writes --font-sans on <html>
 * adoptHostFontVariables(document.documentElement.style, vars)
 * // --font-sans: "Geist", "Geist Variable", <host font>, system-ui, sans-serif
 */
export function adoptHostFontVariables(
  style: InlineStyleTarget,
  hostVariables: Readonly<Record<string, string | undefined>> | null | undefined,
): void {
  if (!hostVariables) return
  for (const [role, slot] of Object.entries(HOST_FONT_VARIABLES)) {
    const value = hostVariables[role]?.trim()
    if (!value) continue
    style.setProperty(slot, value)
    if (style.getPropertyValue(role).trim() === value) style.removeProperty(role)
  }
}
