import type { ComponentChildren } from "preact"
import { useCallback, useMemo, useState } from "preact/hooks"
import type {
  DefinitionView,
  InstanceListFilter,
  InstanceScope,
} from "../../core/protocol/index.js"
import { ContextBar } from "../components/context-bar.js"
import { OpenModelButton } from "../components/open-model-button.js"
import type { Freshness } from "../components/context-bar.js"
import { RuntimeDiagram } from "../components/runtime-diagram.js"
import { WebUiButton } from "../components/web-ui-button.js"
import type { Decorations } from "../diagram/decoration-layer.js"
import { ElementCodes } from "../diagram/element-codes.js"
import { useHost } from "../host/host-context.js"
import { BulkStrip } from "./bulk-strip.js"
import { InstanceList } from "./instance-list.js"
import { InstanceFilter } from "./instance-filter.js"
import { NoticeStrips } from "./notices.js"
import { SplitLayout } from "./split-layout.js"
import { VersionPicker } from "./version-picker.js"

export interface DefinitionScreenProps {
  readonly view: DefinitionView
  readonly freshness: Freshness
  readonly stale: boolean
  readonly refreshing: boolean
  readonly problem?: ComponentChildren
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
    const scoped = scope === undefined ? filter : InstanceFilter.withScope(filter, scope)
    filterInstances(InstanceFilter.withElement(scoped, elementId))
  }
  const onKeyDown = (event: KeyboardEvent): void => {
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
      filterInstances(InstanceFilter.withoutElement(filter))
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
    <div class="screen screen--with-strips" onKeyDown={onKeyDown}>
      <ContextBar
        subject="definition"
        title={view.processName}
        engine={view.engine}
        freshness={freshness}
      >
        <VersionPicker versions={view.versions} selected={view.selectedDefinitionId} />
        {view.model !== undefined && (
          <OpenModelButton
            model={view.model}
            elementId={view.filter.elementId}
            elementName={nameOf}
          />
        )}
        <WebUiButton link={view.webUi} />
      </ContextBar>
      <div class="strip-stack">
        {problem}
        {view.bulk !== undefined && <BulkStrip bulk={view.bulk} />}
        <NoticeStrips notices={view.notices} />
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
