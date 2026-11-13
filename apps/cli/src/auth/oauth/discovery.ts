/**
 * The authorization server's endpoints: the configured explicit endpoints, or OpenID Connect
 * discovery with the RFC 8414 location as fallback, which @miragon/pulse-http/oauth runs and
 * checks (the issuer exactly, PKCE S256, a client authentication pulse can do, endpoints on https
 * or a loopback host by the profile format's one rule) and this module words. Only
 * `pulse auth login` discovers; refreshes and logout use the endpoints cached at login.
 */

import {
  type DiscoveryAnswer,
  discover,
  type MetadataProblem,
  serverMetadata as metadataOf,
  type TokenFailure,
} from "@miragon/pulse-http/oauth"
import { configError } from "../../config/config-error.js"
import { ISSUER_EXAMPLE, isLoopbackHost, oauthUrlError } from "../../config/oauth.js"
import { endpointSource } from "../../config/resolve-oauth.js"
import { ENV, type OAuthConfig } from "../../config/types.js"
import { PulseCliError } from "../../errors.js"
import { profileToSet } from "../../util.js"
import {
  limitsOf,
  platformOf,
  sanitize,
  shownUrl,
  statusLine,
  statusOf,
  unreachable,
} from "./http.js"
import type { OAuthDeps, ServerMetadata } from "./types.js"

const OIDC_PATH = "/.well-known/openid-configuration"

const DISCOVERY_HINT = `The issuer is the URL in front of ${OIDC_PATH}, e.g. ${ISSUER_EXAMPLE}; or configure both endpoints (--oauth-authorization-endpoint, --oauth-token-endpoint).`

/** `GET <url> → <status>`. */
function attempt(answer: DiscoveryAnswer): string {
  return `GET ${shownUrl(answer.url)} → ${statusOf(answer)}`
}

/**
 * CONFIG for an unusable discovery answer; `earlier` is the OpenID Connect answer (404) when the
 * RFC 8414 location was tried after it, so the message names the URL the hint talks about.
 */
function failed(
  answer: DiscoveryAnswer,
  problem?: string,
  earlier?: DiscoveryAnswer,
): PulseCliError {
  const suffix = problem === undefined ? "" : `, ${problem}`
  const before = earlier === undefined ? "" : `${attempt(earlier)}, then `
  return configError(`OAuth discovery failed: ${before}${attempt(answer)}${suffix}`, DISCOVERY_HINT)
}

function serverFailed(answer: DiscoveryAnswer): PulseCliError {
  return new PulseCliError(
    "HTTP_SERVER_ERROR",
    `The authorization server failed: ${statusLine(answer)}`,
    {
      status: answer.status,
      request: { method: "GET", url: shownUrl(answer.url) },
      hint: "Retry later.",
    },
  )
}

/** The discovery document of `issuer`, with the answer that carried it. */
async function fetchDocument(issuer: string, config: OAuthConfig, deps: OAuthDeps) {
  let answers: readonly DiscoveryAnswer[]
  try {
    answers = await discover(issuer, platformOf(deps), limitsOf(deps))
  } catch (error) {
    // For the issuer validateOAuthUrl let through, a TokenFailure of a request without an answer.
    const failure = error as TokenFailure
    const endpoint = { url: failure.url ?? issuer, source: endpointSource(config) }
    throw unreachable(failure, "GET", endpoint, deps.timeoutMs)
  }
  const [first, second] = answers as [DiscoveryAnswer, DiscoveryAnswer?]
  const answer = second ?? first
  if (answer.status >= 500) throw serverFailed(answer)
  if (answer.status !== 200)
    throw failed(answer, undefined, second === undefined ? undefined : first)
  if (answer.json === undefined) throw failed(answer, "but the answer is not a JSON object")
  return { answer, document: answer.json }
}

/**
 * Where to fix the issuer. The document's value stays out of the command: hints are run as they
 * are, and the value comes from the server (the message shows it).
 */
function issuerFix(config: OAuthConfig): string {
  return config.sources.endpoints === "env"
    ? `${ENV.oauthIssuer}=<issuer>`
    : `pulse config set ${profileToSet(config.profile)} --oauth-issuer <issuer>`
}

const ENDPOINT_KINDS = {
  authorization_endpoint: "authorization endpoint",
  token_endpoint: "token endpoint",
} as const

/** Why the document cannot be used, worded as the CLI says it. */
function problemError(
  found: MetadataProblem,
  answer: DiscoveryAnswer,
  issuer: string,
  config: OAuthConfig,
): PulseCliError {
  switch (found.problem) {
    case "no-issuer":
      return failed(answer, "but the document has no issuer")
    case "other-issuer":
      return configError(
        `The discovery document names issuer "${sanitize(found.named)}", not "${issuer}"`,
        `Set the issuer exactly as the document names it (Auth0 issuers end with "/"): ${issuerFix(config)}.`,
      )
    case "no-endpoint":
      return failed(answer, `but the document has no ${found.key}`)
    case "endpoint-url":
      // Worded as for a configured URL: the package's rule is the CLI's (discovery.test.ts).
      return oauthUrlError(
        found.url.trim(),
        ENDPOINT_KINDS[found.key],
        `${found.key} of the discovery document`,
        found.urlProblem,
      )
    case "no-pkce":
      return configError(
        `The authorization server ${issuer} does not support PKCE with S256`,
        "Its discovery document lists code_challenge_methods_supported without S256; pulse only uses S256 (RFC 7636, RFC 9700). Enable S256 for the client.",
      )
    case "client-auth":
      return configError(
        "The authorization server supports neither client_secret_basic nor client_secret_post",
        "pulse authenticates a confidential client with its secret only. Use a public client (no client secret) with PKCE.",
      )
  }
}

async function discovered(
  issuer: string,
  config: OAuthConfig,
  deps: OAuthDeps,
): Promise<ServerMetadata> {
  const { answer, document } = await fetchDocument(issuer, config, deps)
  const needs = { confidential: config.clientSecret !== undefined, isLoopback: isLoopbackHost }
  const found = metadataOf(document, issuer, needs)
  if ("problem" in found) throw problemError(found, answer, issuer, config)
  return {
    issuer,
    authorizationEndpoint: found.authorizationEndpoint,
    tokenEndpoint: found.tokenEndpoint,
    revocationEndpoint: found.revocationEndpoint ?? null,
    issParameterRequired: found.issParameterRequired,
    clientAuthMethod: found.clientAuth === "post" ? "client_secret_post" : "client_secret_basic",
  }
}

/** The endpoints of the login: the configured ones (no request), else discovered. */
export async function serverMetadata(
  config: OAuthConfig,
  deps: OAuthDeps,
): Promise<ServerMetadata> {
  const { issuer, authorizationEndpoint, tokenEndpoint } = config
  if (authorizationEndpoint !== undefined && tokenEndpoint !== undefined) {
    return {
      issuer: issuer ?? null,
      authorizationEndpoint,
      tokenEndpoint,
      revocationEndpoint: null,
      issParameterRequired: false,
      clientAuthMethod: "client_secret_basic",
    }
  }
  // resolution guarantees an issuer without endpoints
  return discovered(issuer ?? "", config, deps)
}
