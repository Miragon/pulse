import { Fragment } from "react"
import {
  Button,
  CountPill,
  KpiGrid,
  PagedListFooter,
  SITUATION_TONES,
  StatusBadge,
  WidgetHeader,
  type ToneVariant,
  formatNumber,
  formatTimestamp,
  Icon,
  LogText,
  NamedId,
  TableEmptyState,
  Td,
} from "@miragon/pulse-ui"

import { LIST_PAGE_SIZE, type JobPanelData } from "../view-models.js"
import {
  FIT_CONTINUES_ROW,
  HandOffButton,
  IdText,
  ListTable,
  type ListTableColumn,
  PagedRows,
  usePagedViewData,
  ViewDataState,
  WidgetShell,
  HostModelContext,
} from "@miragon/pulse-widget-shell/widgets"
import { Check } from "lucide-react"
import { ENGINE_JOBS_DATA } from "../tool-names.js"
import { useEngineAction, type EngineAction } from "./lib/engine-action.js"
import { MoreActions } from "./lib/more-actions.js"
import { WriteError } from "./lib/write-error.js"
import { instanceName, writeFeedback } from "./lib/write-feedback.js"
import { useHandOff, type HandOff, type ViewContext } from "./lib/hand-off.js"
import { useT } from "../messages/use-t.js"

export type { JobPanelData }

interface RetryArgs extends Record<string, unknown> {
  jobId: string
  retries: number
  engine?: string
}

/** The route's scope: loadMore() pages its engine and filters, never the default engine. */
interface JobsRoute {
  engine: string
  processDefinitionKey?: string
  failedOnly?: boolean
}

function jobsFeedArgs({ engine, processDefinitionKey, failedOnly }: JobsRoute) {
  const args: Record<string, unknown> = { engine }
  if (failedOnly !== undefined) args.failedOnly = failedOnly
  if (processDefinitionKey) args.processDefinitionKey = processDefinitionKey
  return args
}

type Job = JobPanelData["jobs"][number]

// A failed-only panel's `totalCount` IS its failed count, so the total is stated only unfiltered,
// never as "N jobs, all of them failed".
function jobPanelScope(data: JobPanelData) {
  const failedOnly = data.filters.failedOnly === true
  return {
    processDefinitionKey: data.filters.processDefinitionKey,
    failedOnly: failedOnly || undefined,
    totalJobs: failedOnly ? undefined : data.totalCount,
  }
}

export function describeJobPanel(
  data: JobPanelData,
  engineId: string | undefined,
  loaded: number,
): ViewContext {
  const scope = jobPanelScope(data)
  return {
    summary: "The operator is viewing the job management panel.",
    ids: { engine: engineId, processDefinitionKey: scope.processDefinitionKey },
    facts: {
      totalJobs: scope.totalJobs,
      failedJobs: data.failedCount,
      loaded,
      failedOnly: scope.failedOnly,
    },
  }
}

// Which retry the toolset offers (batch, per job or none) is the module instructions' playbook.
export function triageJobsHandOff(data: JobPanelData, engineId: string | undefined): HandOff {
  const scope = jobPanelScope(data)
  return {
    intent: "askAi.jobs.triage",
    ids: {
      engine: engineId,
      processDefinitionKey: scope.processDefinitionKey,
    },
    facts: { totalJobs: scope.totalJobs, failedJobs: data.failedCount },
  }
}

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

// #322 U14: no retries left holds an incident (danger), retries left means the engine tries again (warning).
function retriesTone(job: Job): ToneVariant {
  if (job.retries === 0) return SITUATION_TONES.jobWithoutRetries
  return job.exceptionMessage ? SITUATION_TONES.jobWithRetriesLeft : "neutral"
}

// A panel scoped to one process names it in the head, not in every row.
function JobSubject({ job, showProcess }: { job: Job; showProcess: boolean }) {
  const t = useT()
  const process = showProcess ? (job.processDefinitionName ?? job.processDefinitionKey) : null
  const inProcess = process ? t("jobPanel.inProcess", { process }) : null
  // A floor, or wrapping names get squeezed into a column a word wide.
  return (
    <div className="flex min-w-48 flex-col gap-0.5">
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

// #322 U2, U11, U13. A done retry shows a check, never a dimmed row that reads as disabled.
function JobRow({
  job,
  retry,
  engineId,
  showProcess,
}: {
  job: Job
  retry: EngineAction<RetryArgs, unknown>
  engineId: string
  showProcess: boolean
}) {
  const t = useT()
  const { ask } = useHandOff()
  const retried = retry.done.has(job.id)
  const name = job.activityName ?? job.activityId ?? job.id
  return (
    <tr>
      <Td>
        <JobSubject job={job} showProcess={showProcess} />
      </Td>
      <Td className="whitespace-nowrap">
        <IdText value={job.processInstanceId} />
      </Td>
      <Td align="right">
        <CountPill tone={retried ? "neutral" : retriesTone(job)}>
          {formatNumber(retried ? 1 : job.retries)}
        </CountPill>
      </Td>
      <Td>
        <LogText text={job.exceptionMessage} />
      </Td>
      <Td align="right" className="text-muted-foreground text-small whitespace-nowrap">
        {formatTimestamp(job.createTime)}
      </Td>
      <Td align="right">
        {retried ? (
          <StatusBadge tone="success" className="whitespace-nowrap">
            <Icon icon={Check} dense />
            {t("jobPanel.retried")}
          </StatusBadge>
        ) : (
          job.retries === 0 && (
            <div className="inline-flex items-center justify-end gap-1">
              {retry.allowed && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={retry.pending(job.id)}
                  onClick={() =>
                    retry.run(
                      { jobId: job.id, retries: 1, engine: engineId },
                      {
                        feedback: writeFeedback.jobRetry(t, instanceName(job.processInstanceId)),
                      },
                    )
                  }
                >
                  {t("jobPanel.retry")}
                </Button>
              )}
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
            </div>
          )
        )}
      </Td>
    </tr>
  )
}

/** Its job's failure across every column, not in the pinned one: one item in the fit. */
function JobRetryError({ error, columns }: { error: string | null; columns: number }) {
  if (!error) return null
  return (
    <tr {...FIT_CONTINUES_ROW}>
      <td colSpan={columns} className="border-border px-cell border-b py-1.5">
        <WriteError error={error} />
      </td>
    </tr>
  )
}

export function JobPanelWidget({
  data: initialData = null,
  ...route
}: JobsRoute & { data?: JobPanelData | null }) {
  const { ask, context } = useHandOff()
  const { engine, processDefinitionKey, failedOnly } = route
  const paged = usePagedViewData<JobPanelData["jobs"][number], JobPanelData>({
    initialData,
    key: ["engine:jobs", engine, processDefinitionKey ?? null, failedOnly ?? null],
    tool: ENGINE_JOBS_DATA,
    args: jobsFeedArgs(route),
    ready: true,
    selectItems: (d) => d.jobs,
    selectTotal: (d) => d.totalCount,
    pageSize: LIST_PAGE_SIZE,
  })
  const t = useT()
  const data = paged.firstPage
  // The marks only bridge until the refetch; fresh page-0 data wins.
  const retry = useEngineAction<RetryArgs>({
    tool: "engine_set_job_retries",
    engine,
    target: (args) => args.jobId,
    resetOn: data,
  })

  if (!data) {
    return (
      <WidgetShell>
        <ViewDataState
          loading={paged.loading}
          error={paged.error}
          onRetry={paged.retry}
          loadingText={t("jobPanel.loading")}
          emptyText={t("jobPanel.noData")}
        />
      </WidgetShell>
    )
  }

  const { totalCount, failedCount } = data
  const jobs = paged.items
  const failedJobs = jobs.filter((j) => j.retries === 0 && !retry.done.has(j.id))
  const shownKey = data.filters.processDefinitionKey
  const scopedProcess = shownKey
    ? (jobs.find((j) => j.processDefinitionName)?.processDefinitionName ?? shownKey)
    : null
  const columns: ListTableColumn[] = [
    { label: t("jobPanel.colActivity") },
    { label: t("jobPanel.colInstance"), hideBelow: "lg" },
    { label: t("jobPanel.colRetries"), align: "right" },
    { label: t("jobPanel.colError") },
    { label: t("jobPanel.colCreated"), align: "right", hideBelow: "md" },
    { plain: true, sticky: true },
  ]

  return (
    <WidgetShell
      header={
        <WidgetHeader
          title={t("jobPanel.title")}
          sub={
            <>
              <span>{t("jobPanel.badgeTotal", { count: formatNumber(totalCount) })}</span>
              {/* A panel scoped to one process names it here, once, not in every row. */}
              {scopedProcess && <span>{t("jobPanel.inProcess", { process: scopedProcess })}</span>}
            </>
          }
          actions={
            failedJobs.length > 0 && (
              <HandOffButton
                action="assess"
                variant="toolbar"
                prompt={ask(triageJobsHandOff(data, engine))}
              />
            )
          }
        />
      }
    >
      {/* Described from what is on screen: in the cockpit the widget self-fetches,
          so only it knows the data. */}
      <HostModelContext content={context(describeJobPanel(data, engine, jobs.length))}>
        {null}
      </HostModelContext>
      {/* Only the jobs without retries carry a state; the other two are counts. */}
      <KpiGrid
        variant="soft"
        className="grid-cols-2 gap-3 sm:grid-cols-3"
        ariaLabel={t("jobPanel.summaryLabel")}
        cells={[
          { label: t("jobPanel.totalJobs"), value: formatNumber(totalCount) },
          {
            label: t("jobPanel.stuck"),
            value: formatNumber(failedCount),
            tone: failedCount > 0 ? SITUATION_TONES.jobWithoutRetries : undefined,
          },
          { label: t("jobPanel.healthy"), value: formatNumber(totalCount - failedCount) },
        ]}
      />

      {jobs.length === 0 ? (
        <TableEmptyState>{t("jobPanel.noJobs")}</TableEmptyState>
      ) : (
        <>
          {/* Jobs without retries come first: the feed sorts by retries. The
              rows are the inline head of the list (PagedRows, #396). */}
          <PagedRows paged={paged}>
            <ListTable ariaLabel={t("jobPanel.tableLabel")} columns={columns}>
              {jobs.map((job) => (
                <Fragment key={job.id}>
                  <JobRow
                    job={job}
                    retry={retry}
                    engineId={engine}
                    showProcess={!data.filters.processDefinitionKey}
                  />
                  <JobRetryError error={retry.error(job.id)} columns={columns.length} />
                </Fragment>
              ))}
            </ListTable>
          </PagedRows>
          <PagedListFooter
            paged={paged}
            noun={t("jobPanel.footerNoun")}
            labels={paged.footerLabels}
          />
        </>
      )}
    </WidgetShell>
  )
}
