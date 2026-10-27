import type { ComponentChildren } from "preact"
import { useId } from "preact/hooks"
import type { BoardTile } from "../../../core/protocol/index.js"

export interface BoardCardProps {
  readonly title: string
  readonly kind: BoardTile["kind"]
  readonly children: ComponentChildren
}

export function BoardCard({ title, kind, children }: BoardCardProps) {
  const heading = useId()
  return (
    <section class={`board-card board-card--${kind}`} aria-labelledby={heading}>
      <h2 id={heading} class="board-card__title" title={title}>
        {title}
      </h2>
      {children}
    </section>
  )
}
