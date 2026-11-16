import { afterEach, describe, expect, it } from "vitest"
import { ENGINE_FAILURE } from "../tools/test-support/engine-world.js"
import { build, closeBuildEngines, DEGRADE, zerosOf } from "./honest-numbers.test-support.js"

afterEach(closeBuildEngines)

describe.each(Object.entries(DEGRADE))("%s (degrades in place)", (_name, builder) => {
  const places = Object.entries(builder.places)

  it("builds from a healthy engine, reading exactly the declared reads, each figure in its place", async () => {
    const { outcome, reads } = await build(builder)
    expect(outcome.ok ? null : String(outcome.error)).toBeNull()
    expect([...reads].sort()).toEqual(Object.keys(builder.places).sort())
    const data = outcome.ok ? outcome.data : undefined
    for (const [read, place] of places) expect(place(data as never), read).toBeDefined()
  })

  it("shows each failed read in its place and never turns a figure 0", async () => {
    const healthy = await build(builder)
    const zeros = new Set(zerosOf(healthy.outcome.ok ? healthy.outcome.data : undefined))
    const broken = await Promise.all(
      places.map(async ([read, place]) => ({
        read,
        place,
        ...(await build(builder, { read, reply: ENGINE_FAILURE })),
      })),
    )
    for (const { read, place, outcome, reads } of broken) {
      expect(reads, read).toContain(read)
      expect(outcome.ok ? null : String(outcome.error), read).toBeNull()
      if (!outcome.ok) continue
      expect(place(outcome.data as never), read).toBeUndefined()
      expect(
        zerosOf(outcome.data).filter((path) => !zeros.has(path)),
        read,
      ).toEqual([])
    }
  })
})
