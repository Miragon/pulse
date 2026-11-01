import { createContext, useContext } from "react"

/**
 * The element portaled overlays (Dialog) render into. An internal seam: the
 * kit mounts no provider, so the value is `null` and overlays take the overlay
 * library's default (`document.body`). A provider that passes a node INSIDE a
 * themed scope would keep that scope's variables and light/dark mode on its
 * overlays (`portal-container.test.tsx` pins both).
 */
export const PortalContainerContext = createContext<HTMLElement | null>(null)

/**
 * The portal container of the nearest provider, or `null`, which means
 * `document.body`. The kit's Dialog passes it as its portal's `container`; a
 * portal of your own can do the same.
 */
export function usePortalContainer(): HTMLElement | null {
  return useContext(PortalContainerContext)
}
