import type { InstanceSlots } from "@miragon/pulse-blocks"
import { useT } from "../../messages/index.js"
import type { Navigate } from "../../router/page-link.js"
import type { InstanceTab } from "../../router/routes.js"
import { InstanceDetails } from "./instance-details.js"
import { InstanceDiagram } from "./instance-diagram.js"
import type { InstanceScreenFeed } from "./instance-feed.js"
import { SplitPane } from "../split-pane.js"

/** Where this browser keeps the share an instance's diagram takes of the split. */
const INSTANCE_SHARE_KEY = "pulse.web.instance.diagramShare"

/** The element the focus puts on the diagram: the incident's own, or the call activity it lies under. */
function focusElementOf(screen: InstanceScreenFeed, focus: string | undefined): string | undefined {
  const card = screen.incidents.find(({ rootIncident }) => rootIncident.id === focus)
  if (card === undefined) return undefined
  if (card.liesIn === null) return card.elementId
  const called = card.liesIn.instanceId
  return screen.calls.find(
    (call) => call.kind === "instances" && call.instances.some(({ id }) => id === called),
  )?.elementId
}

/** The version's diagram and its state: drawn, being read, or none to draw (with why). */
function DiagramRegion({
  screen,
  xml,
  failed,
  focus,
  nameOf,
  fill,
  navigate,
  slots,
}: {
  readonly screen: InstanceScreenFeed
  readonly xml: string | null | undefined
  readonly failed: boolean
  readonly focus: string | undefined
  readonly nameOf: (elementId: string) => string
  readonly fill: boolean
  readonly navigate: Navigate
  readonly slots: InstanceSlots
}) {
  const t = useT()
  const { definition } = screen.instance
  const process = `${definition.name ?? definition.bpmnProcessId} v${String(definition.version)}`
  if (typeof xml !== "string" || xml === "") {
    const words = failed
      ? t("diagram.readFailed")
      : xml === null
        ? t("diagram.none")
        : t("diagram.loading")
    return (
      <p
        className="text-muted-foreground grid h-full min-h-40 place-items-center p-4"
        role={xml === undefined && !failed ? "status" : undefined}
      >
        {words}
      </p>
    )
  }
  return (
    <InstanceDiagram
      engine={screen.engine}
      xml={xml}
      markers={screen.markers}
      calls={screen.calls}
      {...(focus === undefined ? {} : { focus })}
      label={t("diagram.label", { process })}
      nameOf={nameOf}
      fill={fill}
      navigate={navigate}
      slots={slots}
    />
  )
}

/** The diagram and the details: split from 64rem on, stacked under it. */
export function InstanceBody({
  screen,
  xml,
  diagramFailed,
  tab,
  onTab,
  focus,
  nameOf,
  wide,
  navigate,
  slots,
}: {
  readonly screen: InstanceScreenFeed
  readonly xml: string | null | undefined
  readonly diagramFailed: boolean
  readonly tab: InstanceTab
  readonly onTab: (tab: InstanceTab) => void
  readonly focus: string | undefined
  readonly nameOf: (elementId: string) => string
  readonly wide: boolean
  readonly navigate: Navigate
  readonly slots: InstanceSlots
}) {
  const t = useT()
  const diagram = (
    <DiagramRegion
      screen={screen}
      xml={xml}
      failed={diagramFailed}
      focus={focusElementOf(screen, focus)}
      nameOf={nameOf}
      fill={wide}
      navigate={navigate}
      slots={slots}
    />
  )
  const details = (
    <InstanceDetails
      screen={screen}
      tab={tab}
      onTab={onTab}
      {...(focus === undefined ? {} : { focus })}
      nameOf={nameOf}
      navigate={navigate}
      slots={slots}
    />
  )
  if (wide) {
    return (
      <SplitPane
        top={diagram}
        bottom={details}
        label={t("screen.instance.split")}
        storageKey={INSTANCE_SHARE_KEY}
      />
    )
  }
  return (
    <div className="flex flex-col">
      {diagram}
      <div className="border-border border-t">{details}</div>
    </div>
  )
}
