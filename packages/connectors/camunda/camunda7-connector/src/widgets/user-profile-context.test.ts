import { describe, expect, it } from "vitest"
import { modelContextText } from "@miragon/pulse-widget-shell/widgets"
import { liveSurface } from "./lib/hand-off.test-support.js"
import { describeProfile, profileSurface } from "./user-profile-context.js"

// The save tool IS registered on `operations`.
async function contextText(canSave: boolean): Promise<string> {
  const surface = await liveSurface("operations")
  expect(surface.tools).toContain("camunda7_save_settings")
  return modelContextText({
    ...describeProfile({ canSave, allEnginesAllowed: true, allowedEngineCount: 0 }),
    surface: profileSurface(surface, canSave),
  })
}

describe("camunda7's settings section model context", () => {
  it("names the save tool where the caller can save", async () => {
    const text = await contextText(true)
    expect(text).toContain("they can be changed here or via the save tool")
    expect(text).toMatch(/\nTools: camunda7_save_settings$/)
  })

  // A gateway deployment without OAuth registers the save, but no request has an identity: every save refuses.
  it("never names the save tool while preferences are read-only for the caller", async () => {
    const text = await contextText(false)
    expect(text).toContain("they are read-only in this deployment")
    expect(text).not.toContain("camunda7_save_settings")
    expect(text).not.toContain("Tools:")
  })

  it("never names the save tool on a deployment that does not register it", async () => {
    const surface = await liveSurface("read-only")
    expect(profileSurface(surface, true).has("camunda7_save_settings")).toBe(false)
  })
})
