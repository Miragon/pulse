// @vitest-environment happy-dom
import type { ReactNode } from "react"
import { cleanup, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { TestViewHost } from "@miragon/pulse-widget-shell/widgets"
import { WORLD_SCREENS } from "@miragon/pulse-screens/testing"
import { ENGINE_SCREEN_FEED } from "../src/screens/engine/engine-feed.js"
import { EngineScreen } from "../src/screens/engine/engine-screen.js"
import { ENGINE_VERDICT_FEED } from "../src/screens/engine/verdict-feed.js"
import { StartScreen } from "../src/screens/start/start-screen.js"

/**
 * A Camunda 7 engine's root incidents outside any process on the web app (owner decision of
 * 2026-11-26): the verdict feed answers them beside the verdict, so the page reads nothing more,
 * and the engine screen and the start page show them as a line of their own under the bar, never
 * summed into the processes' incidents; a lower bound where the server's scan stopped.
 */

afterEach(cleanup)

/** An engine whose processes hold no open root incident: the world's screen without them. */
const quietOn = (engine: string) => ({
  ...WORLD_SCREENS.engine,
  engine,
  processes: WORLD_SCREENS.engine.processes.map((process) => ({ ...process, incidents: 0 })),
  webApp: null,
})

/** The verdict feed's answer: degraded by `count` outside any process. */
const degraded = (count: number, atLeast = false) => ({
  status: "warning",
  outsideAnyProcess: { count, atLeast },
})

function host(tools: Record<string, unknown>, children: ReactNode, locale = "en") {
  return render(
    <TestViewHost
      tools={tools}
      locale={locale}
      host={{ timeZone: "UTC" }}
      writes={false}
      followUp="none"
      startPage="/app"
    >
      {children}
    </TestViewHost>,
  )
}

function engineScreen(verdict: unknown, locale = "en") {
  host(
    { [ENGINE_SCREEN_FEED]: quietOn("prod"), [ENGINE_VERDICT_FEED]: verdict },
    <EngineScreen
      engine="prod"
      navigate={vi.fn()}
      filter={{ scope: "all" }}
      onFilter={vi.fn()}
      verdict
    />,
    locale,
  )
}

const lines = () =>
  [...document.querySelectorAll<HTMLElement>('[data-part="outside-any-process"]')].map(
    (line) => line.textContent ?? "",
  )

describe("the engine screen's root incidents outside any process", () => {
  it("shows them under the bar beside the degraded state, no process counting them", async () => {
    engineScreen(degraded(1))
    await waitFor(() => {
      expect(lines()).toHaveLength(1)
    })
    expect(lines()[0]).toContain("1 incident outside any process")
    expect(lines()[0]).toContain("No process counts it, the engine's state does.")
    expect(document.querySelector('[data-part="engine-verdict"]')?.textContent).toBe("Degraded")
  })

  it("says a lower bound where the server's scan stopped, in German too", async () => {
    engineScreen(degraded(2000, true), "de")
    await waitFor(() => {
      expect(lines()).toHaveLength(1)
    })
    expect(lines()[0]).toContain("2.000 Incidents außerhalb von Prozessen")
    expect(lines()[0]).toContain("Es können mehr sein")
  })

  it("shows none from a server whose verdict feed answers the state alone", async () => {
    engineScreen({ status: "warning" })
    await screen.findByText("Degraded")
    expect(lines()).toEqual([])
  })

  it("shows none without one, nor where the verdict could not be read", async () => {
    engineScreen({ status: "ok", outsideAnyProcess: { count: 0, atLeast: false } })
    await screen.findByText("Stable")
    expect(lines()).toEqual([])
    cleanup()
    engineScreen({ isError: true, content: [{ type: "text", text: "[unreachable] down" }] })
    await screen.findByRole("heading", { name: "prod" })
    expect(lines()).toEqual([])
  })
})

describe("the start page's root incidents outside any process", () => {
  it("names each engine's under the bar, its incidents in the table its processes' alone", async () => {
    host(
      {
        engine_list_engines: {
          engines: [
            { id: "prod-a", dialect: "c7" },
            { id: "prod-b", dialect: "c7" },
          ],
        },
        [ENGINE_SCREEN_FEED]: ({ engine }: { engine: string }) => quietOn(engine),
        [ENGINE_VERDICT_FEED]: ({ engine }: { engine: string }) =>
          engine === "prod-a"
            ? degraded(1)
            : { status: "ok", outsideAnyProcess: { count: 0, atLeast: false } },
      },
      <StartScreen navigate={vi.fn()} replace={vi.fn()} />,
    )
    await waitFor(() => {
      expect(lines()).toHaveLength(1)
    })
    expect(lines()[0]).toContain("prod-a: 1 incident outside any process")
    const row = within(screen.getByRole("table", { name: "Engines" })).getByRole("row", {
      name: "Engine prod-a",
    })
    expect(row.querySelector('[data-part="root-incident-count"]')?.textContent).toBe("0")
    // The column says whose they are, as the chat's tile does.
    expect(screen.getByRole("columnheader", { name: "Incidents in processes" })).toBeTruthy()
  })
})
