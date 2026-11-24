import { Icon, TONE_ICON } from "@miragon/pulse-ui"
import { CircleXIcon, TriangleAlertIcon } from "lucide-react"
import type { ReactNode } from "react"
import { NoValue } from "../components/no-value.js"

export interface SourceCellProps {
  readonly label: ReactNode
  readonly unmappedTokens: boolean
}

export function SourceCell({ label, unmappedTokens }: SourceCellProps) {
  return (
    <span className="inline-flex items-center gap-2">
      {label}
      {unmappedTokens && (
        <span className="inline-flex items-center gap-1">
          <Icon icon={CircleXIcon} className={TONE_ICON.danger} />
          no mapping
        </span>
      )}
    </span>
  )
}

export interface NoteCellProps {
  readonly note: string | undefined
  readonly tone: "danger" | "warning"
  readonly noteId: string | undefined
}

export function NoteCell({ note, tone, noteId }: NoteCellProps) {
  if (note === undefined) {
    return <NoValue />
  }
  return (
    <span
      id={noteId}
      className="inline-flex items-center gap-1"
      data-part="mapping-note"
      data-tone={tone}
    >
      <Icon
        icon={tone === "danger" ? CircleXIcon : TriangleAlertIcon}
        dense
        className={TONE_ICON[tone]}
      />
      {note}
    </span>
  )
}
