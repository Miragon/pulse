import {
  Button,
  Icon,
  shortId,
  VersionChip,
  StatusBadge,
  WidgetHeader,
  SITUATION_TONES,
} from "@miragon/pulse-ui"
import {
  FreshnessStamp,
  HandOffButton,
  OpenInCockpitLink,
} from "@miragon/pulse-widget-shell/widgets"
import { CircleDot, CornerRightDown } from "lucide-react"

import type { IncidentDetailData, IncidentDetailRootCause } from "../../view-models.js"

import {
  scopingDefinitionKey,
  useHandOff,
  useHandOffsShown,
  type HandOff,
} from "../lib/hand-off.js"
import { InstanceLabel } from "../lib/identity.js"
import { instanceName } from "../lib/write-feedback.js"
import { useNav } from "../navigation.js"
import { useT } from "../../messages/use-t.js"
import { incidentTypeWords } from "../lib/incident-type.js"

/** The cockpit's instance feed is app-only, so context comes from model-visible tools; engine text is quoted. */
export function diagnoseIncidentHandOff(data: IncidentDetailData): HandOff {
  const key = scopingDefinitionKey(data.processDefinitionKey, data.processDefinitionId)
  return {
    intent: "askAi.incident.diagnose",
    ids: {
      engine: data.engineId,
      processInstanceId: data.processInstanceId,
      processDefinitionKey: key,
      processDefinitionId: key ? undefined : data.processDefinitionId || undefined,
      activityId: data.activityId,
      jobId: data.job?.id,
      rootCauseIncidentId: data.rootCause?.incidentId,
      calledProcessInstanceId: data.rootCause?.processInstanceId,
    },
    facts: {
      incidentId: data.incidentId,
      incidentType: data.incidentType,
      version: data.processDefinitionVersion,
      rootCauseActivityId: data.rootCause?.activityId || undefined,
    },
    untrusted: [
      { label: "incidentMessage", text: data.incidentMessage ?? data.job?.exceptionMessage },
      { label: "activityName", text: data.activityName },
      { label: "processName", text: data.processDefinitionName },
      { label: "businessKey", text: data.businessKey },
      { label: "rootCauseActivityName", text: data.rootCause?.activityName },
    ],
  }
}

/** Where a delegated incident's failure happened, in words: its element in its called process. */
function CauseFact({ cause }: { cause: IncidentDetailRootCause }) {
  const t = useT()
  return (
    <span>
      {t("incidentDetail.cause", {
        activity: cause.activityName ?? cause.activityId,
        process: cause.processName ?? shortId(cause.processInstanceId),
      })}
    </span>
  )
}

/** The ways on from an incident in Pulse: its instance, and a delegated incident's root cause. */
function useIncidentWays(data: IncidentDetailData) {
  const go = useNav()
  const cause = data.rootCause
  return {
    openInstance: data.processInstanceId
      ? () =>
          go({
            type: "instance-detail",
            processInstanceId: data.processInstanceId,
            label: instanceName(data.processInstanceId, data.businessKey),
          })
      : undefined,
    openCause: cause
      ? () =>
          go({
            type: "incident-detail",
            incidentId: cause.incidentId,
            label: cause.activityName ?? cause.activityId,
          })
      : undefined,
  }
}

type IncidentWays = ReturnType<typeof useIncidentWays>

/** What the bar knows about the incident: its process, its instance and a delegated one's cause. */
function IncidentBarFacts({ data }: { data: IncidentDetailData }) {
  return (
    <>
      <span className="inline-flex items-center gap-1.5">
        {data.processDefinitionName ?? data.processDefinitionKey}
        {data.processDefinitionVersion !== null && (
          <VersionChip version={data.processDefinitionVersion} />
        )}
      </span>
      <span aria-hidden="true">·</span>
      {/* One instance label: its business key, the UUID a copyable chip. */}
      <InstanceLabel id={data.processInstanceId} businessKey={data.businessKey} wrap />
      {data.rootCause && (
        <>
          <span aria-hidden="true">·</span>
          <CauseFact cause={data.rootCause} />
        </>
      )}
    </>
  )
}

/**
 * The bar's one group: the deterministic steps first (the instance, a delegated incident's root
 * cause), then the engine's web app, then the chat.
 */
function IncidentActions({
  data,
  openInstance,
  openCause,
}: { data: IncidentDetailData } & IncidentWays) {
  const t = useT()
  const { ask } = useHandOff()
  const cockpitInstanceUrl = data.cockpitInstanceUrl
  return (
    <>
      {openInstance && (
        <Button type="button" variant="toolbar" size="sm" onClick={openInstance}>
          <Icon icon={CircleDot} />
          {t("incidentDetail.openInstance")}
        </Button>
      )}
      {openCause && (
        <Button type="button" variant="toolbar" size="sm" onClick={openCause}>
          <Icon icon={CornerRightDown} />
          {t("incidentDetail.openCause")}
        </Button>
      )}
      {cockpitInstanceUrl && (
        <OpenInCockpitLink
          url={cockpitInstanceUrl}
          vendor={data.engineVendor}
          label={t("incidentDetail.openInstanceIn", { vendor: data.engineVendor })}
          variant="toolbar"
        />
      )}
      <HandOffButton
        action="findCause"
        variant="toolbar"
        prompt={ask(diagnoseIncidentHandOff(data))}
      />
    </>
  )
}

export function IncidentDetailHeader({
  data,
  resolved,
}: {
  data: IncidentDetailData
  resolved: boolean
}) {
  const t = useT()
  const ways = useIncidentWays(data)
  // Nothing to open, no link to the engine's web app and a hand-off the host hides: no group.
  const handOffs = useHandOffsShown()
  const hasActions =
    ways.openInstance !== undefined ||
    ways.openCause !== undefined ||
    Boolean(data.cockpitInstanceUrl) ||
    handOffs
  return (
    <WidgetHeader
      badge={
        <StatusBadge tone={resolved ? "neutral" : SITUATION_TONES.openIncident}>
          {resolved ? t("incidentDetail.resolved") : incidentTypeWords(data.incidentType, t)}
        </StatusBadge>
      }
      // The activity by its name; its BPMN id only where it has none (#322 U13).
      title={data.activityName ?? <span className="font-mono">{data.activityId}</span>}
      sub={<IncidentBarFacts data={data} />}
      actions={hasActions && <IncidentActions data={data} {...ways} />}
      // When the server read the incident, once at the bar's end, as on every route.
      freshness={<FreshnessStamp at={data.fetchedAt} />}
    />
  )
}
