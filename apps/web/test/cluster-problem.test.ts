import { readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { clusterProblemOf } from "../src/screens/cluster-problem.js"

/**
 * The Camunda 8 cluster problems a screen words itself (src/screens/cluster-problem.tsx), read off
 * the server's text: held to what the server says, as its error-path goldens pin it on a Camunda 8
 * engine (apps/mcp-server/test/__golden__/error-paths-c8, the board's failure, which a screen feed's
 * error leads with the contract's code), so a change of c8-core's words fails here, not on a page.
 */

const GOLDENS = path.join(import.meta.dirname, "../../mcp-server/test/__golden__/error-paths-c8")

/** The board's failure of a golden case, as a screen feed's tool error says it. */
function screenErrorOf(name: string): Error {
  const golden = JSON.parse(readFileSync(path.join(GOLDENS, `${name}.json`), "utf8")) as {
    probes: Array<{ board?: { engines: Array<{ failure?: { code: string; message: string } }> } }>
  }
  const failure = golden.probes.flatMap((probe) => probe.board?.engines ?? [])[0]?.failure
  if (failure === undefined) throw new Error(`${name} pins no failed engine`)
  return new Error(`[${failure.code}] ${failure.message}`)
}

describe("a Camunda 8 cluster a screen cannot read as it is set up", () => {
  it("is below the version Pulse reads, by the server's words", () => {
    expect(clusterProblemOf(screenErrorOf("version-below-the-floor"))).toEqual({
      kind: "versionFloor",
      floor: "8.9",
      runs: "8.8.12",
    })
  })

  it("runs without secondary storage, by the server's words", () => {
    expect(clusterProblemOf(screenErrorOf("no-secondary-storage"))).toEqual({
      kind: "noSecondaryStorage",
    })
  })

  it("is no problem of its own for any other failure, the kit's to word", () => {
    for (const name of ["wrong-rest-root", "unreachable", "token-endpoint-refusal"]) {
      expect(clusterProblemOf(screenErrorOf(name)), name).toBeUndefined()
    }
    // The words alone, without the contract's code, are an engine's text: no problem of Pulse's.
    expect(
      clusterProblemOf(new Error("Pulse reads Camunda 8.9 or newer. This cluster runs 8.8.12.")),
    ).toBeUndefined()
  })
})
