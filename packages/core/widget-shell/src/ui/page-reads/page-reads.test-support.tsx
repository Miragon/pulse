import { act, type ComponentType } from "react"
import { vi } from "vitest"
import { setFormatLocale } from "@miragon/pulse-ui"
import type { ToolResult } from "../../protocol/tool-result.js"
import { mountApp, type MountAppOptions } from "../app-root.js"
import type { ToolCaller } from "../browser-view-host.js"
import type { ToolRecording } from "../recording.js"
import { createTestQueryClient } from "../test-view-host.js"
import type { ToolCallOptions } from "../view-host.js"

/** The page half's suites: a page mounted as an artifact mounts it, its reads replayed. */

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/** When the stats were read; the counts were read 30 s before them. */
export const STATS_AT = "2026-11-25T09:00:00.000Z"
export const COUNTS_AT = "2026-11-25T08:59:30.000Z"

export const RECORDING: ToolRecording = {
  asOf: "2026-11-25T09:00:05.000Z",
  timeZone: "Europe/Berlin",
  calls: [
    {
      tool: "stats",
      arguments: { key: "a" },
      result: { structuredContent: { asOf: STATS_AT, running: 3 } },
    },
    {
      tool: "counts",
      arguments: { key: "a" },
      result: { structuredContent: { asOf: COUNTS_AT, counts: 7 } },
    },
    { tool: "plain", arguments: {}, result: { structuredContent: { n: 1 } } },
    {
      tool: "accounts",
      arguments: {},
      result: { structuredContent: { asOf: STATS_AT, accounts: 2 } },
      connector: "Shop",
    },
  ],
}

/** A call that reached the page's caller. */
interface SeenCall {
  readonly tool: string
  readonly args: Record<string, unknown>
  readonly options: ToolCallOptions | undefined
}

/**
 * A caller whose answers the test swaps while the page runs (`answer`), recording every call.
 * Default: the recording's, for the page's own connection "Pulse".
 */
export function swappableCaller(initial: ToolCaller) {
  const calls: SeenCall[] = []
  let current = initial
  const callTool: ToolCaller = (tool, args, options) => {
    calls.push({ tool, args, options })
    return current(tool, args, options)
  }
  return {
    callTool,
    calls,
    answer: (next: ToolCaller) => {
      current = next
    },
    /** The calls of `tool`, their `refresh` each. */
    refreshes: (tool: string) =>
      calls.filter((c) => c.tool === tool).map((c) => c.options?.refresh),
  }
}

/** A server's own error answer, as a tool sends it. */
export const toolError = (text: string): ToolResult => ({
  isError: true,
  content: [{ type: "text", text }],
})

const mounted: Array<() => void> = []

/** Runs the timers and promises the page waits on: TanStack notifies a tick later. */
export async function settled(rounds = 4): Promise<void> {
  for (let round = 0; round < rounds; round++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
  }
}

/** Mounts `App` as a page in a container of its own; no retries unless a client is given. */
export async function mountReads(
  App: ComponentType,
  options: MountAppOptions = {},
): Promise<HTMLElement> {
  const container = document.createElement("div")
  document.body.appendChild(container)
  await act(async () => {
    mounted.push(mountApp(App, { client: createTestQueryClient(), container, ...options }))
  })
  await settled()
  return container
}

/** Unmounts every page, puts the formatters' locale back and the timers. */
export function unmountReads(): void {
  for (const unmount of mounted.splice(0)) act(unmount)
  document.body.replaceChildren()
  setFormatLocale(undefined)
  vi.useRealTimers()
}

/** The section's phase (`SectionState`'s `data-state`) by its test id. */
export function phaseOf(container: HTMLElement, id: string): string | null | undefined {
  return container
    .querySelector(`[data-testid="${id}"] [data-slot="section-state"]`)
    ?.getAttribute("data-state")
}

export function textOf(container: HTMLElement, id: string): string {
  return container.querySelector(`[data-testid="${id}"]`)?.textContent ?? ""
}

/** Clicks the first button whose text is `label`, inside `within` where given. */
export async function click(container: HTMLElement, label: string, within?: string): Promise<void> {
  const scope =
    within === undefined ? container : container.querySelector(`[data-testid="${within}"]`)
  const button = [...(scope?.querySelectorAll("button") ?? [])].find(
    (each) => each.textContent === label,
  )
  if (button === undefined) throw new Error(`no button "${label}" in ${container.innerHTML}`)
  await act(async () => {
    button.click()
  })
  await settled()
}
