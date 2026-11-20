import { useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react"
import { cn, FOCUS_RING } from "@miragon/pulse-ui"

/** The diagram's share of the split: never less than a fifth, never more than four fifths. */
export const SPLIT = { min: 0.2, max: 0.8, start: 0.5, step: 0.05 } as const

const clamp = (share: number): number => Math.min(SPLIT.max, Math.max(SPLIT.min, share))

/** The share the reader left, where this browser kept one (its storage may be off): else the start. */
function storedShare(key: string): number {
  try {
    const stored = Number.parseFloat(window.localStorage.getItem(key) ?? "")
    return Number.isFinite(stored) ? clamp(stored) : SPLIT.start
  } catch {
    return SPLIT.start
  }
}

/** Keeps the share for the next screen of its kind; a storage that refuses keeps none. */
function keepShare(key: string, share: number): void {
  try {
    window.localStorage.setItem(key, String(share))
  } catch {
    // Storage is off in this browser: the split starts at its middle next time.
  }
}

/** The keys that move the separator, and where each puts the share. */
const KEYS: Readonly<Record<string, (share: number) => number>> = {
  ArrowUp: (share) => share - SPLIT.step,
  ArrowDown: (share) => share + SPLIT.step,
  Home: () => SPLIT.min,
  End: () => SPLIT.max,
}

/** The separator: a 1 px rule with a wider grip, the interaction's colour while it moves. */
const HANDLE = cn(
  "bg-border relative z-10 h-px shrink-0 cursor-row-resize touch-none",
  "before:absolute before:inset-x-0 before:-top-1.5 before:h-3 before:content-['']",
  "hover:bg-interaction focus-visible:bg-interaction data-[dragging]:bg-interaction",
  "forced-colors:bg-[CanvasText] forced-colors:hover:bg-[Highlight] forced-colors:focus-visible:bg-[Highlight]",
  FOCUS_RING,
)

/**
 * The diagram above, the details below, and between them a separator the reader moves by mouse,
 * touch or keyboard (the arrows by a twentieth, Home and End to the ends; WCAG 2.1.1): a
 * `separator` that says the diagram's share in percent. The share stays in this browser for the
 * next screen of its kind (`storageKey`: an instance's, a process's); nothing of it reaches the
 * server. Its one column is as wide as the screen, never as its widest line: a stack trace or a
 * value read in place scrolls in its own box, and the diagram keeps its zoom bar and bpmn.io's link
 * in sight.
 */
export function SplitPane({
  top,
  bottom,
  label,
  storageKey,
}: {
  readonly top: ReactNode
  readonly bottom: ReactNode
  /** The separator's name. */
  readonly label: string
  /** Where this browser keeps the share (`pulse.web.<screen>.diagramShare`). */
  readonly storageKey: string
}) {
  const [share, setShare] = useState(() => storedShare(storageKey))
  const [dragging, setDragging] = useState(false)
  const frame = useRef<HTMLDivElement>(null)
  const commit = (next: number): void => {
    const clamped = clamp(next)
    setShare(clamped)
    keepShare(storageKey, clamped)
  }
  const follow = (event: PointerEvent<HTMLDivElement>): void => {
    const box = frame.current?.getBoundingClientRect()
    if (!dragging || box === undefined || box.height === 0) return
    setShare(clamp((event.clientY - box.top) / box.height))
  }
  return (
    <div
      ref={frame}
      className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)]"
      data-slot="split-pane"
      style={{
        gridTemplateRows: `minmax(0, ${String(share)}fr) auto minmax(0, ${String(1 - share)}fr)`,
      }}
    >
      <div className="relative min-h-0 min-w-0 overflow-hidden" data-slot="split-top">
        {top}
      </div>
      <div
        role="separator"
        aria-orientation="horizontal"
        aria-label={label}
        aria-valuenow={Math.round(share * 100)}
        aria-valuemin={SPLIT.min * 100}
        aria-valuemax={SPLIT.max * 100}
        tabIndex={0}
        data-dragging={dragging || undefined}
        className={HANDLE}
        onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
          const move = KEYS[event.key]
          if (move === undefined) return
          event.preventDefault()
          commit(move(share))
        }}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId)
          setDragging(true)
        }}
        onPointerMove={follow}
        onPointerUp={(event) => {
          event.currentTarget.releasePointerCapture(event.pointerId)
          setDragging(false)
          commit(share)
        }}
        onPointerCancel={() => {
          setDragging(false)
        }}
      />
      <div className="flex min-h-0 min-w-0 flex-col" data-slot="split-bottom">
        {bottom}
      </div>
    </div>
  )
}
