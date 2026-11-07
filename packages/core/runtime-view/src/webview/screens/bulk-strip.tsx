import type { BulkProgress, BulkStatus, BulkView } from "../../core/protocol/index.js"
import { useEffect, useRef, useState } from "preact/hooks"
import { Icon } from "../components/icon.js"
import { StripButton, TONE_GLYPHS } from "../components/status-strip.js"
import { useStripActions } from "./notices.js"

const MOVING: ReadonlySet<BulkStatus> = new Set(["running", "stalled", "stopping"])

function useStatusAnnouncement(status: BulkStatus, text: string): string {
  const [announced, setAnnounced] = useState("")
  const shown = useRef<BulkStatus | undefined>(undefined)
  useEffect(() => {
    if (shown.current !== status) {
      shown.current = status
      setAnnounced(text)
    }
  }, [status, text])
  return announced
}

function ProgressBar({ progress }: { readonly progress: BulkProgress }) {
  const worked = progress.done + progress.failed
  const share = progress.total === 0 ? 0 : Math.round((worked / progress.total) * 100)
  return (
    <div
      class="bulk-strip__bar"
      role="progressbar"
      aria-label="Progress of the bulk operation"
      aria-valuemin={0}
      aria-valuemax={progress.total}
      aria-valuenow={worked}
      aria-valuetext={`${worked} of ${progress.total} done`}
    >
      <span class="bulk-strip__fill" style={{ width: `${share}%` }} />
    </div>
  )
}

export function BulkStrip({ bulk }: { readonly bulk: BulkView }) {
  const { notice, status, progress } = bulk
  const actions = useStripActions(notice.actions)
  const announced = useStatusAnnouncement(status, bulk.announcement)
  const detail = notice.detail
  return (
    <div class={`status-strip status-strip--${notice.tone} bulk-strip`}>
      <Icon of={TONE_GLYPHS[notice.tone]} class="status-strip__icon" />
      <p
        class="status-strip__text"
        title={detail === undefined ? notice.title : `${notice.title} ${detail}`}
      >
        <span class="status-strip__title">{notice.title}</span>
        {detail !== undefined && <span class="status-strip__detail">{detail}</span>}
      </p>
      {actions.length > 0 && (
        <div class="status-strip__actions">
          {actions.map((action) => (
            <StripButton key={action.label} action={action} />
          ))}
        </div>
      )}
      {MOVING.has(status) && <ProgressBar progress={progress} />}
      <span class="visually-hidden" aria-live={notice.tone === "danger" ? "assertive" : "polite"}>
        {announced}
      </span>
    </div>
  )
}
