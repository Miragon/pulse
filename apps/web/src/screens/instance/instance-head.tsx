import type { InstanceSlots } from "@miragon/pulse-blocks"
import { HeadlineStrip, InstanceFacts } from "@miragon/pulse-blocks"
import type { CallerData, InstanceStateCode } from "@miragon/pulse-screens"
import {
  Button,
  CopyableId,
  ErrorState,
  Icon,
  shortId,
  StateLabel,
  StatusStrip,
  WidgetHeader,
  type StateLabelState,
} from "@miragon/pulse-ui"
import { FreshnessStamp, OpenInCockpitLink } from "@miragon/pulse-widget-shell/widgets"
import { CornerLeftUp, TriangleAlert, Workflow } from "lucide-react"
import { useT } from "../../messages/index.js"
import { PageLink, type Navigate } from "../../router/page-link.js"
import { screenUrlOf } from "../../router/routes.js"
import { RefreshButton } from "../screen-chrome.js"
import type { InstanceScreenFeed } from "./instance-feed.js"

const STATES: Readonly<Record<InstanceStateCode, StateLabelState>> = {
  running: "running",
  suspended: "suspended",
  completed: "completed",
  terminated: "cancelled",
}

/** A value the screen could not read, said as an em dash and, to a screen reader, in words. */
function Unread({ words }: { readonly words: string }) {
  return (
    <span title={words}>
      <span aria-hidden="true">—</span>
      <span className="sr-only">{words}</span>
    </span>
  )
}

/**
 * The strip under a called instance's bar: who called it (its business key, else its short id) and
 * as what (its process and version, an em dash where the caller's read failed), with the way to it.
 */
function CallerStrip({
  engine,
  caller,
  navigate,
}: {
  readonly engine: string
  readonly caller: CallerData
  readonly navigate: Navigate
}) {
  const t = useT()
  const { found } = caller
  const href = screenUrlOf({ kind: "instance", engine, instance: caller.instanceId })
  const process =
    found === null
      ? null
      : `${found.definition.name ?? found.definition.bpmnProcessId} v${String(found.definition.version)}`
  return (
    <div
      data-slot="caller-strip"
      className="border-border bg-card px-gutter text-dense min-h-toolbar flex flex-wrap items-center gap-x-2 gap-y-1 border-b py-1"
    >
      <Icon icon={CornerLeftUp} className="text-muted-foreground" />
      <span>
        {t("caller.calledBy", { caller: found?.businessKey ?? shortId(caller.instanceId) })}
      </span>
      <span className="text-muted-foreground">
        {process ?? <Unread words={t("caller.processUnread")} />}
      </span>
      <Button asChild variant="outline" size="xs" className="ms-auto">
        <PageLink href={href} navigate={navigate}>
          {t("caller.open")}
        </PageLink>
      </Button>
    </div>
  )
}

/**
 * The strip under the bar when the incident in focus is not open in this instance (resolved since,
 * say): what happened and what the instance shows now, in the warning's status surface as the kit's
 * strip draws it, and the way to the instance as a link of the page, so Ctrl or Cmd with a click
 * and a middle click open it in a new tab (the kit's strip takes buttons only).
 */
function IncidentMissingStrip({
  engine,
  instance,
  incident,
  navigate,
}: {
  readonly engine: string
  readonly instance: string
  readonly incident: string
  readonly navigate: Navigate
}) {
  const t = useT()
  return (
    <div
      data-slot="incident-missing"
      className="border-warning bg-warning-surface px-gutter text-dense min-h-toolbar flex flex-wrap items-center gap-x-2 gap-y-1 border-b py-1 in-[[data-cd-kontrast=hoch]]:border-b-2 forced-colors:border-[color:CanvasText]"
    >
      <Icon icon={TriangleAlert} className="text-warning forced-colors:forced-color-adjust-none" />
      <p role="status" aria-atomic="true" className="min-w-0 flex-1 [overflow-wrap:anywhere]">
        <span className="font-semibold">
          {t("incident.missing.title", { incident: shortId(incident) })}.
        </span>{" "}
        {t("incident.missing.detail")}
      </p>
      <Button asChild variant="outline" size="xs">
        <PageLink href={screenUrlOf({ kind: "instance", engine, instance })} navigate={navigate}>
          {t("incident.missing.show")}
        </PageLink>
      </Button>
    </div>
  )
}

/**
 * The instance's bar: its business key as the page's heading (else its short id, the whole id to
 * copy beside it), its state, its facts (the id to copy, the process and version it runs, the
 * engine, the caller, when it started or ended), the Refresh and the instance in the engine's web
 * app where known, and when it was read. The page's menu comes first through the frame's
 * `ViewBarSlots`.
 */
export function InstanceBar({
  engine,
  instance,
  data,
  refreshing,
  onRefresh,
  slots,
}: {
  readonly engine: string
  readonly instance: string
  readonly data: InstanceScreenFeed | undefined
  readonly refreshing: boolean
  readonly onRefresh: (() => void) | undefined
  readonly slots: InstanceSlots
}) {
  const t = useT()
  const head = data?.instance
  const webApp = data?.webApp
  const idLabel = t("screen.instance.id")
  return (
    <WidgetHeader
      title={head?.businessKey ?? shortId(head?.id ?? instance)}
      icon={<Icon icon={Workflow} />}
      badge={head && <StateLabel state={STATES[head.state]} />}
      sub={
        data && (
          <>
            {head?.businessKey === undefined && (
              <CopyableId
                id={data.instance.id}
                label={idLabel}
                onCopy={(id) => {
                  slots.onCopy({ text: id, label: idLabel })
                }}
              />
            )}
            <InstanceFacts
              engine={engine}
              instance={data.instance}
              caller={data.caller}
              slots={slots}
            />
            <span className="text-muted-foreground">{engine}</span>
          </>
        )
      }
      actions={
        onRefresh && (
          <>
            <RefreshButton refreshing={refreshing} onRefresh={onRefresh} />
            {webApp && (
              <OpenInCockpitLink url={webApp.url} vendor={webApp.vendor} variant="toolbar" />
            )}
          </>
        )
      }
      freshness={<FreshnessStamp at={data?.asOf} />}
    />
  )
}

/** The strips under the bar: the caller, where the instance stands, an incident not found, a cut. */
export function InstanceStrips({
  screen,
  focus,
  nameOf,
  navigate,
}: {
  readonly screen: InstanceScreenFeed
  readonly focus: string | undefined
  readonly nameOf: (elementId: string) => string
  readonly navigate: Navigate
}) {
  const t = useT()
  const { engine } = screen
  const missing =
    focus !== undefined && !screen.incidents.some(({ rootIncident }) => rootIncident.id === focus)
  return (
    <>
      {screen.caller !== null && (
        <CallerStrip engine={engine} caller={screen.caller} navigate={navigate} />
      )}
      {missing && (
        <IncidentMissingStrip
          engine={engine}
          instance={screen.instance.id}
          incident={focus}
          navigate={navigate}
        />
      )}
      {screen.headline !== null && (
        <HeadlineStrip headline={screen.headline} incidents={screen.incidents} nameOf={nameOf} />
      )}
      {screen.truncated && <StatusStrip tone="info" title={t("screen.instance.truncated")} />}
    </>
  )
}

/** An instance the engine does not know: said once, in the view's place, with the way to its processes. */
export function UnknownInstance({
  engine,
  instance,
  navigate,
}: {
  readonly engine: string
  readonly instance: string
  readonly navigate: Navigate
}) {
  const t = useT()
  const href = screenUrlOf({ kind: "engine", engine, filter: { scope: "all" } })
  return (
    <ErrorState
      title={t("screen.instance.unknown.title", { instance: shortId(instance), engine })}
      titleAs="h2"
      description={t("screen.instance.unknown.description")}
      actions={
        <Button asChild variant="outline">
          <PageLink href={href} navigate={navigate}>
            {t("screen.instance.unknown.processes", { engine })}
          </PageLink>
        </Button>
      }
    />
  )
}
