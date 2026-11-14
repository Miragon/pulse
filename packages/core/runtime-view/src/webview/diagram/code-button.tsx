import { FileCodeIcon } from "lucide-react"
import { Icon } from "@miragon/pulse-ui"

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
      className="code-button"
      data-part="code-button"
      data-code-for={code.elementId}
      aria-label={label}
      title={label}
      onClick={(event) => {
        event.stopPropagation()
        onOpen(code.elementId)
      }}
    >
      <Icon icon={FileCodeIcon} dense />
    </button>
  )
}
