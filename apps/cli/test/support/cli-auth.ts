/**
 * Shared helpers of the `operate auth` command tests (src/cli/commands/auth*.test.ts): the fake
 * identity provider with a runtime whose browser completes the login there, and the error line.
 */

import { fakeIdp, type FakeIdpOptions } from "./fake-idp.js"
import {
  CONFIG_PATH,
  fakeRuntime,
  type FakeRuntime,
  type FakeRuntimeOptions,
} from "./fake-runtime.js"
import { oauthProfiles } from "./oauth.js"

export const T0 = 1_700_000_000_000

export function errorOf(stderr: string): Record<string, unknown> {
  const line = stderr.trim().split("\n").at(-1) ?? ""
  return (JSON.parse(line) as { error: Record<string, unknown> }).error
}

export interface LoginSetup {
  idp?: FakeIdpOptions
  runtime?: FakeRuntimeOptions
  files?: Record<string, string>
}

/** The fake identity provider and a runtime at T0 whose browser completes a login there. */
export function loginRuntime(options: LoginSetup = {}) {
  const idp = fakeIdp(options.idp)
  const browser = async (url: string, runtime: FakeRuntime) => {
    await runtime.loopback.request("/callback", idp.authorize(url))
    return true
  }
  const runtime = fakeRuntime({
    fetch: idp.fetch,
    now: () => T0,
    browser,
    files: { [CONFIG_PATH]: oauthProfiles(), ...options.files },
    ...options.runtime,
  })
  return { idp, runtime }
}
