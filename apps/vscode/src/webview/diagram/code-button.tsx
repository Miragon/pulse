import { Icon } from "../components/icon.js"
import { glyphs } from "../components/lucide-glyphs.json"

export interface ElementCode {
  readonly elementId: string
  readonly label: string
}

export interface CodeButtonProps {
  readonly code: ElementCode
  readonly onOpen: (elementId: string) => void
}

export function CodeButton({ code, onOpen }: CodeButtonProps) {
  const label = `Open ${code.label}`
  return (
    <button
      type="button"
      class="code-button"
      data-code-for={code.elementId}
      aria-label={label}
      title={label}
      onClick={(event) => {
        event.stopPropagation()
        onOpen(code.elementId)
      }}
    >
      <Icon of={glyphs.FileCode} size={12} />
    </button>
  )
}
