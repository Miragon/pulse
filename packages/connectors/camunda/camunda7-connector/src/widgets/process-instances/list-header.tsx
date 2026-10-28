import { HandOffButton, formatNumber } from "@miragon/pulse-widget-shell/widgets"
import { LivePill, WidgetHeader } from "@miragon/mcp-toolkit-ui"
import { useHandOff, type HandOff } from "../lib/hand-off.js"
import { EngineMeta } from "../lib/engine-context.js"
import { useT } from "../../messages/use-t.js"
import { instancesFilterFacts, type InstancesListFilters } from "./hand-offs.js"

/** Process name, business-key filter and search are quoted. */
export function triageInstancesHandOff({
  scopedKey,
  processName,
  total,
  engine,
  filters,
}: {
  scopedKey: string | null
  processName: string | null
  total: number
  engine: string | undefined
  filters: InstancesListFilters
}): HandOff {
  const facts = { matchingInstances: total, ...instancesFilterFacts(filters) }
  const operatorText = [
    { label: "businessKeyLike", text: filters.businessKeyLike },
    { label: "search", text: filters.search },
  ]
  return scopedKey
    ? {
        intent: "askAi.instances.triageProcess",
        ids: { engine, processDefinitionKey: scopedKey },
        facts,
        untrusted: [{ label: "processName", text: processName }, ...operatorText],
        tools: [
          "camunda7_list_incidents",
          "camunda7_query_historic_incidents",
          "camunda7_query_historic_activity_instances",
        ],
      }
    : {
        intent: "askAi.instances.triageEngine",
        ids: { engine },
        facts,
        untrusted: operatorText,
        tools: ["camunda7_list_incidents", "camunda7_query_historic_incidents"],
      }
}

export function InstancesHeader({
  title,
  processName,
  scopedKey,
  total,
  engine,
  filters,
}: {
  title: string
  processName: string | null
  scopedKey: string | null
  total: number
  /** Undefined when the default routed it. */
  engine: string | undefined
  filters: InstancesListFilters
}) {
  const t = useT()
  const { ask } = useHandOff()
  return (
    <WidgetHeader
      title={title}
      sub={
        <>
          <EngineMeta engineId={engine} />
          <LivePill tone="info">
            {t("processInstances.runningCount", { count: formatNumber(total) })}
          </LivePill>
          {scopedKey && (
            <>
              <span className="text-muted-foreground">·</span>
              <span className="font-mono">{scopedKey}</span>
            </>
          )}
        </>
      }
      actions={
        <HandOffButton
          action="assess"
          prompt={ask(triageInstancesHandOff({ scopedKey, processName, total, engine, filters }))}
        />
      }
    />
  )
}
