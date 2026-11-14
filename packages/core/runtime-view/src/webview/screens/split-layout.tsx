import { cn, FOCUS_RING } from "@miragon/pulse-ui"
import { useRef, useState, type CSSProperties, type PointerEvent, type ReactNode } from "react"
import { Separator } from "../components/separator.js"
import { useHost } from "../host/host-context.js"
import { UiStateStore } from "../host/ui-state-store.js"
import { SplitShare } from "./split-share.js"

const DEFAULT_SHARE = 0.55
const KEY_STEP = 0.05

const PANE = "relative min-h-0 overflow-hidden"

const HANDLE = cn(
  "bg-border hover:bg-interaction focus-visible:bg-interaction relative z-30 cursor-row-resize after:absolute after:inset-x-0 after:-inset-y-1 after:content-['']",
  FOCUS_RING,
  "focus-visible:ring-offset-0",
)

export interface SplitLayoutProps {
  readonly top: ReactNode
  readonly bottom: ReactNode
}

export function SplitLayout({ top, bottom }: SplitLayoutProps) {
  const { api } = useHost()
  const container = useRef<HTMLDivElement>(null)
  const [share, setShare] = useState(() => UiStateStore.read(api).diagramShare ?? DEFAULT_SHARE)
  const live = useRef(share)
  const atDragStart = useRef(share)

  const show = (next: number): void => {
    live.current = next
    setShare(next)
  }

  const commit = (next: number): void => {
    const clamped = SplitShare.clamp(next)
    show(clamped)
    UiStateStore.write(api, { diagramShare: clamped })
  }

  const onDrag = (event: PointerEvent<HTMLDivElement>): void => {
    const bounds = container.current?.getBoundingClientRect()
    if (bounds === undefined || bounds.height === 0) {
      return
    }
    show(SplitShare.clamp((event.clientY - bounds.top) / bounds.height))
  }

  return (
    <div
      className="grid min-h-0 grid-rows-[minmax(min(300px,50%),var(--diagram-share))_1px_minmax(120px,1fr)]"
      ref={container}
      style={{ "--diagram-share": `${Math.round(share * 1000) / 10}%` } as CSSProperties}
    >
      <div className={PANE}>{top}</div>
      <Separator
        className={HANDLE}
        orientation="horizontal"
        label="Resize diagram and list"
        min={SplitShare.MIN * 100}
        max={SplitShare.MAX * 100}
        value={Math.round(share * 100)}
        keys={{
          ArrowUp: () => {
            commit(live.current - KEY_STEP)
          },
          ArrowDown: () => {
            commit(live.current + KEY_STEP)
          },
        }}
        onDragStart={() => {
          atDragStart.current = live.current
        }}
        onDrag={onDrag}
        onDragEnd={() => {
          commit(live.current)
        }}
        onDragCancel={() => {
          show(atDragStart.current)
        }}
      />
      <div className={PANE}>{bottom}</div>
    </div>
  )
}
