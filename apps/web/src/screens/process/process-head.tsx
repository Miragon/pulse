import { MissingHistoryNotice, OlderVersionsNotice, VersionPicker } from "@miragon/pulse-blocks"
import type { InstanceListFilterData, ScopeCountsData } from "@miragon/pulse-screens"
import { Button, ErrorState, Icon, StatusStrip, WidgetHeader } from "@miragon/pulse-ui"
import { FreshnessStamp, OpenInCockpitLink } from "@miragon/pulse-widget-shell/widgets"
import { Workflow } from "lucide-react"
import { useT } from "../../messages/index.js"
import { PageLink, type Navigate } from "../../router/page-link.js"
import { screenUrlOf } from "../../router/routes.js"
import { RefreshButton } from "../screen-chrome.js"
import type { ProcessScreenFeed } from "./process-feed.js"

/** The process's name as the engine gives it, else its BPMN process ID. */
export function processNameOf(screen: ProcessScreenFeed | undefined, process: string): string {
  return screen?.selected?.name ?? process
}

/**
 * The process's bar: its name as the page's heading and the engine it runs on as its fact, then its
 * actions as the webview orders them, the version picker with each version's running instances and
 * those with incident first, the Refresh and the version in the engine's web app where known, and
 * when it was read. The page's menu comes first through the frame's `ViewBarSlots`.
 */
export function ProcessBar({
  engine,
  process,
  data,
  refreshing,
  onRefresh,
  onVersion,
}: {
  readonly engine: string
  readonly process: string
  readonly data: ProcessScreenFeed | undefined
  readonly refreshing: boolean
  /** Reads the screen again; none before the screen reads. */
  readonly onRefresh: (() => void) | undefined
  /** A pick of a version, by its number: a new entry of the page's history. */
  readonly onVersion: (version: number) => void
}) {
  const webApp = data?.webApp
  const picker = data && (
    <VersionPicker
      versions={data.versions}
      selected={data.selected?.id}
      onPick={(definitionId) => {
        for (const { definition } of data.versions) {
          if (definition.id === definitionId) onVersion(definition.version)
        }
      }}
    />
  )
  return (
    <WidgetHeader
      title={processNameOf(data, process)}
      icon={<Icon icon={Workflow} />}
      sub={<span className="text-muted-foreground">{engine}</span>}
      actions={
        (picker || onRefresh) && (
          <>
            {picker}
            {onRefresh && <RefreshButton refreshing={refreshing} onRefresh={onRefresh} />}
            {onRefresh && webApp && (
              <OpenInCockpitLink url={webApp.url} vendor={webApp.vendor} variant="toolbar" />
            )}
          </>
        )
      }
      freshness={<FreshnessStamp at={data?.asOf} />}
    />
  )
}

/**
 * The strips under the bar: a version the address names that the engine lacks (the latest shown),
 * the notice that older versions still run with the way to the newest of them, a history that
 * misses running instances (the hint of the owner's decision of 2026-11-19, no fallback), and what
 * the screen could not read beside its versions (the diagram's counts, the processes it calls).
 */
export function ProcessStrips({
  screen,
  version,
  filter,
  counts,
  onVersion,
}: {
  readonly screen: ProcessScreenFeed
  /** The version's number the address names, none for the latest. */
  readonly version: number | undefined
  readonly filter: InstanceListFilterData
  /** The instance list's counts, once its first page answered. */
  readonly counts: ScopeCountsData | null | undefined
  readonly onVersion: (version: number) => void
}) {
  const t = useT()
  const { selected, notices, unread } = screen
  const shown = screen.versions.find(({ definition }) => definition.id === selected?.id)
  const [older] = notices
  return (
    <>
      {version !== undefined && selected !== null && selected.version !== version && (
        <StatusStrip
          tone="info"
          title={t("screen.process.versionMissing", { version })}
          detail={t("screen.process.versionShown", { shown: selected.version })}
        />
      )}
      {older !== undefined && (
        <OlderVersionsNotice
          notice={older}
          onShow={(show) => {
            onVersion(show.version)
          }}
        />
      )}
      {shown !== undefined && counts !== undefined && (
        <MissingHistoryNotice version={shown} filter={filter} counts={counts} />
      )}
      {unread.includes("statistics") && (
        <StatusStrip tone="warning" title={t("screen.process.statisticsUnread")} />
      )}
      {unread.includes("calledProcesses") && (
        <StatusStrip tone="warning" title={t("screen.process.callsUnread")} />
      )}
    </>
  )
}

/**
 * A process the engine has no version of, in the view's place: what happened and the way to the
 * engine's processes. No retry changes it, so it offers no Try again.
 */
export function UnknownProcess({
  engine,
  process,
  navigate,
}: {
  readonly engine: string
  readonly process: string
  readonly navigate: Navigate
}) {
  const t = useT()
  const href = screenUrlOf({ kind: "engine", engine, filter: { scope: "all" } })
  return (
    <ErrorState
      title={t("screen.process.unknown.title", { process, engine })}
      titleAs="h2"
      description={t("screen.process.unknown.description")}
      actions={
        <Button asChild variant="outline">
          <PageLink href={href} navigate={navigate}>
            {t("screen.process.unknown.processes", { engine })}
          </PageLink>
        </Button>
      }
    />
  )
}
