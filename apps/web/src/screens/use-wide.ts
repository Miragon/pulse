import { useSyncExternalStore } from "react"

/** From this width on the navigation stands beside the view and a screen fills the window. */
export const WIDE = "(min-width: 64rem)"

/** The media query of `query`, where the browser has one. */
const mediaOf = (query: string): MediaQueryList | undefined =>
  typeof window === "undefined" || typeof window.matchMedia !== "function"
    ? undefined
    : window.matchMedia(query)

/**
 * Whether the window is at least 64rem wide: a screen splits its diagram and its details there, and
 * stacks them under it, the diagram at a height of its own. It follows the window as it changes.
 */
export function useWide(): boolean {
  return useSyncExternalStore(
    (changed) => {
      const media = mediaOf(WIDE)
      media?.addEventListener("change", changed)
      return () => media?.removeEventListener("change", changed)
    },
    () => mediaOf(WIDE)?.matches ?? true,
  )
}
