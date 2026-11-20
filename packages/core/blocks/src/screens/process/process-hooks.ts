import {
  DiagramDecorations,
  InstanceRows,
  type ElementDecorationData,
  type ProcessScreenData,
} from "@miragon/pulse-screens"
import { useMemo } from "react"

/**
 * What a surface draws on each element of a process's diagram (`DiagramDecorations` of
 * `@miragon/pulse-screens`): its counts in their order, whether its outline marks a root incident
 * and its call target, an element with a call target and no count among them. For a surface's
 * canvas, which places `BadgeCluster` and `CallButton` on the elements.
 */
export function useDiagramDecorations(
  screen: Pick<ProcessScreenData, "badges" | "calls">,
): readonly ElementDecorationData[] {
  const { badges, calls } = screen
  return useMemo(() => DiagramDecorations.of({ badges, calls }), [badges, calls])
}

/**
 * The rows of an instance list read page by page, each later page after the rows before it without
 * a row shown already (`InstanceRows.appended` of `@miragon/pulse-screens`: an engine that pages by
 * offset repeats a row where an instance started between two reads). For `InstanceTable`.
 */
export function useInstanceRows<Row extends { readonly id: string }>(
  pages: readonly (readonly Row[])[],
): readonly Row[] {
  return useMemo(
    () => pages.reduce<Row[]>((shown, page) => InstanceRows.appended(shown, page), []),
    [pages],
  )
}
