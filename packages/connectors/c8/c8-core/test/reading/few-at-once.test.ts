import { describe, expect, test } from "vitest"
import { FewAtOnce } from "../../src/reading/few-at-once.js"

const later = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

describe("reads few at once", () => {
  test("keep the items' order and run at most READS of them at a time", async () => {
    let running = 0
    let most = 0
    const items = Array.from({ length: 20 }, (_, index) => index)

    const results = await FewAtOnce.map(items, async (item) => {
      running += 1
      most = Math.max(most, running)
      await later(20 - item)
      running -= 1
      return item * 2
    })

    expect(results).toEqual(items.map((item) => item * 2))
    expect(most).toBe(FewAtOnce.READS)
  })

  test("read each of fewer items than READS at once", async () => {
    let running = 0
    let most = 0

    const results = await FewAtOnce.map(["a", "b", "c"], async (item) => {
      running += 1
      most = Math.max(most, running)
      await later(1)
      running -= 1
      return item.toUpperCase()
    })

    expect(results).toEqual(["A", "B", "C"])
    expect(most).toBe(3)
  })

  test("fail as the first read fails and start no further read", async () => {
    const started: number[] = []
    const items = Array.from({ length: 20 }, (_, index) => index)

    const read = FewAtOnce.map(items, async (item) => {
      started.push(item)
      if (item === 2) {
        throw new Error("the cluster refused")
      }
      await later(5)
      return item
    })

    await expect(read).rejects.toThrow("the cluster refused")
    await later(20)
    expect(started).toEqual(items.slice(0, FewAtOnce.READS))
  })

  test("answer no items with no read", async () => {
    expect(await FewAtOnce.map([], () => Promise.reject(new Error("never")))).toEqual([])
  })
})
