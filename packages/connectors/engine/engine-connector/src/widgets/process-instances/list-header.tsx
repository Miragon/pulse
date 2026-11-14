import { formatNumber, StateLabel, WidgetHeader } from "@miragon/pulse-ui"
import { HandOffButton } from "@miragon/pulse-widget-shell/widgets"
import { useHandOff, type HandOff } from "../lib/hand-off.js"
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
      }
    : {
        intent: "askAi.instances.triageEngine",
        ids: { engine },
        facts,
        untrusted: operatorText,
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
  engine: string
  filters: InstancesListFilters
}) {
  const t = useT()
  const { ask } = useHandOff()
  return (
    <WidgetHeader
      title={title}
      sub={
        <>
          {/* A count in the header is a state label, never a tinted pill (invariant 6): the
              running state's icon carries the tone, the number stays in the foreground. */}
          <StateLabel state="running">
            {t("processInstances.runningCount", { count: formatNumber(total) })}
          </StateLabel>
          {scopedKey && (
            <>
              <span className="text-muted-foreground">·</span>
              <span className="font-mono">{scopedKey}</span>
              {/* A process's list spans every version of its key: the header names that scope. */}
              <span className="text-muted-foreground">·</span>
              <span>{t("processInstances.allVersions")}</span>
            </>
          )}
        </>
      }
      actions={
        <HandOffButton
          action="assess"
          variant="toolbar"
          prompt={ask(triageInstancesHandOff({ scopedKey, processName, total, engine, filters }))}
        />
      }
    />
  )
}
