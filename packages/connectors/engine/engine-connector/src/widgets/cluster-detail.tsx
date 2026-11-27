import { useState } from "react"
import {
  FreshnessStamp,
  Button,
  Icon,
  LogText,
  NamedId,
  SectionHeading,
  TableEmptyState,
  Td,
  formatClock,
  formatCount,
  formatInstant,
  formatNumber,
  formatRelativeTime,
  FilterBar,
  KpiGrid,
  StatusBadge,
  WidgetHeader,
  PagedListFooter,
  SITUATION_TONES,
} from "@miragon/pulse-ui"
import {
  HandOffButton,
  ListRow,
  ListTable,
  PagedRows,
  ViewDataState,
  WidgetShell,
  usePagedListView,
  HostModelContext,
} from "@miragon/pulse-widget-shell/widgets"
import { Workflow } from "lucide-react"
import { LIST_PAGE_SIZE, type ClusterDetailData, type ClusterIncidentRow } from "../view-models.js"
import { DetailPage } from "./detail-page.js"
import { useNav } from "./navigation.js"
import { ENGINE_CLUSTER_DETAIL_DATA } from "../tool-names.js"
import {
  clusterCountFacts,
  clusterKeyParts,
  clusterScanComplete,
  remediationHandOff,
} from "./remediation.js"
import { AlarmCount } from "./lib/alarm-count.js"
import { useActionAllowed } from "./lib/engine-action.js"
import { useHandOff, useHandOffsShown, type ViewContext } from "./lib/hand-off.js"
import { InstanceLabel } from "./lib/identity.js"
import { instanceName } from "./lib/write-feedback.js"
import { useT } from "../messages/use-t.js"
import { incidentTypeWords } from "./lib/incident-type.js"

/** Grounding context; the sample message is engine text, quoted, never inlined. */
export function describeCluster(data: ClusterDetailData): ViewContext {
  // The scanned incidents' keys ("(unknown)" dropped) scope only while the
  // scan held the whole cluster.
  const keys = clusterKeyParts(data, data.processDefinitionKeys)
  return {
    summary:
      "The operator is inspecting ONE failure cluster: its root incidents, each by its instance. Propose remediation only scoped to this cluster.",
    ids: {
      engine: data.engineId,
      activityId: data.activityId,
      incidentType: data.incidentType,
      processDefinitionKey: keys.processDefinitionKey,
      processDefinitionKeyIn: keys.processDefinitionKeyIn,
    },
    // Counts a capped scan cannot vouch for are a lower bound or left out,
    // never a 0 (#335); the list then covers only the newest scanned ones.
    facts: {
      ...clusterCountFacts(data),
      scannedProcessDefinitionKeys: keys.scannedProcessDefinitionKeys,
      lastHour: data.lastHourCount,
      firstSeen: data.firstSeen,
      latestIncident: data.latestIncident,
      listCoversNewest: listCapped(data) ? data.scannedIncidentCount : undefined,
    },
    untrusted: [{ label: "sampleMessage", text: data.representativeMessage }],
  }
}

/** The route's cluster identity and engine: loadMore() pages that cluster, never the default engine. */
interface ClusterRoute {
  engine: string
  activityId: string
  incidentType: string
  messageSignature?: string
}

function clusterFeedArgs({ engine, activityId, incidentType, messageSignature }: ClusterRoute) {
  const args: Record<string, unknown> = { engine, activityId, incidentType }
  if (messageSignature) args.messageSignature = messageSignature
  return args
}

/** The process a row names by its name (#322 U13), else null. */
function processNameOf(data: ClusterDetailData, key: string): string | null {
  return (
    data.incidents.find((row) => row.processDefinitionKey === key && row.processDefinitionName)
      ?.processDefinitionName ?? null
  )
}

/** By name where a row carries one (#322 U13), else by key. */
function clusterProcesses(data: ClusterDetailData, unknown: string): string {
  return (
    data.processDefinitionKeys.map((key) => processNameOf(data, key) ?? key).join(", ") || unknown
  )
}

/** When the cluster began, relative to now, the whole instant in its title. */
function FirstSeen({ at }: { at: string }) {
  const t = useT()
  return (
    <span title={formatInstant(at)}>
      {t("clusterDetail.firstSeen", { time: formatRelativeTime(at) })}
    </span>
  )
}

function ClusterHeader({ data, engineId }: { data: ClusterDetailData; engineId: string }) {
  const t = useT()
  const go = useNav()
  const { ask } = useHandOff()
  // A hand-off the host hides and no process to open: the bar has no action group.
  const handOffs = useHandOffsShown()
  // The one process the cluster lies in, its key in its versions' tenant; none for several.
  const { process } = data
  const canFix = useActionAllowed("engine_set_job_retries", engineId)
  const handOff = remediationHandOff(
    {
      activityId: data.activityId,
      incidentType: data.incidentType,
      incidentCount: data.incidentCount,
      scannedIncidentCount: data.scannedIncidentCount,
      processDefinitionKeys: data.processDefinitionKeys,
      representativeMessage: data.representativeMessage,
    },
    engineId,
    canFix,
  )
  return (
    <WidgetHeader
      badge={
        <StatusBadge tone={SITUATION_TONES.openIncident}>
          {incidentTypeWords(data.incidentType, t)}
        </StatusBadge>
      }
      // The activity by its name; its BPMN id only where it has none (#322 U13).
      title={data.activityName ?? <span className="font-mono">{data.activityId}</span>}
      // The facts the KPIs do not hold: where, and since when (a point in time is a fact of the
      // line, not a KPI tile it would not fit in, #322 U12); the affected count is the first KPI.
      sub={
        <>
          <span>
            {t("clusterDetail.affectedAcross", {
              keys: clusterProcesses(data, t("clusterDetail.unknownKeys")),
            })}
          </span>
          {data.firstSeen && (
            <>
              <span aria-hidden="true">·</span>
              <FirstSeen at={data.firstSeen} />
            </>
          )}
        </>
      }
      freshness={<FreshnessStamp at={data.fetchedAt} />}
      actions={
        (process !== null || handOffs) && (
          <>
            {process !== null && (
              <Button
                type="button"
                variant="toolbar"
                size="sm"
                onClick={() =>
                  go({
                    type: "process-detail",
                    ...process,
                    label: processNameOf(data, process.processDefinitionKey) ?? undefined,
                  })
                }
              >
                <Icon icon={Workflow} />
                {t("clusterDetail.viewProcess")}
              </Button>
            )}
            <HandOffButton
              action={canFix ? "planFix" : "explainError"}
              variant="toolbar"
              prompt={ask(handOff)}
            />
          </>
        )
      }
    />
  )
}

/**
 * A count a capped scan cannot vouch for renders as a lower bound ("≥ 2,000") or "—". The
 * affected count alarms while there are any, as every open incident count does: a cluster whose
 * incidents are all gone shows a plain 0.
 */
function ClusterKpis({ data }: { data: ClusterDetailData }) {
  const t = useT()
  const affected = data.incidentCount ?? data.scannedIncidentCount
  return (
    <KpiGrid
      boxed
      cells={[
        {
          label: t("clusterDetail.kpiAffected"),
          value: (
            <AlarmCount alarm={affected > 0 && "openIncidents"}>
              {formatCount(data.incidentCount ?? { atLeast: data.scannedIncidentCount })}
            </AlarmCount>
          ),
        },
        // How fast it grows is a count, not a second state (#322 U14).
        { label: t("clusterDetail.kpiNewLastHour"), value: formatCount(data.lastHourCount) },
      ]}
    />
  )
}

/** When the cluster outruns the scan, the footer says its total is the scan's share, not the cluster's size. */
function listCapped(data: ClusterDetailData): boolean {
  return !clusterScanComplete(data)
}

/** Only a cluster spanning several processes needs the process column. */
function spansProcesses(data: ClusterDetailData): boolean {
  return data.processDefinitionKeys.length > 1
}

/**
 * One incident of the cause (#322 U2, U13), named by its instance: the row opens the incident on a
 * click or Enter and copies its id on Ctrl or Cmd with C (one row convention); its instance is a
 * step on from the incident. A row the engine reported without an incident id opens nothing.
 */
function IncidentRow({
  row,
  activityName,
  showProcess,
}: {
  row: ClusterIncidentRow
  activityName: string | null
  showProcess: boolean
}) {
  const go = useNav()
  const t = useT()
  const label = instanceName(row.processInstanceId, row.businessKey)
  return (
    <ListRow
      label={t("clusterDetail.rowLabel", { ref: label })}
      onOpen={
        row.incidentId
          ? () =>
              go({
                type: "incident-detail",
                incidentId: row.incidentId,
                label: activityName ?? undefined,
              })
          : undefined
      }
      copy={row.incidentId || undefined}
    >
      <Td>
        <InstanceLabel id={row.processInstanceId} businessKey={row.businessKey} />
      </Td>
      {showProcess && (
        <Td>
          <NamedId name={row.processDefinitionName} id={row.processDefinitionKey} />
        </Td>
      )}
      <Td align="right" className="text-muted-foreground text-small whitespace-nowrap tabular-nums">
        {/* The clock without seconds, its day on another day, the whole instant in its title. */}
        <span title={formatInstant(row.incidentTimestamp)}>
          {formatClock(row.incidentTimestamp, { seconds: false })}
        </span>
      </Td>
    </ListRow>
  )
}

/**
 * Whether the rows carry business keys, read from an unsearched page and kept while a search
 * narrows it, so the search box keeps saying what it finds: a business key or an id, or an id
 * alone where no row has a key (a called instance has none).
 */
function useKeyedRows(rows: readonly ClusterIncidentRow[], searching: boolean): boolean {
  const keyed = rows.some((row) => !!row.businessKey)
  const [kept, setKept] = useState(keyed)
  if (!searching && kept !== keyed) setKept(keyed)
  return searching ? kept : keyed
}

/** Drill-in for ONE failure cluster, between the engine overview's cluster list and the single-incident detail. */
function ClusterDetailView({
  data: initialData = null,
  title,
  ...route
}: ClusterRoute & { data?: ClusterDetailData | null; title?: string }) {
  const t = useT()
  const { engine, activityId, incidentType, messageSignature } = route
  // SERVER-side, so the search covers the whole cluster, not just the loaded page.
  const { paged, search, setSearch, interacted } = usePagedListView<
    ClusterIncidentRow,
    ClusterDetailData
  >({
    initialData,
    key: ["engine:cluster-detail", engine, activityId, incidentType, messageSignature ?? null],
    tool: ENGINE_CLUSTER_DETAIL_DATA,
    args: clusterFeedArgs(route),
    searchArg: "businessKeyLike",
    pageSize: LIST_PAGE_SIZE,
    ready: true,
    selectItems: (d) => d.incidents,
    selectTotal: (d) => d.totalMatching,
  })
  const data = paged.firstPage
  const keyed = useKeyedRows(paged.items, search.trim() !== "")

  if (!data) {
    // Loading or failed, the route keeps its title, the page's one heading.
    return (
      <WidgetShell header={title && <WidgetHeader title={title} />}>
        <ViewDataState
          loading={paged.loading}
          error={paged.error}
          onRetry={paged.retry}
          loadingText={t("clusterDetail.loading")}
          emptyText={t("clusterDetail.noData")}
        />
      </WidgetShell>
    )
  }

  return (
    <DetailPage
      header={<ClusterHeader data={data} engineId={engine} />}
      summary={<ClusterKpis data={data} />}
      /* A single content block, no tabs: the failure message stays beside its instances. */
      content={
        <>
          {data.representativeMessage && (
            <div>
              <SectionHeading as="h2" title={t("clusterDetail.failureMessage")} className="mb-1" />
              <LogText kind="message" text={data.representativeMessage} />
            </div>
          )}

          {/* No name of its own: the table's region is the one landmark named after the incidents. */}
          <section className="flex flex-col gap-2">
            <SectionHeading as="h2" title={t("clusterDetail.affectedInstances")} className="mb-0" />
            <FilterBar
              search={search}
              onSearchChange={setSearch}
              searchPlaceholder={
                keyed
                  ? t("clusterDetail.searchPlaceholder")
                  : t("clusterDetail.searchPlaceholderId")
              }
              searchAriaLabel={
                keyed ? t("clusterDetail.searchLabel") : t("clusterDetail.searchLabelId")
              }
              chips={[]}
              onChipToggle={() => undefined}
              // A bar inside the content reaches the card's edges, as a view's tab bar does.
              className="-mx-gutter"
            />
            <PagedRows paged={paged}>
              {paged.items.length === 0 ? (
                <TableEmptyState>
                  {interacted ? t("clusterDetail.noMatch") : t("clusterDetail.noMatchingIncidents")}
                </TableEmptyState>
              ) : (
                <ListTable
                  ariaLabel={t("clusterDetail.affectedInstances")}
                  columns={[
                    // The instance whole while there is room; the process gives way first.
                    { label: t("clusterDetail.colInstance"), fit: true },
                    ...(spansProcesses(data)
                      ? [{ label: t("clusterDetail.colProcess"), hideBelow: "sm" as const }]
                      : []),
                    // The time gives way first in a narrow card, as in the incident tables.
                    { label: t("clusterDetail.colOccurred"), align: "right", hideBelow: "md" },
                  ]}
                >
                  {paged.items.map((row) => (
                    <IncidentRow
                      // The engine can report rows without an incident id: fall back to
                      // instance+timestamp so React keys stay unique per incident row.
                      key={row.incidentId || `${row.processInstanceId}-${row.incidentTimestamp}`}
                      row={row}
                      activityName={data.activityName}
                      showProcess={spansProcesses(data)}
                    />
                  ))}
                </ListTable>
              )}
            </PagedRows>
            <PagedListFooter
              paged={paged}
              noun={(total) => t("clusterDetail.footerNoun", { count: total })}
              labels={paged.footerLabels}
            />
            {listCapped(data) && (
              <p className="text-muted-foreground text-small">
                {t("clusterDetail.listCapped", { count: formatNumber(data.scannedIncidentCount) })}
              </p>
            )}
          </section>
        </>
      }
    >
      <ClusterModelContext data={data} />
    </DetailPage>
  )
}

function ClusterModelContext({ data }: { data: ClusterDetailData }) {
  const { context } = useHandOff()
  return <HostModelContext content={context(describeCluster(data))}>{null}</HostModelContext>
}

export function ClusterDetailWidget(
  props: ClusterRoute & { data: ClusterDetailData | null; title?: string },
) {
  return <ClusterDetailView {...props} />
}
