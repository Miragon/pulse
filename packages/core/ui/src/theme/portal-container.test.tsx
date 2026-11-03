// @vitest-environment happy-dom
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { afterEach, describe, expect, it } from "vitest"
import { cleanup, render, renderHook, screen } from "@testing-library/react"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../primitives/dialog.js"
import { PortalContainerContext, usePortalContainer } from "./portal-container.js"

afterEach(cleanup)

function OpenDialog() {
  return (
    <Dialog open>
      <DialogContent>
        <DialogTitle>Title</DialogTitle>
        <DialogDescription>Body</DialogDescription>
      </DialogContent>
    </Dialog>
  )
}

describe("the portal container seam", () => {
  it("is null without a provider, so overlays mount on document.body", () => {
    expect(renderHook(() => usePortalContainer()).result.current).toBeNull()
    render(<OpenDialog />)
    expect(screen.getByRole("dialog").parentElement).toBe(document.body)
  })

  it("puts the kit's Dialog into the node a provider names", () => {
    const scope = document.createElement("div")
    document.body.append(scope)
    render(
      <PortalContainerContext.Provider value={scope}>
        <OpenDialog />
      </PortalContainerContext.Provider>,
    )
    expect(scope.contains(screen.getByRole("dialog"))).toBe(true)
    scope.remove()
  })

  it("is what the Dialog's portal passes as its container (source gate)", () => {
    const here = dirname(fileURLToPath(import.meta.url))
    const src = readFileSync(join(here, "../primitives/dialog.tsx"), "utf8")
    expect(src).toMatch(/const portalContainer = usePortalContainer\(\)/)
    expect(src).toMatch(/<\w+Primitive\.Portal\b[^>]*container=\{[^}]*\bportalContainer\b[^}]*\}/)
  })
})
