import { cn } from "@miragon/pulse-ui"
import {
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent,
  type ReactNode,
  type RefObject,
} from "react"
import { Separator } from "../components/separator.js"
import type { VsCodeApi } from "../host/host-bridge.js"
import { useHost } from "../host/host-context.js"
import { UiStateStore } from "../host/ui-state-store.js"
import { SplitShare } from "./split-share.js"

const DEFAULT_SHARE = 0.55
const KEY_STEP = 0.05

const PANE = "relative min-h-0 overflow-hidden"

const TOP_PANE = cn(PANE, "[--diagram-inset:--spacing(2)]")

const HANDLE = cn(
  "relative z-30 -mt-5 -mb-0.75 h-6 cursor-row-resize focus-visible:outline-hidden",
  "before:bg-border before:absolute before:inset-x-0 before:top-5 before:h-px",
  "hover:before:bg-interaction data-dragging:before:bg-interaction focus-visible:before:bg-interaction",
  "focus-visible:before:ring-(length:--focus-width) focus-visible:before:ring-focus",
  "forced-colors:before:bg-[CanvasText]",
  "forced-colors:hover:before:bg-[Highlight] forced-colors:data-dragging:before:bg-[Highlight] forced-colors:focus-visible:before:bg-[Highlight]",
  "forced-colors:focus-visible:outline-(length:--focus-width) forced-colors:focus-visible:outline-solid forced-colors:focus-visible:outline-[Highlight] forced-colors:focus-visible:-outline-offset-(--focus-width)",
)

export interface SplitLayoutProps {
  readonly top: ReactNode
  readonly bottom: ReactNode
}

export function SplitLayout({ top, bottom }: SplitLayoutProps) {
  const { api } = useHost()
  const { share, container, topPane, step, ...drag } = useSplitShare(api)
  return (
    <div
      className="grid min-h-0 grid-rows-[minmax(min(300px,50%),var(--diagram-share))_1px_minmax(120px,1fr)]"
      ref={container}
      style={{ "--diagram-share": `${Math.round(share * 1000) / 10}%` } as CSSProperties}
    >
      <div className={TOP_PANE} ref={topPane}>
        {top}
      </div>
      <Separator
        className={HANDLE}
        orientation="horizontal"
        label="Resize diagram and list"
        min={SplitShare.MIN * 100}
        max={SplitShare.MAX * 100}
        value={Math.round(share * 100)}
        keys={{
          ArrowUp: () => {
            step(-KEY_STEP)
          },
          ArrowDown: () => {
            step(KEY_STEP)
          },
        }}
        {...drag}
      />
      <div className={PANE}>{bottom}</div>
    </div>
  )
}

interface SplitShareState {
  readonly share: number
  readonly container: RefObject<HTMLDivElement | null>
  readonly topPane: RefObject<HTMLDivElement | null>
  readonly step: (by: number) => void
  readonly onDragStart: (event: PointerEvent<HTMLDivElement>) => void
  readonly onDrag: (event: PointerEvent<HTMLDivElement>) => void
  readonly onDragEnd: () => void
  readonly onDragCancel: () => void
}

function useSplitShare(api: VsCodeApi): SplitShareState {
  const [share, setShare] = useState(() => UiStateStore.read(api).diagramShare ?? DEFAULT_SHARE)
  const live = useRef(share)
  const container = useRef<HTMLDivElement>(null)
  const topPane = useRef<HTMLDivElement>(null)
  const atDragStart = useRef(0)
  const grabOffset = useRef(0)
  const show = (next: number): void => {
    live.current = next
    setShare(next)
  }
  const commit = (next: number): void => {
    const clamped = SplitShare.clamp(next)
    show(clamped)
    UiStateStore.write(api, { diagramShare: clamped })
  }
  return {
    share,
    container,
    topPane,
    step: (by) => {
      commit(live.current + by)
    },
    onDragStart: (event) => {
      atDragStart.current = live.current
      const line = topPane.current?.getBoundingClientRect().bottom ?? event.clientY
      grabOffset.current = event.clientY - line
    },
    onDrag: (event) => {
      const bounds = container.current?.getBoundingClientRect()
      if (bounds === undefined || bounds.height === 0) {
        return
      }
      show(SplitShare.clamp((event.clientY - grabOffset.current - bounds.top) / bounds.height))
    },
    onDragEnd: () => {
      commit(live.current)
    },
    onDragCancel: () => {
      show(atDragStart.current)
    },
  }
}
