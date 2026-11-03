import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  createToast,
  createToastTimer,
  MAX_VISIBLE_TOASTS,
  resolveToastTone,
  TOAST_DURATION_MS,
  TOAST_ERROR_DURATION_MS,
  toastDuration,
  toastReducer,
  type ToastClock,
  type ToastItem,
  type ToastOptions,
} from "./toast-model.js"

const item = (id: number): ToastItem => createToast(id, { title: `t${id}` })

describe("toastDuration (CI §8: about 2.8 s, errors about 5 s)", () => {
  it("defaults to 2.8 s and gives errors 5 s", () => {
    expect(TOAST_DURATION_MS).toBe(2800)
    expect(TOAST_ERROR_DURATION_MS).toBe(5000)
    expect(toastDuration("success")).toBe(2800)
    expect(toastDuration("info")).toBe(2800)
    expect(toastDuration("warning")).toBe(2800)
    expect(toastDuration("danger")).toBe(5000)
  })

  it("honours an explicit positive duration and ignores an unusable one", () => {
    expect(toastDuration("danger", 1200)).toBe(1200)
    expect(toastDuration("info", 0)).toBe(2800)
    expect(toastDuration("info", -5)).toBe(2800)
    expect(toastDuration("danger", Number.NaN)).toBe(5000)
    expect(toastDuration("danger", Number.POSITIVE_INFINITY)).toBe(5000)
  })
})

describe("createToast", () => {
  it("defaults to the info tone and drops an empty description", () => {
    expect(createToast(1, { title: "Saved" })).toEqual({
      id: 1,
      tone: "info",
      title: "Saved",
      duration: 2800,
    })
    expect(createToast(2, { title: "x", description: "" })).not.toHaveProperty("description")
  })

  it("keeps tone, description and the tone's duration", () => {
    expect(createToast(3, { tone: "danger", title: "Failed", description: "503" })).toEqual({
      id: 3,
      tone: "danger",
      title: "Failed",
      description: "503",
      duration: 5000,
    })
  })

  it("resolves an untyped retired tone instead of keeping a name no icon exists for", () => {
    // Plain JS or wire data: `error` is `danger`, with the error toast's 5 s.
    const fromWire = { tone: "error", title: "Failed" } as unknown as ToastOptions
    expect(createToast(4, fromWire)).toMatchObject({ tone: "danger", duration: 5000 })
    const unknown = { tone: "purple", title: "x" } as unknown as ToastOptions
    expect(createToast(5, unknown).tone).toBe("info")
  })
})

describe("resolveToastTone (fail-soft for an untyped tone)", () => {
  it("keeps the four toast tones and maps a retired name through resolveTone", () => {
    for (const tone of ["success", "warning", "danger", "info"] as const) {
      expect(resolveToastTone(tone)).toBe(tone)
    }
    expect(resolveToastTone("critical")).toBe("danger")
    expect(resolveToastTone("Warn")).toBe("warning")
    expect(resolveToastTone("ok")).toBe("success")
    expect(resolveToastTone("notice")).toBe("info")
  })

  it("shows neutral, unknown and missing tones as info (a toast has no neutral edge)", () => {
    expect(resolveToastTone("neutral")).toBe("info")
    expect(resolveToastTone("secondary")).toBe("info")
    expect(resolveToastTone("purple")).toBe("info")
    expect(resolveToastTone(undefined)).toBe("info")
    expect(resolveToastTone(42)).toBe("info")
  })
})

describe("toastReducer", () => {
  it("appends and keeps at most the newest MAX_VISIBLE_TOASTS", () => {
    expect(MAX_VISIBLE_TOASTS).toBe(3)
    let state: ToastItem[] = []
    for (let id = 1; id <= 4; id++) state = toastReducer(state, { type: "add", toast: item(id) })
    expect(state.map((t) => t.id)).toEqual([2, 3, 4])
  })

  it("dismisses by id and keeps the list identity when nothing matches", () => {
    const state = [item(1), item(2)]
    expect(toastReducer(state, { type: "dismiss", id: 1 }).map((t) => t.id)).toEqual([2])
    expect(toastReducer(state, { type: "dismiss", id: 9 })).toBe(state)
  })
})

describe("createToastTimer (a held toast resumes its REMAINING time)", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it("expires once, after the full duration, when nothing holds it", () => {
    const onExpire = vi.fn()
    const timer = createToastTimer(2800, onExpire)
    expect(timer.remaining()).toBe(2800)
    vi.advanceTimersByTime(2799)
    expect(onExpire).not.toHaveBeenCalled()
    expect(timer.remaining()).toBe(1)
    vi.advanceTimersByTime(1)
    expect(onExpire).toHaveBeenCalledTimes(1)
    expect(timer.remaining()).toBe(0)
    vi.advanceTimersByTime(10_000)
    expect(onExpire).toHaveBeenCalledTimes(1)
  })

  it("pauses while held and resumes with the time that was left, not a fresh duration", () => {
    const onExpire = vi.fn()
    const timer = createToastTimer(2800, onExpire)
    vi.advanceTimersByTime(1000)
    timer.hold("pointer")
    expect(timer.remaining()).toBe(1800)
    vi.advanceTimersByTime(60_000) // reading for a minute: nothing runs out
    expect(onExpire).not.toHaveBeenCalled()
    expect(timer.remaining()).toBe(1800)
    timer.release("pointer")
    vi.advanceTimersByTime(1799)
    expect(onExpire).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(onExpire).toHaveBeenCalledTimes(1)
  })

  it("keeps counting down across several holds (each resume continues the rest)", () => {
    const onExpire = vi.fn()
    const timer = createToastTimer(5000, onExpire)
    vi.advanceTimersByTime(2000)
    timer.hold("pointer")
    vi.advanceTimersByTime(500)
    timer.release("pointer")
    vi.advanceTimersByTime(2000)
    timer.hold("focus")
    expect(timer.remaining()).toBe(1000)
    timer.release("focus")
    vi.advanceTimersByTime(999)
    expect(onExpire).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(onExpire).toHaveBeenCalledTimes(1)
  })

  it("stays held until EVERY reason is released (hover and keyboard focus overlap)", () => {
    const onExpire = vi.fn()
    const timer = createToastTimer(1000, onExpire)
    timer.hold("pointer")
    timer.hold("focus")
    timer.hold("focus")
    timer.release("pointer")
    vi.advanceTimersByTime(5000)
    expect(onExpire).not.toHaveBeenCalled()
    timer.release("unknown")
    vi.advanceTimersByTime(5000)
    expect(onExpire).not.toHaveBeenCalled()
    timer.release("focus")
    vi.advanceTimersByTime(1000)
    expect(onExpire).toHaveBeenCalledTimes(1)
  })

  it("never fires after cancel, released or not", () => {
    const onExpire = vi.fn()
    const timer = createToastTimer(1000, onExpire)
    vi.advanceTimersByTime(400)
    timer.cancel()
    expect(timer.remaining()).toBe(600)
    timer.release("pointer")
    vi.advanceTimersByTime(5000)
    expect(onExpire).not.toHaveBeenCalled()
    const held = createToastTimer(1000, onExpire)
    held.hold("focus")
    held.cancel()
    held.release("focus")
    vi.advanceTimersByTime(5000)
    expect(onExpire).not.toHaveBeenCalled()
  })

  it("expires at once for a non-positive duration", () => {
    const onExpire = vi.fn()
    const timer = createToastTimer(-50, onExpire)
    expect(timer.remaining()).toBe(0)
    vi.advanceTimersByTime(0)
    expect(onExpire).toHaveBeenCalledTimes(1)
  })

  it("runs on an injected clock and clears the handle it scheduled", () => {
    let now = 100
    const pending = new Map<number, () => void>()
    let nextHandle = 0
    const cleared: unknown[] = []
    const scheduled: number[] = []
    const clock: ToastClock = {
      now: () => now,
      setTimeout: (callback, ms) => {
        nextHandle += 1
        pending.set(nextHandle, callback)
        scheduled.push(ms)
        return nextHandle
      },
      clearTimeout: (handle) => {
        cleared.push(handle)
        pending.delete(handle as number)
      },
    }
    const onExpire = vi.fn()
    const timer = createToastTimer(2800, onExpire, clock)
    expect(scheduled).toEqual([2800])
    now += 800
    timer.hold("pointer")
    expect(cleared).toEqual([1])
    expect(pending.size).toBe(0)
    now += 10_000
    timer.release("pointer")
    expect(scheduled).toEqual([2800, 2000])
    now += 2000
    pending.get(2)?.()
    expect(onExpire).toHaveBeenCalledTimes(1)
    expect(timer.remaining()).toBe(0)
  })
})
