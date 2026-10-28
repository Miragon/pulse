import { describe, expect, it, vi } from "vitest"
import type { HostActions } from "@miragon/mcp-toolkit-ui/app"
import { navigateViaHost } from "./navigation.js"

// #344 N115: without the message signature the chat opens the whole activity's cluster.
describe("navigateViaHost", () => {
  const followUp = (intent: Parameters<typeof navigateViaHost>[1]) => {
    const showWidget = vi.fn()
    navigateViaHost({ showWidget } as unknown as HostActions, intent)
    return JSON.stringify(showWidget.mock.calls[0]?.[0])
  }

  it("names a cluster's message signature", () => {
    const text = followUp({
      type: "cluster-detail",
      activityId: "chargeCard",
      incidentType: "failedJob",
      messageSignature: "Card declined",
    })
    expect(text).toContain("chargeCard")
    expect(text).toContain("message signature `Card declined`")
  })

  it("leaves the signature out where the cluster has none", () => {
    const text = followUp({
      type: "cluster-detail",
      activityId: "chargeCard",
      incidentType: "failedJob",
    })
    expect(text).not.toContain("message signature")
  })
})
