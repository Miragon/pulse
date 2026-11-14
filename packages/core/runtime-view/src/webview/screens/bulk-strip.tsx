import { cn, Icon, Progress, TONE_BORDER, TONE_ICON } from "@miragon/pulse-ui"
import { useEffect, useState } from "react"
import type { BulkProgress, BulkStatus, BulkView, Tone } from "../../core/protocol/index.js"
import { StripButton, TONE_GLYPHS } from "../components/status-strip.js"
import { CountLabels } from "../format/count-labels.js"
import { useStripActions } from "./notices.js"

const MOVING: ReadonlySet<BulkStatus> = new Set(["running", "stalled", "stopping"])

const SURFACE: Readonly<Record<Tone, string>> = {
  danger: "bg-danger-surface",
  warning: "bg-warning-surface",
  info: "bg-info-surface",
}

const LINE_PART = "min-w-0 overflow-hidden text-ellipsis @max-[30rem]/bar:[overflow-wrap:anywhere]"

interface Announced {
  readonly status: BulkStatus | undefined
  readonly text: string
}

function useStatusAnnouncement(status: BulkStatus, text: string): string {
  const [seen, setSeen] = useState<Announced>({ status: undefined, text: "" })
  const [mounted, setMounted] = useState(false)
  useEffect(() => {
    setMounted(true)
  }, [])
  if (mounted && seen.status !== status) {
    setSeen({ status, text })
    return text
  }
  return seen.text
}

function ProgressBar({ progress }: { readonly progress: BulkProgress }) {
  const worked = progress.done + progress.failed
  return (
    <Progress
      className="absolute inset-x-0 -bottom-px rounded-none"
      aria-label="Progress of the bulk operation"
      value={worked}
      max={progress.total}
      valueText={`${CountLabels.exact(worked)} of ${CountLabels.exact(progress.total)} done`}
    />
  )
}

function StripLine({ bulk }: { readonly bulk: BulkView }) {
  const { notice } = bulk
  const actions = useStripActions(notice.actions)
  const detail = notice.detail
  return (
    <div className="flex min-h-8 items-center gap-2 py-0.5 pr-2 pl-3 @max-[30rem]/bar:flex-wrap">
      <Icon
        icon={TONE_GLYPHS[notice.tone]}
        className={cn(TONE_ICON[notice.tone], "forced-colors:forced-color-adjust-none")}
      />
      <p
        className="text-dense flex min-w-0 flex-1 gap-2 whitespace-nowrap @max-[30rem]/bar:flex-wrap @max-[30rem]/bar:gap-y-0 @max-[30rem]/bar:whitespace-normal"
        title={detail === undefined ? notice.title : `${notice.title} ${detail}`}
      >
        <span
          className={cn(LINE_PART, "max-w-full shrink-0 font-semibold")}
          data-part="strip-title"
        >
          {notice.title}
        </span>
        {detail !== undefined && <span className={cn(LINE_PART, "shrink-[1000]")}>{detail}</span>}
      </p>
      {actions.length > 0 && (
        <div className="flex shrink-0 items-center gap-1.5">
          {actions.map((action) => (
            <StripButton key={action.label} action={action} />
          ))}
        </div>
      )}
    </div>
  )
}

export function BulkStrip({ bulk }: { readonly bulk: BulkView }) {
  const { notice, status, progress } = bulk
  const announced = useStatusAnnouncement(status, bulk.announcement)
  return (
    <div
      className={cn(
        "text-foreground @container/bar relative min-w-0 border-b",
        SURFACE[notice.tone],
        TONE_BORDER[notice.tone],
        "in-[[data-cd-kontrast=hoch]]:border-b-2 forced-colors:border-[color:CanvasText]",
      )}
      data-part="bulk-strip"
      data-tone={notice.tone}
    >
      <StripLine bulk={bulk} />
      {MOVING.has(status) && <ProgressBar progress={progress} />}
      <span className="sr-only" aria-live={notice.tone === "danger" ? "assertive" : "polite"}>
        {announced}
      </span>
    </div>
  )
}
