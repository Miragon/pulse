import { HostModelContext } from "@miragon/mcp-toolkit-ui/app"
import {
  Button,
  CountPill,
  KpiGrid,
  PagedListFooter,
  StatusBadge,
  WidgetHeader,
  type ToneVariant,
} from "@miragon/mcp-toolkit-ui"

import type { JobPanelData } from "../view-models.js"
import {
  formatNumber,
  formatTimestamp,
  HandOffButton,
  Icon,
  IdText,
  ListTable,
  LogText,
  NamedId,
  PagedRows,
  TableEmptyState,
  Td,
  usePagedViewData,
  ViewDataState,
  WidgetShell,
} from "@miragon/pulse-widget-shell/widgets"
import { Check } from "lucide-react"
import { CAMUNDA7_JOBS_DATA } from "../tool-names.js"
import { useEngineAction, type EngineAction } from "./lib/engine-action.js"
import { EngineMeta } from "./lib/engine-context.js"
import { MoreActions } from "./lib/more-actions.js"
import { instanceName, writeFeedback } from "./lib/write-feedback.js"
import { useHandOff, type HandOff, type ViewContext } from "./lib/hand-off.js"
import { useT } from "../messages/use-t.js"

export type { JobPanelData }

interface RetryArgs extends Record<string, unknown> {
  jobId: string
  retries: number
  engine?: string
}

// Standalone renders get only `data`: loadMore must page the echoed engine and filters (incl. a processDefinitionKey the widget has no prop for).
function buildJobsFeed(initialData: JobPanelData | null, engine?: string, failedOnly?: boolean) {
  const echoed = initialData?.filters
  const feedEngine = engine ?? initialData?.engineId
  const effectiveFailedOnly = failedOnly ?? echoed?.failedOnly
  const args: Record<string, unknown> = {}
  if (feedEngine) args.engine = feedEngine
  if (effectiveFailedOnly !== undefined) args.failedOnly = effectiveFailedOnly
  if (echoed?.processDefinitionKey) args.processDefinitionKey = echoed.processDefinitionKey
  return { feedEngine, effectiveFailedOnly, args }
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
    tools: [
      "camunda7_list_jobs",
      "camunda7_list_incidents",
      "camunda7_set_job_retries",
      "camunda7_set_job_retries_batch",
    ],
  }
}

// The batch retry is a tool only under admin; elsewhere per-job retries (operations) or nothing remain.
export function triageJobsHandOff(data: JobPanelData, engineId: string | undefined): HandOff {
  const scope = jobPanelScope(data)
  return {
    intent: "askAi.jobs.triage",
    ids: {
      engine: engineId,
      processDefinitionKey: scope.processDefinitionKey,
      noRetriesLeft: true,
    },
    facts: { totalJobs: scope.totalJobs, failedJobs: data.failedCount },
    tools: [
      "camunda7_list_jobs",
      "camunda7_get_job_stacktrace",
      "camunda7_list_incidents",
      "camunda7_query_historic_incidents",
      "camunda7_set_process_instance_variable",
      "camunda7_set_job_retries",
      "camunda7_set_job_retries_batch",
      "camunda7_format_incident_issue",
    ],
  }
}

// Exception text is engine data, quoted.
export function explainJobHandOff(job: Job, engineId: string | undefined): HandOff {
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
    tools: [
      "camunda7_get_job_stacktrace",
      "camunda7_get_process_instance",
      "camunda7_get_process_instance_variables",
      "camunda7_list_incidents",
    ],
  }
}

export function draftJobTicketHandOff(job: Job, engineId: string | undefined): HandOff {
  return {
    intent: "askAi.jobs.draftTicket",
    ids: {
      engine: engineId,
      processInstanceId: job.processInstanceId,
      activityId: job.activityId,
    },
    tools: ["camunda7_list_incidents", "camunda7_format_incident_issue"],
  }
}

// #322 U14: no retries left holds an incident (danger), retries left means the engine tries again (warning).
function retriesTone(job: Job): ToneVariant {
  if (job.retries === 0) return "danger"
  return job.exceptionMessage ? "warning" : "neutral"
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
  engineId: string | undefined
  showProcess: boolean
}) {
  const t = useT()
  const { ask } = useHandOff()
  const retried = retry.done.has(job.id)
  const retryError = retry.error(job.id)
  const name = job.activityName ?? job.activityId ?? job.id
  return (
    <tr className="hover:bg-muted transition-colors">
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
        {retryError && (
          <p role="alert" className="text-danger-ink text-small mt-1">
            {t("jobPanel.retryError", { message: retryError })}
          </p>
        )}
      </Td>
    </tr>
  )
}

export function JobPanelWidget({
  data: initialData = null,
  engine,
  failedOnly,
}: {
  data?: JobPanelData | null
  engine?: string
  failedOnly?: boolean
}) {
  const { ask, context } = useHandOff()
  const { feedEngine, effectiveFailedOnly, args } = buildJobsFeed(initialData, engine, failedOnly)
  const paged = usePagedViewData<JobPanelData["jobs"][number], JobPanelData>({
    initialData,
    key: ["camunda7:jobs", feedEngine ?? null, effectiveFailedOnly ?? null],
    tool: CAMUNDA7_JOBS_DATA,
    args,
    // Always ready: resolveEngine falls back to the saved/single engine; gating on `!!engine` would
    // leave a composed render without props stuck on "No data available".
    ready: true,
    selectItems: (d) => d.jobs,
    selectTotal: (d) => d.totalCount,
    pageSize: 50,
  })
  const t = useT()
  const data = paged.firstPage
  // The marks only bridge until the refetch; fresh page-0 data wins.
  const retry = useEngineAction<RetryArgs>({
    tool: "camunda7_set_job_retries",
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
  // Standalone renders have no `engine` prop; without this the prompts would inline "undefined".
  const engineId = engine ?? data.engineId
  const scopedKey = data.filters.processDefinitionKey
  const scopedProcess = scopedKey
    ? (jobs.find((j) => j.processDefinitionName)?.processDefinitionName ?? scopedKey)
    : null

  return (
    <WidgetShell>
      {/* Rendered in-component (not via the adapter's describeForModel) because
          this widget self-fetches in the cockpit, where the adapter has no data. */}
      <HostModelContext content={context(describeJobPanel(data, engineId, jobs.length))}>
        {null}
      </HostModelContext>
      <WidgetHeader
        title={t("jobPanel.title")}
        sub={
          <>
            <EngineMeta engineId={engineId} />
            <span>{t("jobPanel.badgeTotal", { count: formatNumber(totalCount) })}</span>
            {/* A panel scoped to one process names it here, once, not in every row. */}
            {scopedProcess && <span>{t("jobPanel.inProcess", { process: scopedProcess })}</span>}
          </>
        }
        actions={
          failedJobs.length > 0 && (
            <HandOffButton action="assess" prompt={ask(triageJobsHandOff(data, engineId))} />
          )
        }
      />
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
            tone: failedCount > 0 ? "danger" : undefined,
          },
          { label: t("jobPanel.healthy"), value: formatNumber(totalCount - failedCount) },
        ]}
      />

      {jobs.length === 0 ? (
        <TableEmptyState>{t("jobPanel.noJobs")}</TableEmptyState>
      ) : (
        <>
          {/* Jobs without retries come first — the feed sorts by retries. The
              rows are the inline head of the list (PagedRows, #396). */}
          <PagedRows paged={paged}>
            <ListTable
              ariaLabel={t("jobPanel.tableLabel")}
              columns={[
                { label: t("jobPanel.colActivity") },
                { label: t("jobPanel.colInstance"), hideBelow: "lg" },
                { label: t("jobPanel.colRetries"), align: "right" },
                { label: t("jobPanel.colError") },
                { label: t("jobPanel.colCreated"), align: "right", hideBelow: "md" },
                { plain: true, sticky: true },
              ]}
            >
              {jobs.map((job) => (
                <JobRow
                  key={job.id}
                  job={job}
                  retry={retry}
                  engineId={engineId}
                  showProcess={!data.filters.processDefinitionKey}
                />
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
