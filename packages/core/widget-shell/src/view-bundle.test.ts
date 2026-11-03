import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { VIEW_BUNDLE_DEDUPE } from "./view-bundle.js"

const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
  name: string
  peerDependencies: Record<string, string>
}

/**
 * Peers a second copy of costs only bytes, never a context: zod holds no state the views
 * share, and bpmn-js draws into the element it is given.
 */
const STATELESS_PEERS = ["zod", "bpmn-js"]

describe("VIEW_BUNDLE_DEDUPE", () => {
  it("names this package and every peer that carries a context or module state", () => {
    // A new peer fails here until it is either deduped or named stateless with its reason.
    const stateful = Object.keys(manifest.peerDependencies).filter(
      (name) => !STATELESS_PEERS.includes(name),
    )
    expect([...VIEW_BUNDLE_DEDUPE].sort()).toEqual([manifest.name, ...stateful].sort())
  })

  it("names every stateless exception as a real peer", () => {
    for (const name of STATELESS_PEERS) expect(manifest.peerDependencies).toHaveProperty(name)
  })
})
