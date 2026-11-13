import {
  LogText,
  NamedId,
  SectionHeading,
  TableEmptyState,
  Td,
  formatCount,
  formatNumber,
  formatTimestamp,
  FilterBar,
  KpiGrid,
  StatusBadge,
  WidgetHeader,
  PagedListFooter,
  DrillButton,
  SITUATION_TONES,
} from "@miragon/pulse-ui"
import {
  HandOffButton,
  ListTable,
  PagedRows,
  ViewDataState,
  WidgetShell,
  usePagedListView,
  HostModelContext,
  ViewMeta,
} from "@miragon/pulse-widget-shell/widgets"
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
import { useHandOff, type ViewContext } from "./lib/hand-off.js"
import { InstanceLabel, SUBJECT_CELL, SUBJECT_COLUMN } from "./lib/identity.js"
import { instanceName } from "./lib/write-feedback.js"
import { useT } from "../messages/use-t.js"

/** Grounding context; the sample message is engine text, quoted, never inlined. */
export function describeCluster(data: ClusterDetailData): ViewContext {
  // The scanned incidents' keys ("(unknown)" dropped) scope only while the
  // scan held the whole cluster.
  const keys = clusterKeyParts(data, data.processDefinitionKeys)
  return {
    summary:
      "The operator is inspecting ONE failure cluster and its affected instances (with their business keys). Propose remediation only scoped to this cluster.",
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
      last24h: data.last24hCount,
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

/** By name where a row carries one (#322 U13), else by key. */
function clusterProcesses(data: ClusterDetailData, unknown: string): string {
  const names = new Map<string, string>()
  for (const row of data.incidents) {
    if (row.processDefinitionName) names.set(row.processDefinitionKey, row.processDefinitionName)
  }
  return data.processDefinitionKeys.map((key) => names.get(key) ?? key).join(", ") || unknown
}

function ClusterHeader({ data, engineId }: { data: ClusterDetailData; engineId: string }) {
  const t = useT()
  const { ask } = useHandOff()
  const canFix = useActionAllowed("engine_set_job_retries", engineId)
  const handOff = remediationHandOff(
    {
      activityId: data.activityId,
      incidentType: data.incidentType,
      incidentCount: data.incidentCount,
      scannedIncidentCount: data.scannedIncidentCount,
      last24hCount: data.last24hCount,
      processDefinitionKeys: data.processDefinitionKeys,
      representativeMessage: data.representativeMessage,
    },
    engineId,
    canFix,
  )
  return (
    <WidgetHeader
      badge={<StatusBadge tone={SITUATION_TONES.openIncident}>{data.incidentType}</StatusBadge>}
      // The activity by its name; its BPMN id only where it has none (#322 U13).
      title={data.activityName ?? <span className="font-mono">{data.activityId}</span>}
      sub={
        <>
          <ViewMeta asOf={data.fetchedAt} />
          <span>
            {t("clusterDetail.affectedAcross", {
              count: formatCount(data.incidentCount ?? { atLeast: data.scannedIncidentCount }),
              keys: clusterProcesses(data, t("clusterDetail.unknownKeys")),
            })}
            {/* A point in time is a fact of the line, not a KPI tile it
                would not fit in (#322 U12). */}
            {data.firstSeen &&
              ` · ${t("clusterDetail.firstSeen", { time: formatTimestamp(data.firstSeen) })}`}
          </span>
        </>
      }
      actions={
        <HandOffButton
          action={canFix ? "planFix" : "explainError"}
          variant="toolbar"
          prompt={ask(handOff)}
        />
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
        { label: t("clusterDetail.kpiNew24h"), value: formatCount(data.last24hCount) },
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

/** One affected instance (#322 U2, U13). */
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
    <tr>
      <Td className={SUBJECT_CELL}>
        <InstanceLabel id={row.processInstanceId} businessKey={row.businessKey} />
      </Td>
      {showProcess && (
        <Td>
          <NamedId name={row.processDefinitionName} id={row.processDefinitionKey} />
        </Td>
      )}
      <Td align="right" className="text-muted-foreground text-small whitespace-nowrap">
        {formatTimestamp(row.incidentTimestamp)}
      </Td>
      <Td align="right">
        <div className="inline-flex items-center justify-end gap-1">
          <DrillButton
            size="xs"
            onDrill={() =>
              go({ type: "instance-detail", processInstanceId: row.processInstanceId, label })
            }
            ariaLabel={t("clusterDetail.openInstanceAria", { ref: label })}
          >
            {t("clusterDetail.instance")}
          </DrillButton>
          {row.incidentId && (
            <DrillButton
              size="xs"
              onDrill={() =>
                go({
                  type: "incident-detail",
                  incidentId: row.incidentId,
                  label: activityName ?? undefined,
                })
              }
              ariaLabel={t("clusterDetail.openIncidentAria", { ref: label })}
            >
              {t("clusterDetail.incident")}
            </DrillButton>
          )}
        </div>
      </Td>
    </tr>
  )
}

/** Drill-in for ONE failure cluster, between the engine overview's cluster list and the single-incident detail. */
function ClusterDetailView({
  data: initialData = null,
  ...route
}: ClusterRoute & { data?: ClusterDetailData | null }) {
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

  if (!data) {
    return (
      <WidgetShell>
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
              <LogText text={data.representativeMessage} />
            </div>
          )}

          <section
            aria-label={t("clusterDetail.affectedInstances")}
            className="flex flex-col gap-2"
          >
            <SectionHeading as="h2" title={t("clusterDetail.affectedInstances")} className="mb-0" />
            <FilterBar
              search={search}
              onSearchChange={setSearch}
              searchPlaceholder={t("clusterDetail.searchPlaceholder")}
              searchAriaLabel={t("clusterDetail.searchLabel")}
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
                    { label: t("clusterDetail.colInstance"), className: SUBJECT_COLUMN },
                    ...(spansProcesses(data)
                      ? [{ label: t("clusterDetail.colProcess"), hideBelow: "sm" as const }]
                      : []),
                    // In a 760 px card the time gives way, as in the incident tables, so the
                    // table fits without scrolling under its pinned actions.
                    { label: t("clusterDetail.colOccurred"), align: "right", hideBelow: "md" },
                    { plain: true, sticky: true },
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

export function ClusterDetailWidget(props: ClusterRoute & { data: ClusterDetailData | null }) {
  return <ClusterDetailView {...props} />
}
