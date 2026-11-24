import { Icon, NativeSelect, TONE_ICON } from "@miragon/pulse-ui"
import { CircleXIcon, TriangleAlertIcon } from "lucide-react"
import type { ReactNode } from "react"
import type { MappingCandidate } from "../../core/protocol/index.js"
import { NoValue } from "../components/no-value.js"
import { usePendingValue } from "../components/pending-value.js"
import { useHost } from "../host/host-context.js"

export interface TargetSelectProps {
  readonly sourceElementId: string
  readonly sourceLabel: string
  readonly candidates: readonly MappingCandidate[]
  readonly targetElementId?: string | undefined
  readonly targetLabel?: string | undefined
  readonly noteId: string | undefined
}

export function TargetSelect(props: TargetSelectProps) {
  const { sourceElementId, sourceLabel, candidates, targetElementId, noteId } = props
  const host = useHost()
  const [target, pick] = usePendingValue(targetElementId ?? "")
  const foreign =
    targetElementId !== undefined &&
    !candidates.some((candidate) => candidate.elementId === targetElementId)
  return (
    <NativeSelect
      className="min-h-control-xs h-control-xs max-w-[280px] px-2"
      aria-label={`Map ${sourceLabel} to`}
      aria-describedby={noteId}
      data-map-select={sourceElementId}
      value={target}
      onFocus={() => {
        host.post({ type: "focusMapping", sourceElementId })
      }}
      onChange={(event) => {
        const picked = event.currentTarget.value
        pick(picked)
        host.post(
          picked === ""
            ? { type: "unmapElement", sourceElementId }
            : { type: "mapElement", sourceElementId, targetElementId: picked },
        )
      }}
    >
      <option value="">Not mapped</option>
      {foreign && (
        <option value={targetElementId} disabled>
          {props.targetLabel ?? targetElementId}
        </option>
      )}
      {candidates.map((candidate) => (
        <option key={candidate.elementId} value={candidate.elementId}>
          {candidate.label}
        </option>
      ))}
    </NativeSelect>
  )
}

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
