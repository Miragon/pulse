import { expect, test, type Page, type Response } from "@playwright/test"
import { HEALTHY_ENGINE } from "../engines.js"
import { ALICE, BOB, chooseUser, issuedTokens, originOf, signIn } from "./web-sim.js"

/**
 * What the web app keeps from the browser and what it refuses of it, in Chromium against the real
 * server: the session lives in sealed `__Host-` cookies no script reads, no token of the identity
 * provider ever reaches the browser, a request that changes something needs the page's own origin
 * and its CSRF token, a sign-in returns only to a page of the app, a code or a session of someone
 * else gives the browser nothing of theirs, and `/app/` is no alias of `/app`.
 */

const SESSION_COOKIE = "__Host-pulse-session"
const LOGIN_COOKIE = "__Host-pulse-login"
const CSRF_HEADER = "x-pulse-csrf"
const CALL = { name: "engine_list_engines", arguments: {} }

/** What a browser saw: every answer's headers and body, every request's headers. */
interface Seen {
  readonly texts: Promise<string>[]
  readonly authorizations: string[]
}

function watch(page: Page): Seen {
  const seen: Seen = { texts: [], authorizations: [] }
  const keep = async (response: Response): Promise<string> => {
    const headers = JSON.stringify(await response.allHeaders())
    const body = await response.body().then(
      (buffer) => buffer.toString("utf8"),
      () => "",
    )
    return `${response.url()}\n${headers}\n${body}`
  }
  page.on("response", (response) => seen.texts.push(keep(response)))
  page.on("request", (request) => {
    const authorization = request.headers().authorization
    if (authorization !== undefined) seen.authorizations.push(authorization)
  })
  return seen
}

/** The page's storage: local and session storage, IndexedDB's databases and the cache's keys. */
const storageOf = (page: Page): Promise<string> =>
  page.evaluate(async () =>
    JSON.stringify({
      local: { ...localStorage },
      session: { ...sessionStorage },
      databases: await indexedDB.databases(),
      caches: await caches.keys(),
    }),
  )

/** A call of the API from the page itself, with the headers `headers` names. */
const callFromPage = (page: Page, headers: Record<string, string>) =>
  page.evaluate(
    async ({ body, headers }) => {
      const response = await fetch("/app/api/call", {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body,
      })
      return response.status
    },
    { body: JSON.stringify(CALL), headers },
  )

/** The session as the page reads it: its holder's name and its CSRF token, or the status. */
const sessionOf = (page: Page) =>
  page.evaluate(async () => {
    const response = await fetch("/app/api/session")
    return response.ok
      ? ((await response.json()) as { name: string; csrf: string })
      : { status: response.status }
  })

test.describe("the session's cookies", () => {
  test("are HttpOnly, Secure, SameSite=Lax host cookies that no script reads", async ({
    page,
    context,
  }) => {
    await signIn(page)
    const cookies = await context.cookies(originOf())
    const session = cookies.find((cookie) => cookie.name === SESSION_COOKIE)
    expect(session).toMatchObject({
      domain: "localhost",
      path: "/",
      httpOnly: true,
      secure: true,
      sameSite: "Lax",
    })
    // A session of at most 8 h, and the sign-in's own cookie gone with the sign-in.
    expect(session?.expires).toBeGreaterThan(Date.now() / 1000)
    expect(session?.expires).toBeLessThanOrEqual(Date.now() / 1000 + 8 * 3600)
    expect(cookies.map((cookie) => cookie.name)).not.toContain(LOGIN_COOKIE)
    expect(await page.evaluate(() => document.cookie)).toBe("")
  })

  test("hold no token of the identity provider, nor does any answer, header or storage", async ({
    page,
    context,
  }) => {
    const seen = watch(page)
    await signIn(page, `/app/cockpit?view=jobs&engine=${HEALTHY_ENGINE}`)
    const jobs = page.getByRole("region", { name: "Jobs", exact: true })
    await expect(jobs.getByText("Card declined").first()).toBeVisible({ timeout: 15_000 })

    const tokens = await issuedTokens()
    expect(tokens.length).toBeGreaterThan(0)
    const seenTexts = await Promise.all(seen.texts)
    const storage = await storageOf(page)
    const cookies = JSON.stringify(await context.cookies())
    for (const token of tokens) {
      expect(seenTexts.filter((text) => text.includes(token))).toEqual([])
      expect(storage).not.toContain(token)
      expect(cookies).not.toContain(token)
    }
    expect(seen.authorizations).toEqual([])
  })
})

test.describe("a request that changes something", () => {
  test("needs the session's CSRF token in its header, from the page's own origin", async ({
    page,
  }) => {
    await signIn(page)
    const session = await sessionOf(page)
    if (!("csrf" in session)) throw new Error(`no session (${session.status})`)
    expect(await callFromPage(page, {})).toBe(403)
    expect(await callFromPage(page, { [CSRF_HEADER]: "not-the-token" })).toBe(403)
    expect(await callFromPage(page, { [CSRF_HEADER]: session.csrf })).toBe(200)
    // The sign-out without it changes nothing.
    const logout = await page.evaluate(
      async () => (await fetch("/app/auth/logout", { method: "POST" })).status,
    )
    expect(logout).toBe(403)
    expect(await sessionOf(page)).toMatchObject({ name: ALICE.name })
  })

  test("is refused from another site's form, which ends no session", async ({ page }) => {
    await signIn(page)
    const origin = originOf()
    // A page of another site that posts to the API and to the sign-out.
    const field = `${JSON.stringify(CALL).slice(0, -1)},"x":"`
    await page.route("http://attacker.test/", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: `<!doctype html><title>Attacker</title>
          <form id="call" method="post" action="${origin}/app/api/call" enctype="text/plain">
            <input type="hidden" name='${field}' value='"}'><button>Call</button></form>
          <form id="logout" method="post" action="${origin}/app/auth/logout">
            <button>Sign out</button></form>`,
      }),
    )
    for (const form of ["call", "logout"]) {
      await page.goto("http://attacker.test/")
      const answer = page.waitForResponse((response) => response.request().method() === "POST")
      await page.locator(`#${form} button`).click()
      expect([401, 403], form).toContain((await answer).status())
    }
    await page.goto(`${origin}/app`)
    await expect(page.getByText(`Signed in as ${ALICE.name}`)).toBeAttached({ timeout: 15_000 })
  })
})

test.describe("the sign-in", () => {
  test("returns only to a page of the app, whatever the return target names", async ({ page }) => {
    const origin = originOf()
    for (const target of [
      "https://evil.example/app",
      "//evil.example/app",
      "/\\evil.example/app",
      "/app/../../evil",
      "javascript:alert(1)",
    ]) {
      await page.goto(`${origin}/app/auth/login?return=${encodeURIComponent(target)}`)
      await chooseUser(page)
      await page.waitForURL((url) => url.origin === origin && !url.pathname.startsWith("/app/auth"))
      expect(page.url(), target).toBe(`${origin}/app`)
    }
  })

  test("gives a browser no session for someone else's code, and replaces a session planted in it", async ({
    page,
    browser,
  }) => {
    const origin = originOf()
    const attacker = await browser.newContext()
    try {
      // The attacker's own sign-in, up to where the provider sends the browser back with a code,
      // which nothing spends.
      const attackerPage = await attacker.newPage()
      await attackerPage.goto(`${origin}/app/auth/login`)
      const choice = await attackerPage
        .getByRole("link", { name: BOB.username, exact: true })
        .evaluate((link) => (link as HTMLAnchorElement).href)
      const back = await attacker.request.get(choice, { maxRedirects: 0 })
      const callback = back.headers().location ?? ""
      expect(new URL(callback).pathname).toBe("/app/auth/callback")
      expect(new URL(callback).searchParams.get("code")).toBeTruthy()
      // The victim opens it: without the sign-in's own cookie the code gives nothing.
      await page.goto(callback)
      await page.waitForURL((url) => url.pathname === "/app/signed-out")
      expect(new URL(page.url()).searchParams.get("reason")).toBe("failed")
      expect(await sessionOf(page)).toEqual({ status: 401 })

      // The attacker's whole session, planted in the victim's browser.
      await signIn(attackerPage, "/app", { username: BOB.username })
      const planted = (await attacker.cookies(origin)).filter((cookie) =>
        cookie.name.startsWith(SESSION_COOKIE),
      )
      await page.context().addCookies(planted)
      expect(await sessionOf(page)).toMatchObject({ name: BOB.name })
      // The victim signs in: the session is the victim's own, and the attacker's stays the attacker's.
      await page.goto(`${origin}/app/auth/login`)
      await chooseUser(page)
      await page.waitForURL(`${origin}/app`)
      const own = await sessionOf(page)
      const theirs = await sessionOf(attackerPage)
      expect(own).toMatchObject({ name: ALICE.name })
      expect(theirs).toMatchObject({ name: BOB.name })
      if (!("csrf" in own) || !("csrf" in theirs)) throw new Error("a session is missing")
      expect(own.csrf).not.toBe(theirs.csrf)
      const values = (await page.context().cookies(origin)).map((cookie) => cookie.value)
      for (const cookie of planted) expect(values).not.toContain(cookie.value)
    } finally {
      await attacker.close()
    }
  })
})

test("answers /app/ with a trailing slash with the listener's 404", async ({ page }) => {
  const response = await page.goto(`${originOf()}/app/`)
  expect(response?.status()).toBe(404)
  expect(new URL(page.url()).pathname).toBe("/app/")
})
