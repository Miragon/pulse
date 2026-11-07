import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { SurfaceWatch } from "../../dev/orca/worker/surface-watch.js"

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

class Events {
  readonly seen: string[] = []

  changed(caller: string, visible: boolean): void {
    this.seen.push(`${caller} ${visible ? "visible" : "hidden"}`)
  }

  closed(caller: string): void {
    this.seen.push(`${caller} closed`)
  }
}

describe("watching an open surface", () => {
  test("reports visibility changes and keeps the request open until it asks again", async () => {
    const events = new Events()
    const watch = new SurfaceWatch(events)
    const first = watch.watch("frame", true, new AbortController().signal)

    vi.advanceTimersByTime(100_000)

    expect(await first).toEqual({ again: true })
    expect(watch.isVisible("frame")).toBe(true)
    expect(events.seen).toEqual(["frame visible"])
  })

  test("a newer watch releases the older one", async () => {
    const events = new Events()
    const watch = new SurfaceWatch(events)
    const older = watch.watch("frame", true, new AbortController().signal)
    void watch.watch("frame", false, new AbortController().signal)

    expect(await older).toEqual({ again: false })
    expect(events.seen).toEqual(["frame visible", "frame hidden"])
  })

  test("an aborted request closes the surface after a grace period", () => {
    const events = new Events()
    const watch = new SurfaceWatch(events)
    const closing = new AbortController()
    void watch.watch("frame", true, closing.signal)

    closing.abort()
    vi.advanceTimersByTime(4000)
    expect(events.seen).toEqual(["frame visible"])
    vi.advanceTimersByTime(1000)

    expect(events.seen).toEqual(["frame visible", "frame closed"])
    expect(watch.isVisible("frame")).toBe(false)
  })

  test("a reload within the grace period keeps the surface open", () => {
    const events = new Events()
    const watch = new SurfaceWatch(events)
    const first = new AbortController()
    void watch.watch("frame", true, first.signal)

    first.abort()
    void watch.watch("frame", true, new AbortController().signal)
    vi.advanceTimersByTime(10_000)

    expect(events.seen).toEqual(["frame visible"])
  })
})
