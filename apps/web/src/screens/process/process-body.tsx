import type { CSSProperties, ReactNode } from "react"
import { useDiagramDecorations } from "@miragon/pulse-blocks"
import type { InstanceScopeCode } from "@miragon/pulse-screens"
import { cn } from "@miragon/pulse-ui"
import { useT } from "../../messages/index.js"
import { SplitPane } from "../split-pane.js"
import { ProcessDiagram } from "./process-diagram.js"
import type { ProcessScreenFeed } from "./process-feed.js"
import { processNameOf } from "./process-head.js"

/** Where this browser keeps the share a process's diagram takes of the split. */
const PROCESS_SHARE_KEY = "pulse.web.process.diagramShare"

/**
 * The diagram's height under 64rem, where the page scrolls: at least 240 px, at most 560 px, and
 * enough room left in the window (28rem) for the bar and the list's filter bar as a phone wraps
 * them, the list's head and three rows of 40 px, the comfortable rows of touch, and for the strips
 * the screen shows under its bar (`--process-strips`, their height as measured).
 */
const STACKED_DIAGRAM_HEIGHT =
  "h-[clamp(240px,calc(100dvh_-_28rem_-_var(--process-strips,0px)),560px)]"

/** The version's diagram and its state: drawn, being read, or none to draw (with why). */
function DiagramRegion({
  screen,
  xml,
  failed,
  selected,
  stale,
  fill,
  nameOf,
  onSelect,
  onOpenCall,
}: {
  readonly screen: ProcessScreenFeed
  readonly xml: string | null | undefined
  readonly failed: boolean
  readonly selected: string | undefined
  readonly stale: boolean
  readonly fill: boolean
  readonly nameOf: (elementId: string) => string
  readonly onSelect: (elementId: string, scope: InstanceScopeCode) => void
  readonly onOpenCall: (href: string) => void
}) {
  const t = useT()
  const decorations = useDiagramDecorations(screen)
  if (typeof xml !== "string" || xml === "") {
    const words = failed
      ? t("diagram.readFailed")
      : xml === null
        ? t("diagram.none")
        : t("diagram.loading")
    return (
      <p
        className="text-muted-foreground grid h-full min-h-40 place-items-center p-4"
        role={xml === undefined && !failed ? "status" : undefined}
      >
        {words}
      </p>
    )
  }
  const process = `${processNameOf(screen, screen.bpmnProcessId)} v${String(screen.selected?.version)}`
  return (
    <ProcessDiagram
      engine={screen.engine}
      xml={xml}
      decorations={decorations}
      badges={screen.badges}
      selected={selected}
      stale={stale}
      label={t("diagram.label", { process })}
      nameOf={nameOf}
      fill={fill}
      onSelect={onSelect}
      onOpenCall={onOpenCall}
    />
  )
}

/** The diagram and the instance list: split from 64rem on, stacked under it. */
export function ProcessBody({
  screen,
  xml,
  diagramFailed,
  selected,
  stale,
  wide,
  above,
  nameOf,
  onSelect,
  onOpenCall,
  list,
}: {
  readonly screen: ProcessScreenFeed
  readonly xml: string | null | undefined
  readonly diagramFailed: boolean
  readonly selected: string | undefined
  readonly stale: boolean
  readonly wide: boolean
  /** The height of the strips above, in px, which the stacked diagram leaves to the list too. */
  readonly above: number
  readonly nameOf: (elementId: string) => string
  readonly onSelect: (elementId: string, scope: InstanceScopeCode) => void
  readonly onOpenCall: (href: string) => void
  readonly list: ReactNode
}) {
  const t = useT()
  const diagram = (
    <DiagramRegion
      screen={screen}
      xml={xml}
      failed={diagramFailed}
      selected={selected}
      stale={stale}
      fill
      nameOf={nameOf}
      onSelect={onSelect}
      onOpenCall={onOpenCall}
    />
  )
  if (wide) {
    return (
      <SplitPane
        top={diagram}
        bottom={list}
        label={t("screen.process.split")}
        storageKey={PROCESS_SHARE_KEY}
      />
    )
  }
  return (
    <div className="flex flex-col">
      <div
        className={cn("relative", STACKED_DIAGRAM_HEIGHT)}
        style={{ "--process-strips": `${String(above)}px` } as CSSProperties}
        data-slot="process-diagram-frame"
      >
        {diagram}
      </div>
      <div className="border-border border-t">{list}</div>
    </div>
  )
}
