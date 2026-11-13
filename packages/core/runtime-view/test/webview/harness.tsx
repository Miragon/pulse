import "../../src/webview/theme/cd-tokens.generated.css"
import "@fontsource-variable/geist/wght.css"
import "@fontsource-variable/geist-mono/wght.css"
import "diagram-js/assets/diagram-js.css"
import "bpmn-js/dist/assets/bpmn-js.css"
import "../../src/webview/theme/cd-canvas.css"
import "@miragon/modeler-shell/shell.css"
import "../../src/webview/styles/base.css"
import "../../src/webview/styles/components.css"
import "../../src/webview/styles/screens.css"
import "../../src/webview/styles/migration.css"
import "../../src/webview/styles/tables.css"
import "../../src/webview/styles/diagram.css"
import "../../src/webview/styles/boards.css"
import { render, type ComponentChild } from "preact"
import { vi } from "vitest"
import { page, type Locator } from "vitest/browser"
import type { PanelState, WebviewIntent } from "../../src/core/protocol/index.js"
import { App } from "../../src/webview/app.js"
import { HostBridge, type VsCodeApi } from "../../src/webview/host/host-bridge.js"

export interface Harness {
  readonly root: HTMLElement
  readonly bridge: HostBridge
  readonly api: VsCodeApi
  readonly posted: WebviewIntent[]
  publish(state: PanelState, revision?: number): void
  unmount(): void
}

export function fakeApi(posted: WebviewIntent[], initial?: unknown): VsCodeApi {
  let stored: unknown = initial
  return {
    postMessage: (message) => {
      if ((message as WebviewIntent).type !== "activity") {
        posted.push(message as WebviewIntent)
      }
    },
    getState: () => stored,
    setState: (state) => {
      stored = state
    },
  }
}

export function postState(state: PanelState, revision: number): void {
  window.postMessage({ type: "state", revision, state }, "*")
}

export interface MountOptions {
  readonly width?: number
  readonly stored?: unknown
}

export type Renderable = ComponentChild

export interface Mounted {
  readonly root: HTMLElement
  readonly update: (node: Renderable) => void
  readonly unmount: () => void
}

export function mount(node: Renderable, root = document.createElement("div")): Mounted {
  if (!root.isConnected) {
    document.body.append(root)
  }
  render(node, root)
  return {
    root,
    update: (next) => {
      render(next, root)
    },
    unmount: () => {
      render(null, root)
      root.remove()
    },
  }
}

export function mountApp({ width = 1200, stored }: MountOptions = {}): Harness {
  document.documentElement.dataset.cdTheme = "light"
  delete document.documentElement.dataset.cdKontrast
  const root = document.createElement("div")
  root.style.cssText = `position: fixed; inset: 0; width: ${width}px; height: 800px;`
  const posted: WebviewIntent[] = []
  const api = fakeApi(posted, stored)
  const bridge = new HostBridge(api)
  const mounted = mount(<App bridge={bridge} />, root)
  let revision = 0
  return {
    root,
    bridge,
    api,
    posted,
    publish: (state, at) => {
      revision = at ?? revision + 1
      postState(state, revision)
    },
    unmount: () => {
      mounted.unmount()
      bridge.dispose()
    },
  }
}

type ValueControl = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement

function setNativeValue(control: ValueControl, value: string): void {
  const prototype = Object.getPrototypeOf(control) as object
  const descriptor = Object.getOwnPropertyDescriptor(prototype, "value")
  if (descriptor?.set === undefined) {
    throw new Error("The control has no native value setter.")
  }
  descriptor.set.call(control, value)
}

export function enterValue(control: ValueControl | null | undefined, value: string): void {
  if (control === null || control === undefined) {
    throw new Error(`No control to enter ${value} into.`)
  }
  setNativeValue(control, value)
  control.dispatchEvent(new Event("input", { bubbles: true }))
  control.dispatchEvent(new Event("change", { bubbles: true }))
}

export function waitForElement<T extends Element>(root: ParentNode, selector: string): Promise<T> {
  return vi.waitFor(
    () => {
      const found = root.querySelector<T>(selector)
      if (found === null) {
        throw new Error(`Nothing matches ${selector} yet.`)
      }
      return found
    },
    { timeout: 5000, interval: 25 },
  )
}

export function colourOfVariable(variable: string): string {
  const probe = document.createElement("span")
  probe.style.color = `var(${variable})`
  document.body.append(probe)
  const colour = getComputedStyle(probe).color
  probe.remove()
  return colour
}

export function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        resolve()
      })
    })
  })
}

export function buttonNamed(root: ParentNode, name: string): HTMLButtonElement {
  const button = [...root.querySelectorAll("button")].find(
    (candidate) => candidate.textContent.trim() === name,
  )
  if (button === undefined) {
    throw new Error(`No button named ${name}.`)
  }
  return button
}

export function radioNamed(root: ParentNode, name: string): HTMLButtonElement {
  const radio = [...root.querySelectorAll<HTMLButtonElement>('[role="radio"]')].find(
    (candidate) => candidate.firstChild?.textContent?.trim() === name,
  )
  if (radio === undefined) {
    throw new Error(`No radio named ${name}.`)
  }
  return radio
}

export function press(target: Element, key: string, init: KeyboardEventInit = {}): void {
  target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, ...init }))
}

export async function fontsLoaded(): Promise<void> {
  await Promise.all([...document.fonts].map((face) => face.load()))
}

type Role = Parameters<Locator["getByRole"]>[0]
type Match<T> = T | null
type RoleOptions = NonNullable<Parameters<Locator["getByRole"]>[1]>

function rolesIn(root: Element, role: Role, options: RoleOptions): HTMLElement[] {
  return page
    .elementLocator(root)
    .getByRole(role, { exact: true, ...options })
    .elements() as HTMLElement[]
}

function describeRole(role: Role, options: RoleOptions): string {
  return options.name === undefined ? role : `${role} named ${String(options.name)}`
}

export function allRoles<T extends HTMLElement = HTMLElement>(
  root: Element,
  role: Role,
  options: RoleOptions = {},
): T[] {
  return rolesIn(root, role, options) as T[]
}

export function queryRole<T extends HTMLElement = HTMLElement>(
  root: Element,
  role: Role,
  options: RoleOptions = {},
): Match<T> {
  const found = rolesIn(root, role, options)
  if (found.length > 1) {
    throw new Error(`${String(found.length)} elements match the ${describeRole(role, options)}.`)
  }
  return (found[0] as T | undefined) ?? null
}

export function getRole<T extends HTMLElement = HTMLElement>(
  root: Element,
  role: Role,
  options: RoleOptions = {},
): NonNullable<Match<T>> {
  const found = queryRole<T>(root, role, options)
  if (found === null) {
    throw new Error(`No ${describeRole(role, options)}.`)
  }
  return found
}

export function findRole<T extends HTMLElement = HTMLElement>(
  root: Element,
  role: Role,
  options: RoleOptions = {},
): Promise<T> {
  return vi.waitFor(() => getRole<T>(root, role, options), { timeout: 5000, interval: 25 })
}

export function part(name: string, state?: Readonly<Record<string, string>>): string {
  const extra = Object.entries(state ?? {}).map(([key, value]) => `[data-${key}="${value}"]`)
  return `[data-part="${name}"]${extra.join("")}`
}

export function queryPart(
  root: ParentNode,
  name: string,
  state?: Readonly<Record<string, string>>,
): HTMLElement | null {
  return root.querySelector<HTMLElement>(part(name, state))
}

export function allParts(
  root: ParentNode,
  name: string,
  state?: Readonly<Record<string, string>>,
): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(part(name, state))]
}

export function findPart(
  root: ParentNode,
  name: string,
  state?: Readonly<Record<string, string>>,
): Promise<HTMLElement> {
  return waitForElement<HTMLElement>(root, part(name, state))
}
