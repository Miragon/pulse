import {
  Button,
  formatClock,
  formatInstant,
  formatNumber,
  LogText,
  NamedId,
  shortId,
  Td,
} from "@miragon/pulse-ui"
import {
  FIT_CONTINUES_ROW,
  HandOffButton,
  IdText,
  ListRow,
} from "@miragon/pulse-widget-shell/widgets"
import type { JobPanelData } from "../../view-models.js"
import { AlarmCount, type CountAlarm } from "../lib/alarm-count.js"
import { DoneMark } from "../lib/done-mark.js"
import type { EngineAction } from "../lib/engine-action.js"
import { MoreActions } from "../lib/more-actions.js"
import { WriteError } from "../lib/write-error.js"
import { instanceName, writeFeedback } from "../lib/write-feedback.js"
import { useHandOff, type HandOff } from "../lib/hand-off.js"
import { useT, type T } from "../../messages/use-t.js"

// One row of the jobs list: its job, its retry and the hand-offs about it.

export interface RetryArgs extends Record<string, unknown> {
  jobId: string
  retries: number
  engine?: string
}

type Job = JobPanelData["jobs"][number]

// Exception text is engine data, quoted.
function explainJobHandOff(job: Job, engineId: string | undefined): HandOff {
  return {
    intent: "askAi.jobs.explainFailure",
    ids: {
      engine: engineId,
      jobId: job.id,
      processInstanceId: job.processInstanceId,
      processDefinitionKey: job.processDefinitionKey,
      activityId: job.activityId,
    },
    facts: { retries: job.retries },
    untrusted: [{ label: "exceptionMessage", text: job.exceptionMessage }],
  }
}

function draftJobTicketHandOff(job: Job, engineId: string | undefined): HandOff {
  return {
    intent: "askAi.jobs.draftTicket",
    ids: {
      engine: engineId,
      processInstanceId: job.processInstanceId,
      activityId: job.activityId,
    },
  }
}

// #322 U14: no retries left holds an incident (danger), retries left means the engine tries again
// (warning); the number stays neutral, the alarm is its icon and words.
function retriesAlarm(job: Job): CountAlarm | null {
  if (job.retries === 0) return "noRetriesLeft"
  return job.exceptionMessage ? "retriesLeft" : null
}

// A panel scoped to one process names it in the head, not in every row. No floor of its own: the
// name's one line keeps the kit's, and under 28rem it shows alone, so the error gets the room.
function JobSubject({ job, showProcess }: { job: Job; showProcess: boolean }) {
  const t = useT()
  const process = showProcess ? (job.processDefinitionName ?? job.processDefinitionKey) : null
  const inProcess = process ? t("jobPanel.inProcess", { process }) : null
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      {job.activityId ? (
        <NamedId name={job.activityName} id={job.activityId} detail={[inProcess]} />
      ) : (
        <>
          <span className="text-muted-foreground">{"—"}</span>
          {inProcess && (
            <span className="text-muted-foreground text-small break-words">{inProcess}</span>
          )}
        </>
      )}
    </div>
  )
}

/** A failed job's actions: its retry, then the hand-offs about it in its menu. */
function JobActions({
  job,
  retry,
  engineId,
  handOffs,
}: {
  job: Job
  retry: EngineAction<RetryArgs, unknown>
  engineId: string
  handOffs: boolean
}) {
  const t = useT()
  const { ask } = useHandOff()
  const name = job.activityName ?? job.activityId ?? job.id
  if (retry.done.has(job.id)) return <DoneMark>{t("jobPanel.retried")}</DoneMark>
  if (job.retries !== 0) return null
  return (
    // A row's actions are xs, so the row keeps the row height (28 px).
    <div className="inline-flex items-center justify-end gap-1">
      {retry.allowed && (
        <Button
          variant="outline"
          size="xs"
          disabled={retry.pending(job.id)}
          onClick={() =>
            retry.run(
              { jobId: job.id, retries: 1, engine: engineId },
              { feedback: writeFeedback.jobRetry(t, instanceName(job.processInstanceId)) },
            )
          }
        >
          {t("jobPanel.retry")}
        </Button>
      )}
      {/* Its entries are hand-offs only: a host that shows none gets no menu. */}
      {handOffs && (
        <MoreActions label={t("jobPanel.moreActions", { name })}>
          <HandOffButton
            action="explainError"
            variant="menuitem"
            prompt={ask(explainJobHandOff(job, engineId))}
          />
          <HandOffButton
            action="draftTicket"
            variant="menuitem"
            prompt={ask(draftJobTicketHandOff(job, engineId))}
          />
        </MoreActions>
      )}
    </div>
  )
}

/** What the row opens, its instance, named by the job: its activity, else its own short id. */
function jobRowLabel(t: T, job: Job): string {
  const instance = shortId(job.processInstanceId)
  const activity = job.activityName ?? job.activityId
  return activity
    ? t("jobPanel.rowLabel", { activity, instance })
    : t("jobPanel.rowLabelJob", { job: shortId(job.id), instance })
}

// #322 U2, U11, U13. A done retry shows a check, never a dimmed row that reads as disabled. The row
// opens the job's instance, where its incident shows, on a click or Enter and copies the job's id
// on Ctrl or Cmd with C (one row convention); its retry and its menu at its end open nothing.
export function JobRow({
  job,
  retry,
  engineId,
  showProcess,
  showRetries,
  handOffs,
  onOpen,
}: {
  job: Job
  retry: EngineAction<RetryArgs, unknown>
  engineId: string
  showProcess: boolean
  /** Every job of the scope listed: the jobs without retries hold the same 0 in every row. */
  showRetries: boolean
  /** Whether the host shows hand-offs; with no retry either, the row has no actions cell. */
  handOffs: boolean
  onOpen: (job: Job) => void
}) {
  const t = useT()
  const retried = retry.done.has(job.id)
  return (
    <ListRow
      label={jobRowLabel(t, job)}
      onOpen={() => onOpen(job)}
      copy={job.id}
      copyLabel={t("jobPanel.jobId")}
    >
      <Td>
        <JobSubject job={job} showProcess={showProcess} />
      </Td>
      <Td className="whitespace-nowrap">
        <IdText value={job.processInstanceId} />
      </Td>
      {showRetries && (
        <Td align="right">
          <AlarmCount alarm={!retried && retriesAlarm(job)}>
            {formatNumber(retried ? 1 : job.retries)}
          </AlarmCount>
        </Td>
      )}
      <Td>
        {/* One line at the row height, whole in its title; a cut one opens on its whole text. */}
        <LogText kind="message" text={job.exceptionMessage} line />
      </Td>
      <Td align="right" className="text-muted-foreground whitespace-nowrap tabular-nums">
        {/* The time on the clock, its day on another day; the whole instant in its title. */}
        <span title={job.createTime ? formatInstant(job.createTime) : undefined}>
          {formatClock(job.createTime, { seconds: false })}
        </span>
      </Td>
      {(retry.allowed || handOffs) && (
        <Td align="right">
          <JobActions job={job} retry={retry} engineId={engineId} handOffs={handOffs} />
        </Td>
      )}
    </ListRow>
  )
}

/** Its job's failure across every column, not in the pinned one: one item in the fit. */
export function JobRetryError({ error, columns }: { error: string | null; columns: number }) {
  if (!error) return null
  return (
    <tr {...FIT_CONTINUES_ROW}>
      <td colSpan={columns} className="border-border px-cell py-cell border-b">
        <WriteError error={error} />
      </td>
    </tr>
  )
}
