import type { ComponentChildren } from "preact"

export interface BoardCardProps {
  readonly title: string
  readonly kind: "counter" | "instanceList" | "incidentSummary"
  readonly children: ComponentChildren
}

export function BoardCard({ title, kind, children }: BoardCardProps) {
  return (
    <section class={`board-card board-card--${kind}`} aria-label={title}>
      <h2 class="board-card__title" title={title}>
        {title}
      </h2>
      {children}
    </section>
  )
}
