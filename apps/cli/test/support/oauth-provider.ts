/**
 * Shared setup of the OAuth provider tests (src/auth/oauth/provider*.test.ts): the provider on the
 * fake runtime and the fake identity provider with a settable clock, and the error it rejects with.
 */

import { expect } from "vitest"
import { fakeIdp, type FakeIdpOptions } from "./fake-idp.js"
import { fakeRuntime, type FakeRuntime, fileText } from "./fake-runtime.js"
import { cachedLogin, cacheText, oauthConfig, oauthDeps, TOKEN_FILE } from "./oauth.js"
import { PulseCliError } from "../../src/errors.js"
import type { AuthProvider } from "../../src/auth/types.js"
import { oauthAuth } from "../../src/auth/oauth/provider.js"
import type { CachedLogin, OAuthDeps } from "../../src/auth/oauth/types.js"

export const T0 = 1_700_000_000_000

export interface Setup {
  readonly runtime: FakeRuntime
  readonly idp: ReturnType<typeof fakeIdp>
  readonly deps: OAuthDeps
  clock: number
  provider(config?: Parameters<typeof oauthConfig>[0]): AuthProvider
  stored(): CachedLogin
}

export function setup(
  login: CachedLogin | string | null = cachedLogin(T0),
  options: {
    idp?: FakeIdpOptions
    runtime?: Parameters<typeof fakeRuntime>[0]
    deps?: Partial<OAuthDeps>
  } = {},
): Setup {
  const idp = fakeIdp(options.idp)
  idp.seed("cached-refresh")
  const files =
    login === null ? {} : { [TOKEN_FILE]: typeof login === "string" ? login : cacheText(login) }
  const state = { clock: T0 }
  const runtime = fakeRuntime({
    fetch: idp.fetch,
    files,
    now: () => state.clock,
    ...options.runtime,
  })
  const deps = oauthDeps(runtime, options.deps)
  return {
    runtime,
    idp,
    deps,
    get clock() {
      return state.clock
    },
    set clock(value: number) {
      state.clock = value
    },
    provider: (config) => oauthAuth(oauthConfig(config), deps),
    stored: () => JSON.parse(fileText(runtime, TOKEN_FILE) ?? "null") as CachedLogin,
  }
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
