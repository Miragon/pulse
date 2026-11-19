// @vitest-environment happy-dom
import { act, fireEvent, screen, within } from "@testing-library/react"
import { useState } from "react"
import { afterEach, describe, expect, it } from "vitest"
import {
  SIGNED_OUT_REASONS,
  useToolQuery,
  ViewDataState,
  type ViewComponent,
  type ViewMap,
} from "@miragon/pulse-widget-shell/widgets"
import { catalogs } from "../src/messages/index.js"
import { callsOf, engineList, settled, start, stopPage, viewResult } from "./page.test-support.js"

/**
 * What every page says of itself: one heading, which titles the document (WCAG 2.4.2) per page
 * and per reason, in the page's language; the way back to the start page; and what the page says
 * where the server refuses for good, in a page's words, never a chat's: a start it does not take,
 * and the calls of a page whose session ended, said once, by the frame's notice.
 */

afterEach(stopPage)

const heading = () => screen.getByRole("heading", { level: 1 })

describe("the pages without a view: their one heading titles the document", () => {
  it.each(SIGNED_OUT_REASONS)(
    "the signed-out page, reason %s, in English and German",
    async (reason) => {
      for (const lang of ["en", "de"] as const) {
        document.documentElement.lang = lang
        await start(`/app/signed-out?reason=${reason}`)
        const title = catalogs[lang][`signedOut.${reason}.title`]
        expect(heading().textContent).toBe(title)
        expect(document.title).toBe(`${title} · Pulse`)
        await stopPage()
      }
    },
  )

  it("the page whose session ended before its first read", async () => {
    await start("/app/cockpit?view=jobs", {
      session: () => Response.json({ code: "signed_out", message: "No session." }, { status: 401 }),
    })
    expect(heading().textContent).toBe("Your session has ended")
    expect(document.title).toBe("Your session has ended · Pulse")
    expect(screen.getAllByRole("main")).toHaveLength(1)
  })

  it("the page whose session could not be read, in German", async () => {
    document.documentElement.lang = "de"
    await start("/app", { session: () => new Response("busy", { status: 502 }) })
    expect(heading().textContent).toBe("Pulse antwortet nicht")
    expect(document.title).toBe("Pulse antwortet nicht · Pulse")
  })

  it("names the product, never a link: the start page would only ask for a sign-in", async () => {
    await start("/app/signed-out")
    const banner = screen.getByRole("banner")
    expect(within(banner).getByText("Pulse").tagName).toBe("P")
    expect(within(banner).queryByRole("link")).toBeNull()
  })
})

/** A view whose one heading the user changes, as a drill inside the cockpit does. */
const Drilling: ViewComponent<{ greeting: string }> = ({ data }) => {
  const [title, setTitle] = useState(data.greeting)
  return (
    <>
      <h1>{title}</h1>
      <button type="button" onClick={() => setTitle("Jobs")}>
        Drill
      </button>
    </>
  )
}

describe("a page with a view: the view's heading titles the document", () => {
  const views: ViewMap = { engine_open_cockpit: Drilling as ViewComponent }

  it("names a board's id until the view answers, then the view's heading, which it follows", async () => {
    let answer: (response: Response) => void = () => undefined
    const pending = new Promise<Response>((resolve) => (answer = resolve))
    await start(
      "/app/boards/invoices",
      {
        call: ({ name }) =>
          name === "engine_open_cockpit" ? pending : Response.json(engineList()),
      },
      { views },
    )
    expect(document.title).toBe("Board invoices · Pulse")
    const board = { ...viewResult, structuredContent: { greeting: "Invoice operations" } }
    await act(async () => answer(Response.json({ result: board })))
    await settled()
    expect(document.title).toBe("Invoice operations · Pulse")
    fireEvent.click(screen.getByRole("button", { name: "Drill" }))
    await settled()
    expect(document.title).toBe("Jobs · Pulse")
  })

  it("leads to the start page from its navigation's first entry", async () => {
    await start("/app/cockpit?view=jobs", {}, { views })
    const navigation = within(screen.getByRole("banner")).getByRole("navigation", {
      name: "Pulse",
    })
    const home = within(navigation).getAllByRole("link")[0]
    expect(home.getAttribute("href")).toBe("/app")
    expect(home.textContent).toBe("Start")
  })
})

const UNKNOWN_BOARD = '[UNKNOWN_BOARD] Unknown board id "shipping". Boards: invoices.'
const refusal = (text: string) =>
  Response.json({ result: { isError: true, content: [{ type: "text", text }] } })

describe("a start the server refuses for good", () => {
  it("says what happened and what to do on the page, with no Try again, titled by it", async () => {
    const env = await start("/app/boards/shipping", { call: () => refusal(UNKNOWN_BOARD) })
    expect(heading().textContent).toBe("This board isn't on this server")
    expect(
      screen.getByText("Go to Pulse's start page, which shows this server's boards and engines."),
    ).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull()
    expect(screen.queryByText(/chat/i)).toBeNull()
    // The way there beside the words, in the box: the page's start page.
    const box = screen.getByRole("alert")
    expect(
      within(box).getByRole("link", { name: "Go to the start page" }).getAttribute("href"),
    ).toBe("/app")
    expect(document.title).toBe("This board isn't on this server · Pulse")
    expect(callsOf(env.fetch, "engine_open_cockpit")).toHaveLength(1)
  })

  it("words a view the cockpit does not have for the page, in German", async () => {
    document.documentElement.lang = "de"
    const invalid =
      "Input validation error: Invalid arguments for tool engine_open_cockpit: view: Invalid option"
    await start("/app/cockpit?view=no-such-view", { call: () => refusal(invalid) })
    expect(heading().textContent).toBe("Der Server hat diese Anfrage abgelehnt")
    expect(
      screen.getByText(
        "Den Grund findest du unter Details. Öffne die Ansicht stattdessen von der Startseite von Pulse aus.",
      ),
    ).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Erneut versuchen" })).toBeNull()
    expect(screen.queryByText(/Chat/)).toBeNull()
    expect(screen.getByRole("link", { name: "Zur Startseite" }).getAttribute("href")).toBe("/app")
  })
})

/** A view that reads a feed of its own, as every cockpit section does. */
const Reading: ViewComponent<{ greeting: string }> = () => {
  const feed = useToolQuery<{ rows: number }>(["demo"], "demo_rows_data", {})
  return (
    <ViewDataState
      loading={feed.isPending}
      error={feed.error}
      onRetry={() => void feed.refetch()}
      emptyText="No rows"
    >
      {feed.data && <p>{feed.data.rows} rows</p>}
    </ViewDataState>
  )
}

describe("a page whose session ends while it shows a view", () => {
  it("says it once, in the frame's notice: the view's read asks once and offers no Try again", async () => {
    const ended = () =>
      Response.json({ code: "signed_out", message: "No session." }, { status: 401 })
    const env = await start(
      "/app/cockpit?view=jobs",
      {
        call: (body) =>
          body.name === "demo_rows_data" ? ended() : Response.json({ result: viewResult }),
      },
      { views: { engine_open_cockpit: Reading as ViewComponent } },
    )
    expect(await screen.findByText("Your session has ended")).toBeTruthy()
    // The view's state steps back: a quiet line, no box and no second word of the session.
    expect(
      await screen.findByText("This content couldn't be loaded", undefined, { timeout: 3_000 }),
    ).toBeTruthy()
    expect(screen.queryByRole("alert")).toBeNull()
    expect(screen.queryByText(/signed out|Sign in again to see/)).toBeNull()
    expect(screen.getAllByText(/Your session has ended/)).toHaveLength(1)
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull()
    // The strip's Sign in again is the one way out; the read was asked once, never retried.
    expect(screen.getAllByRole("button", { name: "Sign in again" })).toHaveLength(1)
    expect(callsOf(env.fetch, "demo_rows_data")).toHaveLength(1)
  })
})
