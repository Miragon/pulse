/**
 * The OAuth tests' outside world: a platform over a scripted fetch with a clock the test sets,
 * and a token endpoint that answers by a function of the form it got.
 */
import type { Platform, TraceEvent } from "../../src/index.js"
import type { TokenFailure } from "../../src/oauth/index.js"
import { type Call, scriptedFetch, type Step } from "../fake-fetch.js"

export const T0 = 1_000_000
export const TOKEN_URL = "https://login.test/oauth/token"

export interface Clock {
  now: number
}

/** A platform over a scripted fetch, its trace recorded, its clock at `start`. */
export function oauthPlatform(steps: readonly Step[], start = T0) {
  const { fetch, calls } = scriptedFetch(steps)
  const clock: Clock = { now: start }
  const events: TraceEvent[] = []
  const platform: Platform = {
    fetch,
    now: () => clock.now,
    trace: (event) => {
      events.push(event)
    },
  }
  return { platform, calls, clock, events }
}

export function formOf(call: Call | undefined): Record<string, string> {
  return Object.fromEntries(new URLSearchParams(call?.body ?? ""))
}

/** A token endpoint: `answer` gets the form of each request; every request is recorded. */
export class TokenServer {
  readonly clock: Clock = { now: T0 }
  readonly forms: URLSearchParams[] = []
  readonly calls: Call[] = []
  answer: (form: URLSearchParams) => Response = () =>
    Response.json({ access_token: `token-${String(this.forms.length)}`, expires_in: 3600 })

  readonly platform: Platform = {
    fetch: scriptedFetch([
      (call) => {
        const form = new URLSearchParams(call.body ?? "")
        this.calls.push(call)
        this.forms.push(form)
        return this.answer(form)
      },
    ]).fetch,
    now: () => this.clock.now,
  }

  get requests(): number {
    return this.forms.length
  }
}

/** `value` without `keys`. */
export function omit<T extends object, K extends keyof T>(value: T, ...keys: K[]): Omit<T, K> {
  const left = Object.entries(value).filter(([key]) => !keys.some((one) => one === key))
  return Object.fromEntries(left) as Omit<T, K>
}

/** What `promise` rejects with; fails when it resolves. */
export async function failureOf(promise: Promise<unknown>): Promise<TokenFailure> {
  try {
    await promise
  } catch (error) {
    return error as TokenFailure
  }
  throw new Error("expected a failure")
}
