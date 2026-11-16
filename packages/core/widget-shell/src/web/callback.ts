/**
 * GET /app/auth/callback: the identity provider sends the browser back with a code. Nothing is
 * asked of the provider before the request proves it is this browser's sign-in: its login cookie
 * opens, the state matches in constant time, and an `iss` names the provider (RFC 9207, the mix-up
 * defense; required once the provider's metadata says it sends one). Then the code is exchanged as
 * a confidential client, and the access token must pass the gate in front of `/mcp` before it is
 * kept, so a session never holds a token `/mcp` would refuse: one bound to another resource, or to
 * none, fails the sign-in as `audience`. Each sign-in starts a new session, its id and CSRF secret
 * new over whatever the browser carried, so a planted session never survives it; the login cookie
 * is cleared and the browser returns to the page it started from (303). A failure sends it to the
 * signed-out page with its reason, and the log says why, never with a code, a state or a token.
 */
import {
  callbackResult,
  requestToken,
  type ExpectedCallback,
  type ServerMetadata,
  type TokenRecord,
} from "@miragon/pulse-http/oauth"
import { OAuthErrorCode, type AuthInfo, type OAuthError } from "@modelcontextprotocol/server"
import { decodeJwt } from "jose"
import { isAudienceRefusal, nonBlank, type Claims } from "../oauth-shared.js"
import type { SignedOutReason } from "../protocol/web.js"
import { callbackUri, passesBy, redirect, signedOutPage, type WebContext } from "./context.js"
import {
  clearedLogin,
  openLogin,
  parseCookies,
  SESSION_COOKIE,
  sessionCookies,
  type CookieJar,
  type PendingLogin,
} from "./cookies.js"
import { newCsrfSecret } from "./csrf.js"
import { newSessionId, sessionTokensOf, type WebSession } from "./session.js"

const HOUR_MS = 3_600_000

/** The claims a name is read from, in this order; the subject when none holds one. */
const NAME_CLAIMS = ["name", "preferred_username", "email"] as const
const MAX_NAME = 100

/** Why a sign-in ended without a session: the signed-out page's reason, and the log's words. */
class SignInFailure {
  constructor(
    readonly reason: SignedOutReason,
    readonly why: string,
  ) {}
}

interface SignedIn {
  readonly returnTo: string
  readonly setCookies: readonly string[]
}

/** An error code as the log shows it: the characters of a code, at most 64. */
const codeText = (error: string): string => error.replace(/[^A-Za-z0-9_.-]/g, "").slice(0, 64)

async function pendingLogin(
  ctx: WebContext,
  jar: CookieJar,
): Promise<PendingLogin | SignInFailure> {
  const opened = await openLogin(ctx.sealer, jar, ctx.platform.now())
  if (opened === undefined) {
    return new SignInFailure("failed", "the callback came without its login cookie")
  }
  if (opened.ok) return opened.login
  const reason = opened.reason === "expired" ? "expired" : "failed"
  return new SignInFailure(reason, `the login cookie is ${opened.reason}`)
}

/** The callback's code, or why it brings none. */
function codeOf(query: URLSearchParams, expected: ExpectedCallback): string | SignInFailure {
  const result = callbackResult(query, expected)
  if ("code" in result) return result.code
  switch (result.problem) {
    case "state":
      return new SignInFailure("failed", "the callback carries another sign-in's state")
    case "iss":
      return new SignInFailure("failed", "the callback's iss does not name the identity provider")
    case "error": {
      const reason = result.error === "access_denied" ? "denied" : "failed"
      return new SignInFailure(reason, `the identity provider answered ${codeText(result.error)}`)
    }
    case "no-code":
      return new SignInFailure("failed", "the callback carries no code")
  }
}

async function tokensOf(
  ctx: WebContext,
  metadata: ServerMetadata,
  code: string,
  login: PendingLogin,
): Promise<TokenRecord | SignInFailure> {
  const { clientId, clientSecret } = ctx.settings
  const endpoint = {
    url: metadata.tokenEndpoint,
    clientId,
    clientSecret,
    clientAuth: metadata.clientAuth,
  }
  try {
    return await requestToken(
      endpoint,
      {
        type: "authorization_code",
        code,
        redirectUri: callbackUri(ctx.settings),
        verifier: login.verifier,
        resources: [ctx.resource],
      },
      ctx.platform,
    )
  } catch (error) {
    const reason = passesBy(error) ? "unavailable" : "failed"
    return new SignInFailure(
      reason,
      `the token endpoint gave no token (${(error as Error).message})`,
    )
  }
}

/** What the gate makes of the access token: the caller, or why `/mcp` would refuse it. */
async function callerOf(ctx: WebContext, accessToken: string): Promise<AuthInfo | SignInFailure> {
  try {
    return await ctx.verify(accessToken)
  } catch (error) {
    const why = `the gate refuses the access token (${(error as Error).message})`
    if (isAudienceRefusal(error)) return new SignInFailure("audience", why)
    const passing = (error as Partial<OAuthError>).code === OAuthErrorCode.TemporarilyUnavailable
    return new SignInFailure(passing ? "unavailable" : "failed", why)
  }
}

/** The claims of the ID token as the token endpoint sent it, for the name alone. */
function idClaimsOf(idToken: string | undefined): Claims {
  try {
    return decodeJwt(idToken ?? "")
  } catch {
    return {}
  }
}

/**
 * The name the page shows: the ID token's name (when it names the same subject) or the access
 * token's, else its preferred user name or email, else the subject; without control characters,
 * at most 100 characters.
 */
function nameOf(caller: AuthInfo, idToken: string | undefined): string {
  const access = caller.extra?.payload as Claims
  const id = idClaimsOf(idToken)
  const sources = id.sub === access.sub ? [id, access] : [access]
  const found = sources.flatMap((claims) => NAME_CLAIMS.map((name) => nonBlank(claims, name)))
  const name = found.find((value) => value !== undefined) ?? String(access.sub)
  return name.replace(/\p{Cc}/gu, "").slice(0, MAX_NAME)
}

/** A new session for the caller, sealed into the session cookie's chunks. */
async function sessionOf(
  ctx: WebContext,
  tokens: TokenRecord,
  caller: AuthInfo,
  jar: CookieJar,
): Promise<readonly string[] | SignInFailure> {
  const now = ctx.platform.now()
  const expiresAt = now + ctx.settings.sessionHours * HOUR_MS
  const session: WebSession = {
    id: newSessionId(),
    csrf: newCsrfSecret(),
    name: nameOf(caller, tokens.idToken),
    tokens: sessionTokensOf(tokens),
  }
  const sealed = await ctx.sealer.seal(SESSION_COOKIE, session, expiresAt)
  const cookies = sessionCookies(sealed, expiresAt, jar, now)
  if (cookies.fits) return cookies.setCookies
  return new SignInFailure(
    "failed",
    `the session needs ${cookies.bytes} bytes, more than its cookies hold`,
  )
}

async function signIn(
  ctx: WebContext,
  query: URLSearchParams,
  jar: CookieJar,
): Promise<SignedIn | SignInFailure> {
  const login = await pendingLogin(ctx, jar)
  if (login instanceof SignInFailure) return login
  // Before any request to the provider: the state, and an iss that names another issuer.
  const early = codeOf(query, { state: login.state, issuer: ctx.issuer })
  if (early instanceof SignInFailure) return early
  const metadata = await ctx.metadata()
  if (metadata === undefined) {
    return new SignInFailure("unavailable", "the identity provider's metadata did not load")
  }
  const { issuer, issParameterRequired: issRequired } = metadata
  const code = codeOf(query, { state: login.state, issuer, issRequired })
  if (code instanceof SignInFailure) return code
  const tokens = await tokensOf(ctx, metadata, code, login)
  if (tokens instanceof SignInFailure) return tokens
  const caller = await callerOf(ctx, tokens.accessToken)
  if (caller instanceof SignInFailure) return caller
  const setCookies = await sessionOf(ctx, tokens, caller, jar)
  if (setCookies instanceof SignInFailure) return setCookies
  return { returnTo: login.returnTo, setCookies }
}

export function callbackRoute(ctx: WebContext): (request: Request) => Promise<Response> {
  return async (request) => {
    const jar = parseCookies(request.headers.get("cookie"))
    const outcome = await signIn(ctx, new URL(request.url).searchParams, jar)
    if (outcome instanceof SignInFailure) {
      ctx.log(`Web sign-in failed (${outcome.reason}): ${outcome.why}.`)
      return redirect(303, signedOutPage(outcome.reason), [clearedLogin()])
    }
    return redirect(303, outcome.returnTo, [...outcome.setCookies, clearedLogin()])
  }
}
