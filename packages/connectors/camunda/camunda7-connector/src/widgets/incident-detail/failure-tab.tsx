import { useId } from "react"
import {
  Alert,
  AlertDescription,
  Button,
  MICRO_LABEL,
  StatusBadge,
  cn,
} from "@miragon/mcp-toolkit-ui"
import {
  formatNumber,
  formatTimestamp,
  HandOffButton,
  Icon,
  IdText,
  LogText,
  TEXT_BLOCK_FRAME,
} from "@miragon/pulse-widget-shell/widgets"
import { Check, RotateCcw } from "lucide-react"

import type { IncidentDetailData, IncidentDetailJob } from "../../view-models.js"

import { recoveryOf } from "../lib/incident-recovery.js"
import { useHandOff, type HandOff } from "../lib/hand-off.js"
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
    tools: ["camunda7_format_incident_issue"],
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
    tools: [
      "camunda7_get_job_stacktrace",
      "camunda7_list_external_tasks",
      "camunda7_format_incident_issue",
    ],
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

/** One wrapping line instead of a KPI strip whose tiles cut "10/10/202" (#322 U12). */
function FactLine({ data }: { data: IncidentDetailData }) {
  const t = useT()
  const facts = [
    t("incidentFailure.factOccurred", { time: formatTimestamp(data.incidentTimestamp) }),
    data.job ? t("incidentFailure.retriesLeft", { count: formatNumber(data.job.retries) }) : null,
    data.historyTotalCount !== null
      ? t("incidentFailure.factHistory", { count: formatNumber(data.historyTotalCount) })
      : null,
  ].filter((fact): fact is string => fact !== null)
  return <p className="text-muted-foreground text-small break-words">{facts.join(" · ")}</p>
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
      <h2 id={headingId} className={cn("text-muted-foreground", MICRO_LABEL)}>
        {t("incidentFailure.errorMessageTitle")}
      </h2>
      <LogText text={errorText(data)} />
      <div className="flex flex-wrap items-center gap-2">
        {retried || resolved ? (
          <StatusBadge tone="success">
            <Icon icon={Check} dense />
            {retried ? t("incidentFailure.retriedButton") : t("incidentDetail.resolved")}
          </StatusBadge>
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
      {retryError && (
        <p role="alert" className="text-danger-ink text-small">
          {t("incidentFailure.retryError", { message: retryError })}
        </p>
      )}
      <FactLine data={data} />
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
  const task = recoveryOf(data).action === "retry-external-task"
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
        "border-border bg-card text-foreground text-small rounded-md border p-3 font-mono leading-relaxed",
        TEXT_BLOCK_FRAME,
      )}
    >
      {job.stacktrace}
    </pre>
  )
}
