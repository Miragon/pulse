import {
  BadgeLegend,
  InstanceFilterBar,
  InstanceTable,
  LoadMore,
  type ScreenIdProps,
  type ScreenSlots,
} from "@miragon/pulse-blocks"
import { useMemo } from "react"
import type { DefinitionView, InstanceListFilter } from "../../core/protocol/index.js"
import { DiagramBadge } from "../components/count-badge.js"
import { IdText } from "../components/id-text.js"
import { useHost } from "../host/host-context.js"
import { useInstanceSelection } from "./instance-selection.js"
import { ListedInstances } from "./listed-instance.js"
import { useProcessSlots } from "./process-slots.js"
import { ScreenFrame } from "./screen-frame.js"
import { SelectionBar } from "./selection-bar.js"

function InstanceId({ id, label }: ScreenIdProps) {
  return <IdText id={id} shortId={id} label={label} />
}

function useInstanceSlots(): ScreenSlots {
  const slots = useProcessSlots()
  return { ...slots, Id: InstanceId }
}

export interface InstanceListProps {
  readonly view: DefinitionView
  readonly elementName: (elementId: string) => string
  readonly onFilter: (filter: InstanceListFilter) => void
  readonly refreshing: boolean
  readonly busy: boolean
}

export function InstanceList({ view, elementName, onFilter, refreshing, busy }: InstanceListProps) {
  const host = useHost()
  const slots = useInstanceSlots()
  const rows = useMemo(() => view.instances.map((row) => ListedInstances.of(row)), [view.instances])
  const select = useInstanceSelection(rows, view.selection?.count ?? 0)
  return (
    <section className={ScreenFrame.LIST_REGION} aria-label="Instance list">
      <InstanceFilterBar
        filter={view.filter}
        counts={view.scopeCounts}
        busy={refreshing}
        historyNote={view.historyNote}
        elementName={elementName}
        variables={{
          labels: view.variableLabels,
          names: view.variableNames,
          refused: view.refusedVariableConditions,
          onSuggest: () => {
            host.post({ type: "suggestVariableNames" })
          },
        }}
        legend={<BadgeLegend version={view.selectedVersion} Badge={DiagramBadge} />}
        onFilter={onFilter}
      />
      {view.selection !== undefined && <SelectionBar selection={view.selection} />}
      <InstanceTable
        engine={view.engine.name}
        rows={rows}
        filter={view.filter}
        onFilter={onFilter}
        footer={
          view.hasMoreInstances ? (
            <LoadMore
              busy={busy}
              onMore={() => {
                host.post({ type: "loadMoreInstances" })
              }}
            />
          ) : undefined
        }
        select={select}
        slots={slots}
      />
    </section>
  )
}
