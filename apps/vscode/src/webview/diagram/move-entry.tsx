import { Icon } from "../components/icon.js"
import { glyphs } from "../components/lucide-glyphs.json"

const MOVE_LABEL = "Move this token…"

export interface MoveEntryDecoration {
  readonly elementId: string
  readonly refusal?: string
  readonly onStart: () => void
}

export function MoveEntry({ entry }: { readonly entry: MoveEntryDecoration }) {
  if (entry.refusal !== undefined) {
    const label = `Can't move: ${entry.refusal}`
    return (
      <span class="move-entry move-entry--refused" role="img" aria-label={label} title={label}>
        <Icon of={glyphs.Ban} size={12} />
      </span>
    )
  }
  return (
    <button
      type="button"
      class="move-entry"
      data-move-from={entry.elementId}
      aria-label={MOVE_LABEL}
      title={MOVE_LABEL}
      onClick={(event) => {
        event.stopPropagation()
        entry.onStart()
      }}
    >
      <Icon of={glyphs.MoveRight} size={12} />
    </button>
  )
}
