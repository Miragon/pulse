import type { MappingCandidate } from "../../core/protocol/index.js"
import type { MappingHandle } from "../diagram/decorations.js"
import type { ArrowPair, ArrowScene } from "../diagram/mapping-arrows.js"
import type { Drawing } from "./mapping-draw.js"

export interface DiagramRow {
  readonly sourceElementId: string
  readonly sourceLabel: string
  readonly candidates: readonly MappingCandidate[]
  readonly targetElementId?: string
  readonly unmappedTokens?: true
  readonly problem?: string
  readonly refused?: string
}

export interface Hovered {
  readonly side: "source" | "target"
  readonly elementId: string
}

export interface SceneState {
  readonly rows: readonly DiagramRow[]
  readonly focused: string | undefined
  readonly hovered: Hovered | undefined
  readonly drawing: Drawing | undefined
  readonly showAll: boolean
}

export class MappingScene {
  static handles(rows: readonly DiagramRow[]): MappingHandle[] {
    return rows
      .filter((row) => row.candidates.length > 0)
      .map((row) => ({
        elementId: row.sourceElementId,
        label: row.sourceLabel,
        mapped: row.targetElementId !== undefined,
      }))
  }

  static arrows({ rows, focused, hovered, drawing, showAll }: SceneState): ArrowScene {
    const shown = rows.filter(
      (row) =>
        showAll ||
        row.sourceElementId === focused ||
        (hovered?.side === "source" && row.sourceElementId === hovered.elementId) ||
        (hovered?.side === "target" && row.targetElementId === hovered.elementId),
    )
    const pairs = shown.flatMap((row): ArrowPair[] =>
      row.targetElementId === undefined || row.sourceElementId === drawing?.from
        ? []
        : [
            {
              sourceElementId: row.sourceElementId,
              targetElementId: row.targetElementId,
              tone: (row.refused ?? row.problem) === undefined ? "info" : "danger",
              focused: row.sourceElementId === focused,
            },
          ],
    )
    return {
      pairs,
      drawing: drawing === undefined ? undefined : { from: drawing.from, to: drawing.over },
    }
  }

  static inTarget(rows: readonly DiagramRow[], hovered: Hovered | undefined): string[] {
    const target = rows.find(
      (row) => hovered?.side === "source" && row.sourceElementId === hovered.elementId,
    )?.targetElementId
    return target === undefined ? [] : [target]
  }

  static inSource(rows: readonly DiagramRow[], hovered: Hovered | undefined): string[] {
    return hovered?.side === "target"
      ? rows
          .filter((row) => row.targetElementId === hovered.elementId)
          .map((row) => row.sourceElementId)
      : []
  }

  static hint(rows: readonly DiagramRow[], drawing: Drawing | undefined, version: number): string {
    const row = rows.find((candidate) => candidate.sourceElementId === drawing?.from)
    if (row === undefined) {
      return ""
    }
    const over = row.candidates.find((candidate) => candidate.elementId === drawing?.over)
    return over === undefined
      ? `Map ${row.sourceLabel}: drop or click on a marked element of v${String(version)}. Esc cancels.`
      : `Release to map ${row.sourceLabel} to ${over.label}.`
  }
}
