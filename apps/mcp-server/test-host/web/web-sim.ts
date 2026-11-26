import AxeBuilder from "@axe-core/playwright"
import { expect, type Page } from "@playwright/test"
import { ENGINE_CONTROL_ENV } from "../engines.js"

/**
 * What the web suite's scenarios share: the deployments global-setup.ts boots (each the real
 * `createApp` under OAuth at `http://localhost:<port>` with its own fake identity provider), the
 * control of those providers, and the browser's steps through a sign-in. Kept free of the server
 * graph, so the spec's workers never load it.
 */

/**
 * The deployments, by the env var that carries each one's origin: `main` over the stub engine and
 * the broken one with test:host's board files (`fixtures/boards`) and access tokens of 300 s;
 * `short` over the stub engine alone, without boards, with access tokens of
 * {@link SHORT_TOKEN_SECONDS}, which the server renews before every call; `adfs` like `short`, its
 * provider a fake ADFS behind the generic OpenID Connect provider (`MCP_OAUTH_OIDC_ISSUER`);
 * `entra` like `short`, its provider a fake Entra ID tenant behind the boot's Entra ID provider
 * (`MCP_OAUTH_ENTRA_*`); `camunda8` over the stub engine and two profiles of test:host's Camunda 8
 * cluster with its board files (`fixtures/camunda8-boards`); `chain` over the stub's chain engine
 * alone (`chain-engine.ts`: an instance that waits for the root incident of the instance it called),
 * without boards; `search` over the stub engine, the Camunda 8 cluster and a refused Camunda 8
 * profile, which the search across engines asks each.
 */
export const DEPLOYMENTS = {
  main: "WEB_SIM_URL",
  short: "WEB_SIM_SHORT_URL",
  adfs: "WEB_SIM_ADFS_URL",
  entra: "WEB_SIM_ENTRA_URL",
  camunda8: "WEB_SIM_CAMUNDA8_URL",
  refusedC8: "WEB_SIM_REFUSED_C8_URL",
  chain: "WEB_SIM_CHAIN_URL",
  search: "WEB_SIM_SEARCH_URL",
} as const
export type Deployment = keyof typeof DEPLOYMENTS

/** The lifetime of the `short` deployment's access tokens: due at once, so every call renews. */
export const SHORT_TOKEN_SECONDS = 5

/** The env var of the control of the deployments' identity providers (global-setup.ts). */
export const CONTROL_ENV = "WEB_SIM_CONTROL_URL"

/** The sign-in client's id at every identity provider of the suite (the fake's default). */
export const WEB_CLIENT_ID = "pulse-web"

/** The users of the fake identity provider: their login names and the names the page shows. */
export const ALICE = { username: "alice", name: "Alice Adams", upn: "alice@example.test" } as const
export const BOB = { username: "bob", name: "Bob Brown" } as const

/**
 * What a deployment's identity provider recorded, as its control answers. The scenarios run in
 * parallel against the same providers, so a scenario reads what its own browser's session did:
 * a session is its `sid`, which {@link signIn} returns.
 */
export interface IdpRecord {
  /** Its issuer, `<serverUrl>/realms/<realm>`, which its endpoints lie below. */
  readonly issuer: string
  /** Every token it issued, by kind. */
  readonly issued: { readonly access: string[]; readonly refresh: string[]; readonly id: string[] }
  /** Every token a client revoked, a refresh token it issued with its session. */
  readonly revoked: readonly { readonly token: string; readonly session?: string }[]
  /** Every session ended at its end-session endpoint. */
  readonly endedSessions: readonly {
    readonly clientId?: string
    readonly postLogoutRedirectUri?: string
    readonly sid?: string
  }[]
  /**
   * Every request to its token endpoint, in order: its grant type, for a refresh the session of the
   * refresh token it presented, and the resources it named.
   */
  readonly grants: readonly {
    readonly type: string
    readonly session?: string
    readonly resources: readonly string[]
  }[]
}

function envOf(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(
      `${name} is unset. Run via \`pnpm --fail-if-no-match --filter @miragon/pulse-mcp-server test:web\``,
    )
  }
  return value
}

/** The origin of a deployment: `MCP_URL`, `http://localhost:<port>`. */
export const originOf = (deployment: Deployment = "main"): string => envOf(DEPLOYMENTS[deployment])

/**
 * The stub engine's control (stub-engine.ts), at the origin global-setup.ts puts into
 * `ENGINE_CONTROL_ENV`: `hold` makes its answers to the search `term` wait, `release` sends them,
 * `waiting` says how many wait.
 */
export async function engineControl(action: "hold" | "release" | "waiting", term: string) {
  const query = new URLSearchParams({ term })
  const method = action === "waiting" ? "GET" : "POST"
  const url = `${envOf(ENGINE_CONTROL_ENV)}/__control/${action}?${query.toString()}`
  const response = await fetch(url, { method })
  expect(response.ok, `stub engine ${action} "${term}"`).toBe(true)
  return (await response.json()) as { waiting?: number }
}

/** What the deployment's identity provider recorded so far. */
export async function idpRecord(deployment: Deployment = "main"): Promise<IdpRecord> {
  const response = await fetch(`${envOf(CONTROL_ENV)}/idp/${deployment}`)
  return (await response.json()) as IdpRecord
}

/** Ends the grant of the session `session` at the deployment's identity provider. */
export async function endGrant(deployment: Deployment, session: string): Promise<void> {
  const query = new URLSearchParams({ session })
  const url = `${envOf(CONTROL_ENV)}/idp/${deployment}/end-grant?${query.toString()}`
  const response = await fetch(url, { method: "POST" })
  expect(response.status, `end the grant of ${session}`).toBe(204)
}

/** Every token the deployment's identity provider issued so far. */
export async function issuedTokens(deployment: Deployment = "main"): Promise<string[]> {
  const { issued } = await idpRecord(deployment)
  return [...issued.access, ...issued.refresh, ...issued.id]
}

/** Plays the user at the fake identity provider's login page: the link of `username`. */
export async function chooseUser(page: Page, username: string = ALICE.username): Promise<void> {
  await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible()
  await page.getByRole("link", { name: username, exact: true }).click()
}

/**
 * Opens `target` (a page and its query) on the deployment, which sends a browser without a session
 * to the identity provider, signs in there as `username` and waits for the page to come back.
 * Resolves with the session the sign-in opened at the provider: the `session_state` the provider
 * sent back to the server's callback, the `sid` of its tokens.
 */
export async function signIn(
  page: Page,
  target = "/app",
  {
    deployment = "main",
    username = ALICE.username,
  }: { deployment?: Deployment; username?: string } = {},
): Promise<string> {
  const origin = originOf(deployment)
  const callback = page.waitForRequest((request) => {
    const url = new URL(request.url())
    return url.origin === origin && url.pathname === "/app/auth/callback"
  })
  await page.goto(`${origin}${target}`)
  await chooseUser(page, username)
  const session = new URL((await callback).url()).searchParams.get("session_state")
  await page.waitForURL(`${origin}${target}`)
  if (!session) throw new Error("The identity provider sent the callback no session_state")
  return session
}

/**
 * The page's navigation on its side, from 64rem on: under that the drawer behind the menu holds
 * it (a dialog of its own, outside the banner).
 */
export const navigation = (page: Page) =>
  page.getByRole("banner").getByRole("navigation", { name: "Pulse" })

/** An entry of the page's navigation by its whole name ("Incidents", "Jobs", an engine's id). */
export const navEntry = (page: Page, name: string) =>
  navigation(page).getByRole("link", { name, exact: true })

/** A tool call the page posted to the API. */
export interface PageCall {
  name: string
  arguments?: Record<string, unknown>
}

/** Every tool call the page posts to the API, in order. */
export function recordCalls(page: Page): PageCall[] {
  const calls: PageCall[] = []
  page.on("request", (request) => {
    if (request.method() === "POST" && new URL(request.url()).pathname === "/app/api/call") {
      calls.push(request.postDataJSON() as PageCall)
    }
  })
  return calls
}

/** The engine of each call of `tool` among `calls`, in the order the page sent them. */
export function engineReadsOf(calls: readonly PageCall[], tool: string): unknown[] {
  return calls.filter((call) => call.name === tool).map((call) => call.arguments?.engine)
}

/** Console errors and uncaught exceptions of the page. */
export function collectErrors(page: Page): string[] {
  const errors: string[] = []
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text())
  })
  page.on("pageerror", (error) => errors.push(error.message))
  return errors
}

/** Two frames after an answer: React has rendered what it changes. */
export async function rendered(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  )
}

/**
 * No finding of axe on what the page shows: WCAG 2.2 A and AA, and axe's best practices, its
 * landmark and heading rules among them (one main landmark, at the top, an h1 per page).
 */
export async function expectNoAxeFinding(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa", "best-practice"])
    .analyze()
  const violations = results.violations.map((violation) => ({
    id: violation.id,
    nodes: violation.nodes.map((node) => node.target.join(" ")).slice(0, 3),
  }))
  expect(violations).toEqual([])
}
