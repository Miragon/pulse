const LABEL_SUFFIX = "_label"

export interface DropRow {
  readonly sourceElementId: string
  readonly candidates: readonly { readonly elementId: string }[]
}

export class DropTargets {
  static candidateAt(
    target: HTMLElement | null,
    row: DropRow | undefined,
    point: { readonly x: number; readonly y: number },
  ): string | undefined {
    const hit = DropTargets.elementAt(target, point)
    const named = hit?.endsWith(LABEL_SUFFIX) === true ? hit.slice(0, -LABEL_SUFFIX.length) : hit
    return row?.candidates.find(
      (candidate) => candidate.elementId === hit || candidate.elementId === named,
    )?.elementId
  }

  private static elementAt(
    target: HTMLElement | null,
    { x, y }: { readonly x: number; readonly y: number },
  ): string | undefined {
    const hit = document.elementFromPoint(x, y)?.closest("g.djs-element[data-element-id]")
    if (target === null || hit === null || hit === undefined || !target.contains(hit)) {
      return undefined
    }
    return hit.getAttribute("data-element-id") ?? undefined
  }
}
