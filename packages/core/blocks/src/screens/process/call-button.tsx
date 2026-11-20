import type { MouseEvent } from "react"
import { cn, formatCount, shortId } from "@miragon/pulse-ui"
import type { CallLinkData } from "@miragon/pulse-screens"
import { useProcessWords } from "../../messages/process-words.js"
import type { ScreenOpenHow } from "../slots.js"

/** bpmn-js's drill-down arrow, the call activity's own sign on the canvas. */
const DRILLDOWN_ARROW = "M4.82 3.51 10.5 9.19V4H12v8H4v-1.5h5.69L3.76 4.57a.75.75 0 0 1 1.06-1.06Z"

export interface CallButtonProps {
  /** The call activity the button is drawn on. */
  readonly elementId: string
  /** What the button opens, in words: its name and title (`useCallLabel`, or a surface's own). */
  readonly label: string
  /** The process it calls is not deployed: the button says so and opens nothing new. */
  readonly missing?: boolean
  /**
   * The address of what it opens, on a surface with addresses (the web app): then it is a link, a
   * plain click `onOpen`, Ctrl or Cmd, Shift, Alt and the middle button the browser's.
   */
  readonly href?: string | undefined
  /** Opens what it calls; none where the surface opens nothing there (`aria-disabled`). */
  readonly onOpen?: ((elementId: string, how: ScreenOpenHow) => void) | undefined
}

/** Whether a click on a link is the browser's: another tab or window, a download, not the main button. */
const isBrowsers = (event: MouseEvent<HTMLAnchorElement>): boolean =>
  event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey

function DrilldownArrow() {
  return (
    <svg width="20" height="20" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path fillRule="evenodd" d={DRILLDOWN_ARROW} />
    </svg>
  )
}

/**
 * A call activity's way to what it calls, on the diagram: bpmn-js's drill-down button, named by
 * what it opens, a process the engine lacks marked as missing; a link where the surface gives its
 * address. Its look is the canvas's (bpmn-js's `bjs-drilldown` and the canvas's `call-button`
 * rules).
 */
export function CallButton({ elementId, label, missing = false, href, onOpen }: CallButtonProps) {
  const parts = {
    className: cn("bjs-drilldown call-button", missing && "call-button--missing"),
    "data-part": "call-button",
    "data-call-for": elementId,
    "data-state": missing ? "missing" : undefined,
    "aria-label": label,
    title: label,
  }
  if (href !== undefined) {
    return (
      <a
        {...parts}
        href={href}
        onClick={(event) => {
          event.stopPropagation()
          if (isBrowsers(event) || onOpen === undefined) return
          event.preventDefault()
          onOpen(elementId, { toSide: false })
        }}
      >
        <DrilldownArrow />
      </a>
    )
  }
  return (
    <button
      {...parts}
      type="button"
      aria-disabled={onOpen === undefined || undefined}
      onClick={(event) => {
        event.stopPropagation()
        onOpen?.(elementId, { toSide: event.metaKey || event.ctrlKey })
      }}
    >
      <DrilldownArrow />
    </button>
  )
}

/**
 * The words of a call activity's button on a process's diagram, from its call link: the process it
 * opens, the one instance or how many it called, or that the engine lacks the process.
 */
export function useCallLabel(): (call: CallLinkData, engine: string) => string {
  const t = useProcessWords()
  return (call, engine) => {
    switch (call.kind) {
      case "definition":
        return t("call.definition", {
          name: call.definition.name ?? call.definition.bpmnProcessId,
        })
      case "missing":
        return t("call.missing", { process: call.bpmnProcessId, engine })
      case "instances": {
        const [first] = call.instances
        return call.instances.length === 1 && first !== undefined
          ? t("call.instance", { process: first.bpmnProcessId, id: shortId(first.id) })
          : t("call.instances", { count: formatCount(call.instances.length) })
      }
    }
  }
}
