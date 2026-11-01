/**
 * Pure model behind `ToastProvider` / `useToast`: the toast list as a reducer
 * plus the timing rules, so both are testable without a DOM (the house path,
 * FITNESS.md) and the component stays a thin view over them.
 */

import { resolveTone } from "./tone-utils.js"

/** Status tone of a toast — the four status roles (`--success` … `--info`). */
export type ToastTone = "success" | "warning" | "danger" | "info"

/**
 * The toast tone of any tone name: the four status tones as is, a retired
 * name through `resolveTone` (`error` → `danger`), and `neutral` or anything
 * unknown as `info`. Keeps a toast whose tone arrives untyped (plain JS, wire
 * data) on the screen instead of crashing the view on a missing icon.
 */
export function resolveToastTone(name: unknown): ToastTone {
  const tone = resolveTone(name, "info")
  return tone === "neutral" ? "info" : tone
}

/** What a caller passes to `useToast().show(...)`. */
export interface ToastOptions {
  /**
   * Status tone; drives the edge, the icon and the default duration. Default
   * `"info"`. An untyped retired name still resolves ({@link resolveToastTone}).
   */
  tone?: ToastTone
  /** The message. Say what happened, in one short sentence ("Job retried."). */
  title: string
  /** Optional second line (what you can do next, or the affected object). */
  description?: string
  /** Auto-dismiss after this many ms. Defaults per {@link toastDuration}. */
  duration?: number
}

/** A toast as it sits in the list. */
export interface ToastItem {
  id: number
  tone: ToastTone
  title: string
  description?: string
  duration: number
}

/** Default lifetime of a toast (CI §8: about 2.8 s). */
export const TOAST_DURATION_MS = 2800
/** Lifetime of an error toast (CI §8: about 5 s) — long enough to read the reason. */
export const TOAST_ERROR_DURATION_MS = 5000
/** At most this many toasts stack; the oldest leaves first. */
export const MAX_VISIBLE_TOASTS = 3

/** The lifetime of a toast: an explicit positive duration, else the tone's default. */
export function toastDuration(tone: ToastTone, explicit?: number): number {
  if (explicit !== undefined && Number.isFinite(explicit) && explicit > 0) return explicit
  return tone === "danger" ? TOAST_ERROR_DURATION_MS : TOAST_DURATION_MS
}

/** Normalise caller options into a list item. */
export function createToast(id: number, options: ToastOptions): ToastItem {
  const tone = resolveToastTone(options.tone)
  return {
    id,
    tone,
    title: options.title,
    ...(options.description ? { description: options.description } : {}),
    duration: toastDuration(tone, options.duration),
  }
}

export type ToastAction = { type: "add"; toast: ToastItem } | { type: "dismiss"; id: number }

/** Add appends (dropping the oldest beyond {@link MAX_VISIBLE_TOASTS}); dismiss removes by id. */
export function toastReducer(state: readonly ToastItem[], action: ToastAction): ToastItem[] {
  if (action.type === "add") return [...state, action.toast].slice(-MAX_VISIBLE_TOASTS)
  const next = state.filter((t) => t.id !== action.id)
  return next.length === state.length ? (state as ToastItem[]) : next
}

/**
 * The clock a {@link createToastTimer} runs on. The default reads the global
 * timers at call time, so fake timers installed in a test take effect.
 */
export interface ToastClock {
  now: () => number
  setTimeout: (callback: () => void, ms: number) => unknown
  clearTimeout: (handle: unknown) => void
}

const SYSTEM_CLOCK: ToastClock = {
  now: () => Date.now(),
  setTimeout: (callback, ms) => globalThis.setTimeout(callback, ms),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
}

/** The countdown of one toast (see {@link createToastTimer}). */
export interface ToastTimer {
  /**
   * Hold the toast for `reason` (`"pointer"`, `"focus"`): the countdown
   * pauses and keeps the time that was left.
   */
  hold: (reason: string) => void
  /** Release `reason`; once nothing holds the toast, it resumes with the time that was left. */
  release: (reason: string) => void
  /** The time left in ms — frozen while held. */
  remaining: () => number
  /** Stop for good (the toast left early or unmounted); `onExpire` never fires afterwards. */
  cancel: () => void
}

/**
 * A pausable countdown: starts at once, pauses while anything holds it
 * (hover, keyboard focus — so a reader can finish), and on release RESUMES
 * WITH THE REMAINING TIME instead of restarting the full duration. Fires
 * `onExpire` once.
 */
export function createToastTimer(
  duration: number,
  onExpire: () => void,
  clock: ToastClock = SYSTEM_CLOCK,
): ToastTimer {
  let left = Math.max(duration, 0)
  let startedAt = 0
  let handle: unknown
  let running = false
  let finished = false
  const holds = new Set<string>()

  const elapsed = () => (running ? clock.now() - startedAt : 0)
  const start = () => {
    if (finished || running || holds.size > 0) return
    running = true
    startedAt = clock.now()
    handle = clock.setTimeout(() => {
      running = false
      finished = true
      left = 0
      onExpire()
    }, left)
  }
  const pause = () => {
    if (!running) return
    left = Math.max(left - elapsed(), 0)
    running = false
    clock.clearTimeout(handle)
  }

  start()
  return {
    hold: (reason) => {
      holds.add(reason)
      pause()
    },
    release: (reason) => {
      holds.delete(reason)
      start()
    },
    remaining: () => Math.max(left - elapsed(), 0),
    cancel: () => {
      pause()
      finished = true
    },
  }
}
