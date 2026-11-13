import { useId } from "react"
import {
  Alert,
  AlertDescription,
  Button,
  Facts,
  cn,
  formatNumber,
  formatTimestamp,
  Icon,
  LogText,
  TEXT_BLOCK_FRAME,
  type Fact,
  SectionHeading,
} from "@miragon/pulse-ui"
import { HandOffButton, IdText } from "@miragon/pulse-widget-shell/widgets"
import { Check, RotateCcw } from "lucide-react"

import type { IncidentDetailData, IncidentDetailJob } from "../../view-models.js"

import { AlarmCount } from "../lib/alarm-count.js"
import { DoneMark } from "../lib/done-mark.js"
import { useHandOff, type HandOff } from "../lib/hand-off.js"
import { WriteError } from "../lib/write-error.js"
import { useT } from "../../messages/use-t.js"

function errorText(data: IncidentDetailData): string | null | undefined {
  return data.incidentMessage ?? data.job?.exceptionMessage
}

/** Built by the format tool, never filed. */
export function draftTicketHandOff(data: IncidentDetailData): HandOff {
  return {
    intent: "askAi.incident.draftTicket",
    ids: { engine: data.engineId, incidentId: data.incidentId },
    facts: { incidentType: data.incidentType },
    untrusted: [{ label: "incidentMessage", text: errorText(data) }],
  }
}

/** Reads the failure through a model-visible tool, never the app-only feed the host hides. */
export function explainErrorHandOff(data: IncidentDetailData): HandOff {
  return {
    intent: "askAi.incident.explainError",
    ids: {
      engine: data.engineId,
      incidentId: data.incidentId,
      jobId: data.job?.id,
      processInstanceId: data.processInstanceId,
      activityId: data.activityId,
    },
    facts: { incidentType: data.incidentType },
    untrusted: [{ label: "incidentMessage", text: errorText(data) }],
  }
}

export interface RemedyProps {
  resolved: boolean
  onResolve?: () => void
  resolving: boolean
  onRetry?: () => void
  retrying: boolean
  retried: boolean
  retryError?: string | null
}

/**
 * A job's retries left, a neutral number: none left is a failed job without retries, which adds
 * the danger tone's icon of its own shape, named in words for a screen reader.
 */
function RetriesLeft({ retries }: { retries: number }) {
  return <AlarmCount alarm={retries === 0 && "noRetriesLeft"}>{formatNumber(retries)}</AlarmCount>
}

/**
 * The incident's key facts as the webview's incident card lists them, never a KPI strip whose
 * tiles cut "10/10/202" (#322 U12): when, its retries, its job and its own id (each copyable),
 * how much history it has.
 */
function IncidentFacts({ data }: { data: IncidentDetailData }) {
  const t = useT()
  const facts: Fact[] = [
    {
      id: "occurred",
      label: t("incidentFailure.factOccurred"),
      value: formatTimestamp(data.incidentTimestamp),
    },
  ]
  if (data.job) {
    facts.push(
      {
        id: "retries",
        label: t("incidentFailure.factRetries"),
        value: <RetriesLeft retries={data.job.retries} />,
      },
      { id: "job", label: t("incidentFailure.job"), value: <IdText value={data.job.id} /> },
    )
  }
  facts.push({
    id: "incident",
    label: t("incidentFailure.factIncident"),
    value: <IdText value={data.incidentId} />,
  })
  if (data.historyTotalCount !== null) {
    facts.push({
      id: "history",
      label: t("incidentFailure.factHistory"),
      value: <span className="tabular-nums">{formatNumber(data.historyTotalCount)}</span>,
    })
  }
  return <Facts facts={facts} />
}

/** #322 U11/U12: the failure first, the deterministic remedy as the one primary button. */
export function FailureSummary({
  data,
  resolved,
  onResolve,
  resolving,
  onRetry,
  retrying,
  retried,
  retryError,
}: { data: IncidentDetailData } & RemedyProps) {
  const t = useT()
  const { ask } = useHandOff()
  // Two incident details on one page keep their own label.
  const headingId = useId()
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <SectionHeading
        as="h2"
        id={headingId}
        title={t("incidentFailure.errorMessageTitle")}
        className="mb-0"
      />
      <LogText text={errorText(data)} />
      <IncidentFacts data={data} />
      <div className="flex flex-wrap items-center gap-2">
        {retried || resolved ? (
          <DoneMark>
            {retried ? t("incidentFailure.retriedButton") : t("incidentDetail.resolved")}
          </DoneMark>
        ) : (
          <>
            {onRetry && <RetryButton data={data} onRetry={onRetry} retrying={retrying} />}
            {onResolve && (
              <Button
                size="sm"
                onClick={onResolve}
                disabled={resolving}
                aria-label={t("incidentFailure.resolveAria")}
              >
                <Icon icon={Check} />
                {t("incidentFailure.resolveButton")}
              </Button>
            )}
          </>
        )}
        {/* The failure's one action row: what clears it first, then the
            chat hand-offs about this error. */}
        <HandOffButton action="explainError" prompt={ask(explainErrorHandOff(data))} />
        <HandOffButton action="draftTicket" prompt={ask(draftTicketHandOff(data))} />
      </div>
      <WriteError error={retryError} />
    </section>
  )
}

/** The only remedy for failedJob / failedExternalTask. */
function RetryButton({
  data,
  onRetry,
  retrying,
}: {
  data: IncidentDetailData
  onRetry: () => void
  retrying: boolean
}) {
  const t = useT()
  const task = data.recovery.action === "retry-external-task"
  const aria = task ? t("incidentFailure.retryTaskAria") : t("incidentFailure.retryAria")
  return (
    <Button size="sm" onClick={onRetry} disabled={retrying} title={aria} aria-label={aria}>
      <Icon icon={RotateCcw} />
      {task ? t("incidentFailure.retryTaskButton") : t("incidentFailure.retryButton")}
    </Button>
  )
}

export function StacktraceTab({ data }: { data: IncidentDetailData }) {
  const t = useT()
  const job = data.job
  if (!job) {
    return (
      <Alert>
        <AlertDescription>{t("incidentFailure.noStacktrace")}</AlertDescription>
      </Alert>
    )
  }
  return (
    <div className="flex flex-col gap-3">
      <p className="text-muted-foreground text-small inline-flex items-center gap-2">
        {t("incidentFailure.job")} <IdText value={job.id} />
      </p>
      <StacktraceSection job={job} />
    </div>
  )
}

function StacktraceSection({ job }: { job: IncidentDetailJob }) {
  const t = useT()
  if (!job.stacktrace) {
    return (
      <Alert>
        <AlertDescription>{t("incidentFailure.noStacktrace")}</AlertDescription>
      </Alert>
    )
  }
  return (
    <pre
      aria-label={t("incidentFailure.stacktraceTitle")}
      className={cn(
        "border-border bg-card text-foreground text-small p-gutter rounded-md border font-mono leading-relaxed",
        TEXT_BLOCK_FRAME,
      )}
    >
      {job.stacktrace}
    </pre>
  )
}
