// @vitest-environment happy-dom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react"
import { isValidElement, useState, type ReactNode } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { TestViewHost, type HostAction } from "@miragon/pulse-widget-shell/widgets"
import type { ProcessScreenData } from "@miragon/pulse-screens"
import { WORLD_SCREENS } from "@miragon/pulse-screens/testing"
import { BPMN_XML_FEED } from "../src/screens/instance/instance-feed.js"
import { INSTANCES_FEED, PROCESS_SCREEN_FEED } from "../src/screens/process/process-feed.js"
import { ProcessScreen } from "../src/screens/process/process-screen.js"
import type { ScreenProcess } from "../src/screens/process/screen-process.js"
import { useTenantAddress } from "../src/screens/process/tenant-address.js"
import { WIDE } from "../src/screens/use-wide.js"
import { reset } from "./bpmn-viewer.test-support.js"

/**
 * The process screen of a process in a tenant (owner decision 2026-11-26, F17): it reads the
 * process feed by key and tenant, and its bar names the tenant beside the engine, in English and
 * in German; a process without a tenant names none. A process its key names alone that the feed
 * answers in a tenant names that tenant in the address, read once; a tenant that deploys no
 * version of the key is named in the refusal.
 */

vi.mock("bpmn-js/lib/NavigatedViewer", async () => ({
  default: (await import("./bpmn-viewer.test-support.js")).FakeViewer,
}))

beforeEach(() => {
  reset()
  window.matchMedia = ((query: string) => ({
    matches: query === WIDE,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia
})

afterEach(cleanup)

const IN_NORTH: ProcessScreenData = {
  ...WORLD_SCREENS.process,
  tenantId: "north",
  selected: WORLD_SCREENS.process.selected && {
    ...WORLD_SCREENS.process.selected,
    tenantId: "north",
  },
}

/** The process screen of `process` on prod-a. */
function Screen({ process }: { readonly process: ScreenProcess }) {
  return (
    <ProcessScreen
      engine="prod-a"
      process={process}
      filter={{ scope: "running" }}
      navigate={() => {}}
      onFilter={() => {}}
      onVersion={() => {}}
    />
  )
}

/** The screen at an address that names `first`, which gives way to the tenant it shows. */
function AtAddress({ first, named }: { first: ScreenProcess; named: (tenant: string) => void }) {
  const [process, setProcess] = useState(first)
  useTenantAddress("prod-a", process, undefined, (tenantId) => {
    named(tenantId)
    setProcess({ key: first.key, tenantId })
  })
  return <Screen process={process} />
}

/** A refusal of the server as a feed's result says it. */
const refusal = (text: string) => ({ isError: true, content: [{ type: "text", text }] })

function renderIn(
  shown: ScreenProcess | ReactNode,
  feed: ProcessScreenData | ReturnType<typeof refusal>,
  locale = "en",
) {
  const actions: HostAction[] = []
  const answer = "isError" in feed ? feed : { ...feed, webApp: null }
  render(
    <TestViewHost
      tools={{
        [PROCESS_SCREEN_FEED]: answer,
        [INSTANCES_FEED]: WORLD_SCREENS.instanceList,
        [BPMN_XML_FEED]: { processDefinitionId: "pulse-order:2", bpmnXml: "<definitions/>" },
      }}
      onHostAction={(action) => actions.push(action)}
      locale={locale}
      host={{ timeZone: "UTC" }}
      writes={false}
      followUp="none"
      startPage="/app"
    >
      {isProcess(shown) ? <Screen process={shown} /> : shown}
    </TestViewHost>,
  )
  const processReads = () =>
    actions.flatMap((action) =>
      action.type === "callTool" && action.name === PROCESS_SCREEN_FEED ? [action.args] : [],
    )
  return { processReads }
}

const isProcess = (shown: unknown): shown is ScreenProcess =>
  typeof shown === "object" && shown !== null && !isValidElement(shown)

describe("the process screen of a process in a tenant", () => {
  it("reads the process by key and tenant and names the tenant beside the engine", async () => {
    const { processReads } = renderIn({ key: "pulse-order", tenantId: "north" }, IN_NORTH)

    expect(await screen.findByText("prod-a · Tenant north")).toBeTruthy()
    expect(processReads()).toEqual([
      { engine: "prod-a", process: "pulse-order", tenantId: "north" },
    ])
  })

  it("names the tenant as the Mandant in German", async () => {
    renderIn({ key: "pulse-order", tenantId: "north" }, IN_NORTH, "de")

    expect(await screen.findByText("prod-a · Mandant north")).toBeTruthy()
  })

  it("names no tenant for a process without one, and reads it without one", async () => {
    const { processReads } = renderIn({ key: "pulse-order" }, WORLD_SCREENS.process)

    await waitFor(() => {
      expect(screen.getByText("prod-a")).toBeTruthy()
    })
    expect(processReads()).toEqual([{ engine: "prod-a", process: "pulse-order" }])
  })

  it("names the tenant the feed answers for a key alone in the address, read once", async () => {
    const named: string[] = []
    const { processReads } = renderIn(
      <AtAddress first={{ key: "pulse-order" }} named={(tenant) => named.push(tenant)} />,
      IN_NORTH,
    )

    expect(await screen.findByText("prod-a · Tenant north")).toBeTruthy()
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20))
    })
    expect(named).toEqual(["north"])
    expect(processReads()).toEqual([{ engine: "prod-a", process: "pulse-order" }])
  })

  it.each([
    ["en", "Process pulse-order isn't in tenant north on engine prod-a"],
    ["de", "Den Prozess pulse-order gibt es im Mandanten north auf der Engine prod-a nicht"],
  ])("names the tenant that deploys no version of the key (%s)", async (locale, title) => {
    const unknown = refusal(
      '[UNKNOWN_PROCESS] Process "pulse-order" has no version in tenant "north".',
    )
    renderIn({ key: "pulse-order", tenantId: "north" }, unknown, locale)

    expect(await screen.findByRole("heading", { level: 2, name: title })).toBeTruthy()
  })
})
