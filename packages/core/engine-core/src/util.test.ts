import { describe, expect, it } from "vitest"
import { compact, isRecord, mapLimit, omit } from "./util.js"

/** A promise and the functions that settle it. */
function deferred<T>() {
  let resolve: (value: T) => void = () => undefined
  let reject: (error: Error) => void = () => undefined
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve
    reject = onReject
  })
  return { promise, resolve, reject }
}

describe("compact, omit, isRecord", () => {
  it("drops undefined values, leaves out one key and tells plain objects", () => {
    expect(compact({ a: 1, b: undefined, c: null })).toEqual({ a: 1, c: null })
    expect(omit({ a: 1, b: 2, c: undefined }, "b")).toEqual({ a: 1, c: undefined })
    expect([isRecord({}), isRecord([]), isRecord(null), isRecord("x")]).toEqual([
      true,
      false,
      false,
      false,
    ])
  })
})

describe("mapLimit", () => {
  it("runs at most `limit` calls at a time and keeps the order of the items", async () => {
    const pending = [0, 1, 2].map(() => deferred<string>())
    const started: number[] = []
    const result = mapLimit([0, 1, 2], 2, (item) => {
      started.push(item)
      return pending[item]?.promise ?? Promise.resolve("")
    })
    await Promise.resolve()
    expect(started).toEqual([0, 1])
    pending[1]?.resolve("b")
    pending[0]?.resolve("a")
    await pending[0]?.promise
    pending[2]?.resolve("c")
    expect(await result).toEqual(["a", "b", "c"])
    expect(started).toEqual([0, 1, 2])
    expect(await mapLimit([], 8, () => Promise.resolve(1))).toEqual([])
  })

  it("rejects with the first failure and starts no further item", async () => {
    const pending = [0, 1, 2].map(() => deferred<number>())
    const started: number[] = []
    const result = mapLimit([0, 1, 2], 2, (item) => {
      started.push(item)
      return pending[item]?.promise ?? Promise.resolve(0)
    })
    await Promise.resolve()
    pending[0]?.reject(new Error("boom"))
    await expect(result).rejects.toThrow("boom")
    pending[1]?.resolve(1)
    await pending[1]?.promise
    expect(started).toEqual([0, 1])
  })
})
