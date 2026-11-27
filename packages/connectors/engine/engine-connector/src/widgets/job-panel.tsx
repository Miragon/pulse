import { Fragment } from "react"
import {
  FreshnessStamp,
  PagedListFooter,
  SegmentedControl,
  Toolbar,
  WidgetHeader,
  formatNumber,
  TableEmptyState,
  type SegmentedControlOption,
} from "@miragon/pulse-ui"

import { LIST_PAGE_SIZE, type JobPanelData, type ListTenant } from "../view-models.js"
import {
  type AskAiPrompt,
  HandOffButton,
  ListTable,
  type ListTableColumn,
  PagedRows,
  usePagedViewData,
  ViewDataState,
  WidgetShell,
  HostModelContext,
} from "@miragon/pulse-widget-shell/widgets"
import { ENGINE_JOBS_DATA } from "../tool-names.js"
import { useNav } from "./navigation.js"
import { useEngineAction } from "./lib/engine-action.js"
import { useHandOff, useHandOffsShown, type HandOff, type ViewContext } from "./lib/hand-off.js"
import { JobRetryError, JobRow, type RetryArgs } from "./job-panel/job-row.js"
import { useT, type T } from "../messages/use-t.js"

export type { JobPanelData }

const SCOPE_ALL = "all"
const SCOPE_WITHOUT_RETRIES = "withoutRetries"

/** The list's two scopes: every job, or the jobs without retries (the feed's `failedOnly`). */
type JobScope = typeof SCOPE_ALL | typeof SCOPE_WITHOUT_RETRIES

/** The route's scope: loadMore() pages its engine and filters, never the default engine. */
interface JobsRoute {
  engine: string
  processDefinitionKey?: string
  /** The tenant a process opened its jobs in (null: none); absent, every tenant's. */
  onlyTenant?: ListTenant
  failedOnly?: boolean
}

/** The scope's flag goes out only when it narrows: every job is the feed's default. */
function jobsFeedArgs({ engine, processDefinitionKey, onlyTenant, failedOnly }: JobsRoute) {
  const args: Record<string, unknown> = { engine }
  if (failedOnly) args.failedOnly = true
  if (processDefinitionKey) args.processDefinitionKey = processDefinitionKey
  if (processDefinitionKey && onlyTenant !== undefined) args.onlyTenant = onlyTenant
  return args
}

// The feed counts every job of the process scope and its jobs without retries in either listed
// scope, so the total is stated in both, never "N jobs, all of them failed".
function jobPanelScope(data: JobPanelData) {
  return {
    processDefinitionKey: data.filters.processDefinitionKey,
    failedOnly: data.filters.failedOnly === true || undefined,
    totalJobs: data.allCount,
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

/** The bar's count: the scope that is listed, the page on screen's, never the other one too. */
function shownCount(t: T, data: JobPanelData): string {
  return data.filters.failedOnly === true
    ? t("jobPanel.badgeWithoutRetries", { count: formatNumber(data.failedCount) })
    : t("jobPanel.badgeTotal", { count: formatNumber(data.allCount) })
}

/** The table's columns for the scope on screen: its order is the feed's, retries first. */
function jobColumns(t: T, withoutRetries: boolean, actions: boolean): ListTableColumn[] {
  return [
    { label: t("jobPanel.colActivity") },
    { label: t("jobPanel.colInstance"), hideBelow: "lg" },
    // A column every row of the scope fills alike says nothing: without retries it is 0 throughout.
    ...(withoutRetries
      ? []
      : [{ label: t("jobPanel.colRetries"), align: "right" as const, sort: "ascending" as const }]),
    { label: t("jobPanel.colError") },
    { label: t("jobPanel.colCreated"), align: "right", hideBelow: "md", fit: true },
    // No column that no row can fill: it would read as missing data.
    ...(actions
      ? [{ label: t("jobPanel.colActions"), align: "right" as const, sticky: "sm" as const }]
      : []),
  ]
}

/**
 * The jobs' bar and, under it from edge to edge, their scope (the instance list's filter bar): the
 * engine in the title, the listed scope's count, the process it is scoped to, the triage hand-off
 * and when the numbers were read. Each segment counts its scope from the payload on screen,
 * whichever is checked; the count without retries alarms by its icon, never by a coloured number
 * (invariant 6). Busy while a scope's page loads.
 */
function JobsHeader({
  data,
  title,
  scope,
  onScope,
  busy,
  triage,
}: {
  data: JobPanelData
  title: string
  scope: JobScope
  onScope: (next: JobScope) => void
  busy: boolean
  /** The triage's prompt; null where the host shows no hand-off or no job lacks retries. */
  triage: AskAiPrompt | null
}) {
  const t = useT()
  const shownKey = data.filters.processDefinitionKey
  const scopedProcess = shownKey
    ? (data.jobs.find((j) => j.processDefinitionName)?.processDefinitionName ?? shownKey)
    : null
  const scopes: SegmentedControlOption<JobScope>[] = [
    { value: SCOPE_ALL, label: t("jobPanel.scopeAll"), count: data.allCount },
    {
      value: SCOPE_WITHOUT_RETRIES,
      label: t("jobPanel.scopeWithoutRetries"),
      count: data.failedCount,
      tone: data.failedCount > 0 ? "danger" : undefined,
    },
  ]
  return (
    <>
      <WidgetHeader
        title={title}
        sub={
          <>
            <span>{shownCount(t, data)}</span>
            {/* A panel scoped to one process names it here, once, not in every row. */}
            {scopedProcess && <span>{t("jobPanel.inProcess", { process: scopedProcess })}</span>}
          </>
        }
        actions={
          // Its one action is a hand-off: where the host hides it, the bar has no group.
          triage !== null && <HandOffButton action="assess" variant="toolbar" prompt={triage} />
        }
        freshness={<FreshnessStamp at={data.fetchedAt} />}
      />
      <Toolbar>
        <SegmentedControl
          ariaLabel={t("jobPanel.scopeLabel")}
          options={scopes}
          value={scope}
          onChange={onScope}
          busy={busy}
        />
      </Toolbar>
    </>
  )
}

export function JobPanelWidget({
  data: initialData = null,
  ...route
}: JobsRoute & { data?: JobPanelData | null }) {
  const { ask, context } = useHandOff()
  const handOffs = useHandOffsShown()
  const go = useNav()
  const { engine, processDefinitionKey, onlyTenant } = route
  // The scope is the route's, part of the cockpit's place: a drill to the jobs without retries
  // checks it, and a click on the segment moves the cockpit to the other one (the same view in
  // another scope), so a page's address, its memo and Back keep the scope on screen.
  const failedOnly = route.failedOnly === true
  const scope: JobScope = failedOnly ? SCOPE_WITHOUT_RETRIES : SCOPE_ALL
  const onScope = (next: JobScope) =>
    go({
      type: "jobs",
      processDefinitionKey,
      ...(onlyTenant === undefined ? {} : { onlyTenant }),
      failedOnly: next === SCOPE_WITHOUT_RETRIES ? true : undefined,
    })
  // The handed-in page is its own scope's page 0: the other scope reads its own.
  const seed = (initialData?.filters.failedOnly === true) === failedOnly ? initialData : null
  const paged = usePagedViewData<JobPanelData["jobs"][number], JobPanelData>({
    initialData: seed,
    // One list in either scope (the scope goes out in `args`): while the other scope's page loads,
    // the page on screen stays with its segment, busy, instead of the loading guard.
    key: [
      "engine:jobs",
      engine,
      processDefinitionKey ?? null,
      onlyTenant === undefined ? "*" : onlyTenant,
    ],
    tool: ENGINE_JOBS_DATA,
    args: jobsFeedArgs({ engine, processDefinitionKey, onlyTenant, failedOnly }),
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

  // The engine in the title, as the overview and the incidents name it.
  const title = t("jobPanel.titleFor", { engine })
  if (!data) {
    // Loading or failed, the route keeps its title, the page's one heading.
    return (
      <WidgetShell header={<WidgetHeader title={title} />}>
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

  const jobs = paged.items
  const failedJobs = jobs.filter((j) => j.retries === 0 && !retry.done.has(j.id))
  // The rows on screen answer the page's scope, which may still be the other segment's.
  const listsWithoutRetries = data.filters.failedOnly === true
  const columns = jobColumns(t, listsWithoutRetries, retry.allowed || handOffs)

  return (
    <WidgetShell
      header={
        <JobsHeader
          data={data}
          title={title}
          scope={scope}
          onScope={onScope}
          busy={paged.refreshing}
          triage={handOffs && failedJobs.length > 0 ? ask(triageJobsHandOff(data, engine)) : null}
        />
      }
    >
      {/* Described from what is on screen: in the cockpit the widget self-fetches,
          so only it knows the data. */}
      <HostModelContext content={context(describeJobPanel(data, engine, jobs.length))}>
        {null}
      </HostModelContext>

      {jobs.length === 0 ? (
        <TableEmptyState>{t("jobPanel.noJobs")}</TableEmptyState>
      ) : (
        <>
          {/* Jobs without retries come first: the feed sorts by retries. The
              rows are the inline head of the list (PagedRows, #396). */}
          <PagedRows paged={paged}>
            <ListTable
              ariaLabel={t("jobPanel.tableLabel")}
              columns={columns}
              copyHint={t("jobPanel.copyHint")}
            >
              {jobs.map((job) => (
                <Fragment key={job.id}>
                  <JobRow
                    job={job}
                    retry={retry}
                    engineId={engine}
                    showProcess={!data.filters.processDefinitionKey}
                    showRetries={!listsWithoutRetries}
                    handOffs={handOffs}
                    // Its instance shows the failure: the job has no view of its own.
                    onOpen={(row) =>
                      go({ type: "instance-detail", processInstanceId: row.processInstanceId })
                    }
                  />
                  <JobRetryError error={retry.error(job.id)} columns={columns.length} />
                </Fragment>
              ))}
            </ListTable>
          </PagedRows>
          <PagedListFooter
            paged={paged}
            noun={(total) => t("jobPanel.footerNoun", { count: total })}
            labels={paged.footerLabels}
          />
        </>
      )}
    </WidgetShell>
  )
}
