import { InstanceFilters, OlderVersionsNotice } from "@miragon/pulse-blocks"
import { useCallback, useMemo, useState, type KeyboardEvent, type ReactNode } from "react"
import type {
  DefinitionView,
  InstanceListFilter,
  InstanceScope,
} from "../../core/protocol/index.js"
import { ContextBar, type Freshness } from "../components/context-bar.js"
import { OpenModelButton } from "../components/open-model-button.js"
import { RuntimeDiagram } from "../components/runtime-diagram.js"
import { WebUiButton } from "../components/web-ui-button.js"
import type { Decorations } from "../diagram/decorations.js"
import { ElementCodes } from "../diagram/element-codes.js"
import { useHost } from "../host/host-context.js"
import { BulkStrip } from "./bulk-strip.js"
import { InstanceList } from "./instance-list.js"
import { NoticeStrips } from "./notices.js"
import { ScreenFrame } from "./screen-frame.js"
import { SplitLayout } from "./split-layout.js"
import { VersionPicker } from "./version-picker.js"

export interface DefinitionScreenProps {
  readonly view: DefinitionView
  readonly freshness: Freshness
  readonly stale: boolean
  readonly refreshing: boolean
  readonly problem?: ReactNode
}

function useElementNames() {
  const [names, setNames] = useState<ReadonlyMap<string, string>>(new Map())
  const nameOf = useCallback((elementId: string) => names.get(elementId) ?? elementId, [names])
  return { nameOf, setNames }
}

interface PendingFocus {
  readonly from: string | undefined
  readonly to: string | undefined
}

function useFilterActions(filter: InstanceListFilter, selecting: boolean) {
  const host = useHost()
  const [pending, setPending] = useState<PendingFocus | undefined>(undefined)
  const focusElementId =
    pending !== undefined && pending.from === filter.elementId ? pending.to : filter.elementId
  const filterInstances = (next: InstanceListFilter): void => {
    setPending({ from: filter.elementId, to: next.elementId })
    host.post({ type: "filterInstances", filter: next })
  }
  const selectElement = (elementId: string, scope?: InstanceScope): void => {
    filterInstances(InstanceFilters.withElement(filter, elementId, scope))
  }
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const inField =
      (event.target instanceof HTMLInputElement && event.target.type !== "checkbox") ||
      event.target instanceof HTMLSelectElement
    const layerOpen = document.querySelector(":popover-open, dialog[open]") !== null
    if (event.key !== "Escape" || inField || layerOpen) {
      return
    }
    if (selecting) {
      host.post({ type: "clearSelection" })
    } else if (filter.elementId !== undefined) {
      filterInstances(InstanceFilters.withoutElement(filter))
    }
  }
  return { filterInstances, selectElement, onKeyDown, focusElementId }
}

function useDecorations(
  view: DefinitionView,
  stale: boolean,
  focusElementId: string | undefined,
): Decorations {
  const codes = useMemo(() => ElementCodes.of(view.model), [view.model])
  return useMemo<Decorations>(
    () => ({
      badges: view.badges,
      markers: [],
      calls: view.calls,
      stale,
      focusElementId,
      codes,
    }),
    [view.badges, view.calls, stale, focusElementId, codes],
  )
}

function BarActions({
  view,
  nameOf,
}: {
  readonly view: DefinitionView
  readonly nameOf: (elementId: string) => string
}) {
  return (
    <>
      <VersionPicker versions={view.versions} selected={view.selectedDefinitionId} />
      {view.model !== undefined && (
        <OpenModelButton
          model={view.model}
          elementId={view.filter.elementId}
          elementName={nameOf}
        />
      )}
      <WebUiButton link={view.webUi} />
    </>
  )
}

function OlderVersions({ view }: { readonly view: DefinitionView }) {
  const host = useHost()
  const older = view.olderVersions
  if (older === undefined) {
    return null
  }
  return (
    <OlderVersionsNotice
      notice={{
        running: older.running,
        withIncident: older.withIncident,
        show: { id: older.show.definitionId, version: older.show.version },
      }}
      onShow={(show) => {
        host.post({ type: "selectVersion", definitionId: show.id })
      }}
    />
  )
}

export function DefinitionScreen({
  view,
  freshness,
  stale,
  refreshing,
  problem,
}: DefinitionScreenProps) {
  const { nameOf, setNames } = useElementNames()
  const { filterInstances, selectElement, onKeyDown, focusElementId } = useFilterActions(
    view.filter,
    view.selection !== undefined,
  )
  const decorations = useDecorations(view, stale, focusElementId)
  return (
    <div className={ScreenFrame.WITH_STRIPS} onKeyDown={onKeyDown}>
      <ContextBar
        subject="definition"
        title={view.processName}
        engine={view.engine}
        freshness={freshness}
        actions={<BarActions view={view} nameOf={nameOf} />}
      />
      <div className={ScreenFrame.STRIPS} data-part="strips">
        {problem}
        {view.bulk !== undefined && <BulkStrip bulk={view.bulk} />}
        <NoticeStrips notices={view.notices} />
        <OlderVersions view={view} />
      </div>
      <SplitLayout
        top={
          <RuntimeDiagram
            xml={view.diagramXml}
            decorations={decorations}
            onSelectElement={selectElement}
            onNames={setNames}
          />
        }
        bottom={
          <InstanceList
            view={view}
            elementName={nameOf}
            onFilter={filterInstances}
            refreshing={refreshing}
            busy={refreshing || stale}
          />
        }
      />
    </div>
  )
}
