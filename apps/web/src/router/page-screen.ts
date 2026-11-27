import type { InstanceListFilterData, ProcessFilterData } from "@miragon/pulse-screens"
import type { InstanceTab } from "./screen-queries.js"

/**
 * A screen of the page's own (D10), which it shows at a place of the cockpit instead of the
 * cockpit's view there. The page claims that place (`ViewLocation.claims`): the cockpit, embedded
 * elsewhere, never shows it on the page. Its state beyond the place rides in the address's query,
 * the defaults left out.
 *
 * - `engine`: an engine's processes at the engine's own address, the place of the cockpit's
 *   overview; its list's scope and search (`filter`: `scope=incident` and `q`).
 * - `instance`: an instance at its own address, the place of the cockpit's instance view and its
 *   history; its tab (`tab`, none where the screen picks it by the instance's state) and, at the
 *   address of an incident under its instance, the root incident in focus (`incident`).
 * - `incident`: an incident the page knows by its id alone (the cockpit's drill to one, an old
 *   address of one), which the page leads on to the instance that holds its root.
 * - `process`: a process, a key in one tenant, in one version at the process's own address, the
 *   place of the cockpit's process view and of its list of a process's instances; its tenant
 *   (`tenantId`, `tenant` in the address, none for the process without a tenant), the version by
 *   its number (`version`, none for the latest) and its instance list's filter (`filter`: `scope`,
 *   `element`, `key`, `var`).
 * - `search`: the search for an instance across engines at the search's own address, a place of
 *   the page's alone, which no view of the cockpit has; what it searches (`text`, `q` in the
 *   address, trimmed, none for an empty search).
 * - `start`: the start page at `/app`, every engine side by side and the server's boards, the place
 *   of the cockpit's landing and of its cross-engine overview, which it replaces on the page.
 */
export type PageScreen =
  | { readonly kind: "start" }
  | { readonly kind: "engine"; readonly engine: string; readonly filter: ProcessFilterData }
  | {
      readonly kind: "process"
      readonly engine: string
      readonly process: string
      readonly tenantId?: string
      readonly version?: number
      readonly filter: InstanceListFilterData
    }
  | {
      readonly kind: "instance"
      readonly engine: string
      readonly instance: string
      readonly tab?: InstanceTab
      readonly incident?: string
    }
  | { readonly kind: "incident"; readonly engine: string; readonly incident: string }
  | { readonly kind: "search"; readonly text: string }
