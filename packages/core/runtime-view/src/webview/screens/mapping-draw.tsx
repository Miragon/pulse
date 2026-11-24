import {
  useCallback,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react"
import { flushSync } from "react-dom"
import type { DrawStart } from "../diagram/decorations.js"
import { DropTargets, type DropRow } from "./drop-targets.js"

const DRAG_DISTANCE = 4

export interface Drawing {
  readonly from: string
  readonly over?: string
}

interface Point {
  readonly x: number
  readonly y: number
}

export interface MappingDrawOptions {
  readonly rows: readonly DropRow[]
  readonly target: RefObject<HTMLElement | null>
  readonly onPointer: (pointer: Point | undefined) => void
  readonly onDrop: (sourceElementId: string, targetElementId: string) => void
}

export interface MappingDraw {
  readonly drawing: Drawing | undefined
  readonly start: (from: string, at: DrawStart) => void
  readonly end: () => void
}

type Phase = "pressed" | "dragging" | "clicked"

interface DrawListeners {
  readonly moved: (event: PointerEvent) => void
  readonly released: (event: PointerEvent) => void
  readonly pressed: (event: PointerEvent) => void
  readonly end: () => void
  readonly stopped: () => void
}

function useDrawListeners(from: string | undefined, listeners: DrawListeners): void {
  const latest = useEffectEvent((): DrawListeners => listeners)
  useLayoutEffect(() => {
    if (from === undefined) {
      return undefined
    }
    const pointer =
      (pick: (all: DrawListeners) => (event: PointerEvent) => void) => (event: Event) => {
        pick(latest())(event as PointerEvent)
      }
    const onKey = (event: Event): void => {
      if ((event as KeyboardEvent).key === "Escape") {
        latest().end()
      }
    }
    const onBlur = (): void => {
      latest().end()
    }
    const attached: readonly (readonly [string, (event: Event) => void, boolean])[] = [
      ["pointermove", pointer((all) => all.moved), false],
      ["pointerup", pointer((all) => all.released), false],
      ["pointerdown", pointer((all) => all.pressed), true],
      ["keydown", onKey, false],
      ["blur", onBlur, false],
    ]
    for (const [type, listener, capture] of attached) {
      window.addEventListener(type, listener, capture)
    }
    return () => {
      for (const [type, listener, capture] of attached) {
        window.removeEventListener(type, listener, capture)
      }
      latest().stopped()
    }
  }, [from])
}

export function useMappingDraw(options: MappingDrawOptions): MappingDraw {
  const [drawing, setDrawing] = useState<Drawing | undefined>(undefined)
  const phase = useRef<Phase>("clicked")
  const origin = useRef<Point>({ x: 0, y: 0 })
  const start = useCallback((from: string, at: DrawStart) => {
    phase.current = "pressed"
    origin.current = { x: at.x, y: at.y }
    flushSync(() => {
      setDrawing({ from })
    })
  }, [])
  const end = useCallback(() => {
    setDrawing(undefined)
  }, [])
  const row = options.rows.find((candidate) => candidate.sourceElementId === drawing?.from)
  const overAt = (event: PointerEvent): string | undefined =>
    DropTargets.candidateAt(options.target.current, row, { x: event.clientX, y: event.clientY })
  useDrawListeners(drawing?.from, {
    moved: (event) => {
      const away = Math.hypot(event.clientX - origin.current.x, event.clientY - origin.current.y)
      if (phase.current === "pressed" && away > DRAG_DISTANCE) {
        phase.current = "dragging"
      }
      options.onPointer({ x: event.clientX, y: event.clientY })
      const over = overAt(event)
      if (drawing !== undefined && over !== drawing.over) {
        setDrawing(over === undefined ? { from: drawing.from } : { from: drawing.from, over })
      }
    },
    released: (event) => {
      if (phase.current !== "dragging") {
        phase.current = "clicked"
        return
      }
      const over = overAt(event)
      if (drawing !== undefined && over !== undefined) {
        options.onDrop(drawing.from, over)
      }
      setDrawing(undefined)
    },
    pressed: (event) => {
      if (phase.current === "clicked" && overAt(event) === undefined) {
        setDrawing(undefined)
      }
    },
    end,
    stopped: () => {
      options.onPointer(undefined)
    },
  })
  return { drawing, start, end }
}
