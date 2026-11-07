import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks"
import type { InstanceView, MoveOption } from "../../core/protocol/index.js"
import type { MoveDecoration } from "../diagram/decoration-layer.js"
import type { MoveEntryDecoration } from "../diagram/move-entry.js"
import type { MoveChoice } from "./move-panel.js"

export interface TokenMove {
  readonly choice: MoveChoice | undefined
  readonly option: MoveOption | undefined
  readonly decoration: MoveDecoration | undefined
  readonly entry: MoveEntryDecoration | undefined
  readonly start: (fromElementId: string) => void
  readonly pick: (elementId: string) => void
  readonly close: () => void
}

function useFocusReturn(choice: MoveChoice | undefined) {
  const returnTo = useRef<string | undefined>(undefined)
  useEffect(() => {
    const from = returnTo.current
    if (choice === undefined && from !== undefined) {
      returnTo.current = undefined
      requestAnimationFrame(() => {
        document.querySelector<HTMLElement>(`[data-move-from="${CSS.escape(from)}"]`)?.focus()
      })
    }
  })
  return returnTo
}

function useEscape(active: boolean, close: () => void): void {
  useEffect(() => {
    if (!active) {
      return undefined
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape" && !event.defaultPrevented) {
        close()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => {
      window.removeEventListener("keydown", onKey)
    }
  }, [active, close])
}

function useMoveDecoration(
  choice: MoveChoice | undefined,
  option: MoveOption | undefined,
): MoveDecoration | undefined {
  const to = option?.targets.find((target) => target.elementId === choice?.to)?.elementId
  return useMemo<MoveDecoration | undefined>(
    () =>
      choice === undefined || option === undefined
        ? undefined
        : {
            from: choice.from,
            ...(to === undefined ? {} : { to }),
            targets: option.targets.map((target) => target.elementId),
            refused: option.refused.map((refused) => refused.elementId),
          },
    [choice, option, to],
  )
}

function useMoveEntry(
  view: InstanceView,
  selected: string | undefined,
  start: (fromElementId: string) => void,
): MoveEntryDecoration | undefined {
  return useMemo(() => {
    if (selected === undefined) {
      return undefined
    }
    if (view.moves?.some((move) => move.fromElementId === selected) === true) {
      return {
        elementId: selected,
        onStart: () => {
          start(selected)
        },
      }
    }
    const refusal = view.waitStates.find(
      (row) => row.elementId === selected && row.moveRefusal !== undefined,
    )?.moveRefusal
    return refusal === undefined
      ? undefined
      : { elementId: selected, refusal, onStart: () => undefined }
  }, [view, selected, start])
}

export function useTokenMove(view: InstanceView, selected: string | undefined): TokenMove {
  const [choice, setChoice] = useState<MoveChoice | undefined>(undefined)
  const returnTo = useFocusReturn(choice)
  const option =
    choice === undefined
      ? undefined
      : view.moves?.find((move) => move.fromElementId === choice.from)
  const from = choice?.from
  const close = useCallback(() => {
    returnTo.current = from
    setChoice(undefined)
  }, [from, returnTo])
  useEscape(from !== undefined, close)
  const decoration = useMoveDecoration(choice, option)
  const start = useCallback((fromElementId: string) => {
    setChoice({ from: fromElementId })
  }, [])
  const entry = useMoveEntry(view, choice === undefined ? selected : undefined, start)
  const pick = (elementId: string): void => {
    if (choice === undefined || option === undefined) {
      return
    }
    const refused = option.refused.find((candidate) => candidate.elementId === elementId)
    if (option.targets.some((target) => target.elementId === elementId)) {
      setChoice({ from: choice.from, to: elementId })
    } else if (refused !== undefined) {
      setChoice({ ...choice, hint: `Can't move to ${refused.label}: ${refused.reason}` })
    }
  }
  return {
    choice,
    option,
    decoration,
    entry,
    start,
    pick,
    close,
  }
}
