import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { InstanceView, MoveOption } from "../../core/protocol/index.js"
import type { MoveDecoration } from "../diagram/decoration-layer.js"
import type { MoveEntryDecoration } from "../diagram/move-entry.js"
import { useHost } from "../host/host-context.js"
import type { MoveChoice } from "./move-panel.js"

const CLI_COMMAND = "CLI command"

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
  return useCallback((from: string | undefined) => {
    returnTo.current = from
  }, [])
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
  copy: (text: string) => void,
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
    const row = view.waitStates.find(
      (candidate) => candidate.elementId === selected && candidate.moveRefusal !== undefined,
    )
    if (row?.moveRefusal === undefined) {
      return undefined
    }
    const command = row.cliCommand
    return {
      elementId: selected,
      refusal: row.moveRefusal,
      ...(command === undefined
        ? {}
        : {
            cliCommand: {
              text: command,
              onCopy: () => {
                copy(command)
              },
            },
          }),
      onStart: () => undefined,
    }
  }, [view, selected, start, copy])
}

export function useTokenMove(view: InstanceView, selected: string | undefined): TokenMove {
  const host = useHost()
  const [choice, setChoice] = useState<MoveChoice | undefined>(undefined)
  const returnFocusTo = useFocusReturn(choice)
  const option =
    choice === undefined
      ? undefined
      : view.moves?.find((move) => move.fromElementId === choice.from)
  const from = choice?.from
  const close = useCallback(() => {
    returnFocusTo(from)
    setChoice(undefined)
  }, [from, returnFocusTo])
  useEscape(from !== undefined, close)
  const decoration = useMoveDecoration(choice, option)
  const start = useCallback((fromElementId: string) => {
    setChoice({ from: fromElementId })
  }, [])
  const copy = useCallback(
    (text: string) => {
      host.post({ type: "copy", text, label: CLI_COMMAND })
    },
    [host],
  )
  const entry = useMoveEntry(view, choice === undefined ? selected : undefined, start, copy)
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
