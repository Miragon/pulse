import { describe, expect, it } from "vitest"
import { VIEW_BUNDLE_DEDUPE } from "@miragon/pulse-widget-shell/server"
import viteConfig from "../vite.config.js"

/**
 * CLAUDE.md invariant 4: the view bundle resolves widget-shell's VIEW_BUNDLE_DEDUPE to one
 * instance each, or a widget reads a second React context and every in-widget query hangs on
 * "Loading…" (test:host's in-widget query scenario is the end-to-end proof on the built bundle).
 */
describe("the view bundle's vite config", () => {
  it("dedupes every package of widget-shell's VIEW_BUNDLE_DEDUPE", () => {
    const dedupe = viteConfig.resolve?.dedupe ?? []
    expect(VIEW_BUNDLE_DEDUPE.filter((name) => !dedupe.includes(name))).toEqual([])
  })
})
