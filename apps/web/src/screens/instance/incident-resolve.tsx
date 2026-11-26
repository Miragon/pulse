import { useEffect } from "react"
import { Icon, shortId, WidgetHeader } from "@miragon/pulse-ui"
import { useToolQuery, ViewDataState, WidgetShell } from "@miragon/pulse-widget-shell/widgets"
import { CircleX } from "lucide-react"
import { useT } from "../../messages/index.js"
import { screenUrlOf } from "../../router/routes.js"
import { INCIDENT_DETAIL_FEED, type IncidentDetailFeed } from "./instance-feed.js"

/**
 * The address of the incident `read` names, under the instance that holds its root: a copy at a
 * call activity leads to the root incident in the instance it called, a root incident to itself.
 */
export function incidentUrlOf(engine: string, incident: string, read: IncidentDetailFeed): string {
  const { rootCause } = read
  return rootCause === null
    ? screenUrlOf({ kind: "instance", engine, instance: read.processInstanceId, incident })
    : screenUrlOf({
        kind: "instance",
        engine,
        instance: rootCause.processInstanceId,
        incident: rootCause.incidentId,
      })
}

/**
 * Finds the instance of an incident the page knows by its id alone, through the cockpit's incident
 * feed (`engine_incident_detail_data`, Camunda 7's), and names the page's entry anew with the
 * incident's address under the instance that holds its root, so Back never comes here again. While
 * it reads the bar names the incident; a failed read says so with Try again unless no retry changes
 * it.
 */
export function IncidentResolve({
  engine,
  incident,
  navigate,
  ready,
}: {
  engine: string
  incident: string
  navigate: (url: string, entry?: "push" | "replace") => void
  ready: boolean
}) {
  const t = useT()
  const query = useToolQuery<IncidentDetailFeed>(
    ["web:incident-of", engine, incident],
    INCIDENT_DETAIL_FEED,
    { engine, incidentId: incident },
    { enabled: ready },
  )
  const { data, error } = query
  useEffect(() => {
    if (data !== undefined) navigate(incidentUrlOf(engine, incident, data), "replace")
  }, [data, engine, incident, navigate])
  const id = shortId(incident)
  return (
    <main data-slot="incident-resolve" className="flex min-w-0 flex-col">
      <WidgetShell
        header={
          <WidgetHeader
            title={t("incident.title", { incident: id })}
            icon={<Icon icon={CircleX} />}
          />
        }
      >
        <ViewDataState
          loading={error === null}
          error={error}
          onRetry={() => void query.refetch()}
          emptyText=""
          loadingText={t("incident.resolving", { incident: id })}
          errorTitle={t("incident.resolveFailed", { incident: id })}
          retryLabel={t("action.tryAgain")}
        />
      </WidgetShell>
    </main>
  )
}
