/** The runtime, the identity provider and the login steps of the login tests (src/auth/oauth). */

import { expect } from "vitest"
import { PulseCliError } from "../../src/errors.js"
import { login, type LoginOptions } from "../../src/auth/oauth/login.js"
import { fakeIdp, type FakeIdpOptions } from "./fake-idp.js"
import { fakeRuntime, type FakeRuntime, type FakeRuntimeOptions } from "./fake-runtime.js"
import { loginDeps, oauthConfig, type OAuthOverrides } from "./oauth.js"

export const T0 = 1_700_000_000_000
const URL_LINE = /^ {2}(https?:\/\/\S+)$/m
const OPTIONS: LoginOptions = { noBrowser: true, loginTimeoutMs: 300_000 }

export interface Setup {
  readonly runtime: FakeRuntime
  readonly idp: ReturnType<typeof fakeIdp>
}

export function setup(idp: FakeIdpOptions = {}, runtime: FakeRuntimeOptions = {}): Setup {
  const fake = fakeIdp(idp)
  return { idp: fake, runtime: fakeRuntime({ fetch: fake.fetch, now: () => T0, ...runtime }) }
}

/** A browser that logs in at the fake IdP and follows the redirect to the callback. */
export function browserOf(idp: ReturnType<typeof fakeIdp>, extra: Record<string, string> = {}) {
  return async (url: string, runtime: FakeRuntime) => {
    const query = idp.authorize(url)
    for (const [key, value] of Object.entries(extra)) query.set(key, value)
    await runtime.loopback.request("/callback", query)
    return true
  }
}

/** Waits until the login printed its URL; resolves to it. */
export async function printedUrl(runtime: FakeRuntime): Promise<string> {
  for (let attempt = 0; attempt < 200; attempt++) {
    const match = URL_LINE.exec(runtime.stderr.text())
    if (match?.[1] !== undefined && runtime.stderr.text().includes("Waiting up to")) return match[1]
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  throw new Error(`no URL line in: ${runtime.stderr.text()}`)
}

export function run(test: Setup, config: OAuthOverrides = {}, options: Partial<LoginOptions> = {}) {
  return login(oauthConfig(config), { ...OPTIONS, ...options }, loginDeps(test.runtime))
}

export async function rejection(promise: Promise<unknown>): Promise<PulseCliError> {
  try {
    await promise
  } catch (error) {
    expect(error).toBeInstanceOf(PulseCliError)
    return error as PulseCliError
  }
  throw new Error("expected an error")
}

/** Starts a --no-browser login and returns the callback query the IdP would redirect with. */
export async function started(
  test: Setup,
  config: OAuthOverrides = {},
  options: Partial<LoginOptions> = {},
) {
  const result = run(test, config, options)
  result.catch(() => undefined)
  const url = await printedUrl(test.runtime)
  return { result, url, callback: test.idp.authorize(url) }
}
