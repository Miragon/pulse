import { describe, expect, it } from "vitest"
import { isNormalTarget } from "../http-edge.js"
import {
  isSignedOutReason,
  SIGNED_OUT_REASONS,
  WEB_CODES,
  WEB_CSRF_HEADER,
  WEB_PATHS,
  WEB_QUERY,
} from "./web.js"

describe("the web app's paths", () => {
  it("lie under /app, each in the normal form the listener lets through", () => {
    for (const [name, path] of Object.entries(WEB_PATHS)) {
      expect(path === "/app" || path.startsWith("/app/"), name).toBe(true)
      expect(isNormalTarget(path), name).toBe(true)
    }
  })

  it("name each route once", () => {
    const paths = Object.values(WEB_PATHS)
    expect(new Set(paths).size).toBe(paths.length)
  })

  it("keep the sign-in under /app/auth and the page's API under /app/api", () => {
    expect([WEB_PATHS.login, WEB_PATHS.callback, WEB_PATHS.logout]).toEqual([
      "/app/auth/login",
      "/app/auth/callback",
      "/app/auth/logout",
    ])
    expect([WEB_PATHS.session, WEB_PATHS.call]).toEqual(["/app/api/session", "/app/api/call"])
    expect(WEB_PATHS.signedOut).toBe("/app/signed-out")
    expect(WEB_PATHS.assets).toBe("/app/assets")
  })
})

describe("the web app's wire words", () => {
  it("name the query parameters, the CSRF header and the refusal codes", () => {
    expect(WEB_QUERY).toEqual({ returnTo: "return", reason: "reason" })
    expect(WEB_CSRF_HEADER).toBe("x-pulse-csrf")
    expect(Object.values(WEB_CODES)).toEqual(["signed_out", "WEB_NOT_FOR_PAGES", "WEB_READ_ONLY"])
  })

  it("know every signed-out reason and nothing else", () => {
    expect(SIGNED_OUT_REASONS).toEqual([
      "denied",
      "expired",
      "failed",
      "audience",
      "signed_out",
      "unavailable",
    ])
    for (const reason of SIGNED_OUT_REASONS) expect(isSignedOutReason(reason)).toBe(true)
    for (const value of ["", "Denied", "error", undefined, null, 1, ["denied"]]) {
      expect(isSignedOutReason(value), String(value)).toBe(false)
    }
  })
})
