import AxeBuilder from "@axe-core/playwright"
import { expect, type Page } from "@playwright/test"

/**
 * What the web suite's scenarios share: the deployments global-setup.ts boots (each the real
 * `createApp` under OAuth at `http://localhost:<port>` with its own fake identity provider), the
 * control of those providers, and the browser's steps through a sign-in. Kept free of the server
 * graph, so the spec's workers never load it.
 */

/**
 * The deployments, by the env var that carries each one's origin: `main` over the stub engine and
 * the broken one with test:host's board files (`fixtures/boards`) and access tokens of 300 s;
 * `short` over the stub engine alone, without boards, with access tokens of 5 s, which the server
 * renews before every call.
 */
export const DEPLOYMENTS = { main: "WEB_SIM_URL", short: "WEB_SIM_SHORT_URL" } as const
export type Deployment = keyof typeof DEPLOYMENTS

/** The env var of the control of the deployments' identity providers (global-setup.ts). */
export const CONTROL_ENV = "WEB_SIM_CONTROL_URL"

/** The sign-in client's id at every identity provider of the suite (the fake's default). */
export const WEB_CLIENT_ID = "pulse-web"

/** The users of the fake identity provider: their login names and the names the page shows. */
export const ALICE = { username: "alice", name: "Alice Adams" } as const
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
   * Every request to its token endpoint, in order: its grant type and, for a refresh, the session
   * of the refresh token it presented.
   */
  readonly grants: readonly { readonly type: string; readonly session?: string }[]
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

/** What the deployment's identity provider recorded so far. */
export async function idpRecord(deployment: Deployment = "main"): Promise<IdpRecord> {
  const response = await fetch(`${envOf(CONTROL_ENV)}/idp/${deployment}`)
  return (await response.json()) as IdpRecord
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

/** No finding of axe at WCAG 2.2 A and AA on what the page shows. */
export async function expectNoAxeFinding(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa"])
    .analyze()
  expect(results.violations.map((violation) => violation.id)).toEqual([])
}
