import type { ComponentChildren } from "preact"
import { useRef, useState } from "preact/hooks"
import { Separator } from "../components/separator.js"
import { useHost } from "../host/host-context.js"
import { UiStateStore } from "../host/ui-state-store.js"
import { SplitShare } from "./split-share.js"

const DEFAULT_SHARE = 0.55
const KEY_STEP = 0.05

export interface SplitLayoutProps {
  readonly top: ComponentChildren
  readonly bottom: ComponentChildren
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

  const onDrag = (event: PointerEvent): void => {
    const bounds = container.current?.getBoundingClientRect()
    if (bounds === undefined || bounds.height === 0) {
      return
    }
    show(SplitShare.clamp((event.clientY - bounds.top) / bounds.height))
  }

  return (
    <div
      class="split-layout"
      ref={container}
      style={{ "--diagram-share": `${Math.round(share * 1000) / 10}%` }}
    >
      <div class="split-layout__top">{top}</div>
      <Separator
        class="split-layout__handle"
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
      <div class="split-layout__bottom">{bottom}</div>
    </div>
  )
}
