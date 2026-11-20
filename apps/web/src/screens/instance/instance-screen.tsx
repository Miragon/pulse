import { useMemo } from "react"
import { shortId } from "@miragon/pulse-ui"
import {
  isPermanentError,
  parseBpmnNames,
  useToolQuery,
  ViewDataState,
  WidgetShell,
} from "@miragon/pulse-widget-shell/widgets"
import { useT } from "../../messages/index.js"
import type { Navigate } from "../../router/page-link.js"
import type { InstanceTab } from "../../router/routes.js"
import { READ_AGAIN_AFTER_MS, useReadOnReturn } from "../read-on-return.js"
import { RefreshNotice } from "../screen-chrome.js"
import { useWide } from "../use-wide.js"
import { InstanceBody } from "./instance-body.js"
import { preselectedTab } from "./instance-details.js"
import {
  BPMN_XML_FEED,
  diagramKey,
  INSTANCE_SCREEN_FEED,
  instanceScreenKey,
  isUnknownInstance,
  type InstanceScreenFeed,
} from "./instance-feed.js"
import { InstanceBar, InstanceStrips, UnknownInstance } from "./instance-head.js"
import { useInstanceSlots } from "./instance-slots.js"

/** How many times a failed read runs again by itself: TanStack's three, never for a refusal. */
const READ_RETRIES = 3

/** A refusal no retry changes: the kit's, and an instance the engine does not know. */
const isRefusal = (error: unknown): boolean => isPermanentError(error) || isUnknownInstance(error)

/** What the page reads of a version's diagram: its XML, null where the engine has none. */
interface DiagramFeed {
  readonly bpmnXml: string | null
}

export interface InstanceScreenProps {
  readonly engine: string
  readonly instance: string
  /** The tab the reader picked, which the page's address carries; none: by the instance's state. */
  readonly tab?: InstanceTab
  /** The root incident in focus, by its id: the address of an incident under its instance. */
  readonly incident?: string
  readonly navigate: Navigate
  /** A pick of a tab: the page names its entry anew with it. */
  readonly onTab: (tab: InstanceTab) => void
  /** Whether the screen reads: until then it names the instance in its bar and shows it loading. */
  readonly ready?: boolean
}

/**
 * The web app's instance screen (D10), at an instance's own address and, with one of its root
 * incidents in focus, at the address of that incident under it: the instance from the instance
 * screen's feed, the numbers and rows the editors' instance view shows (D2), rendered with the
 * blocks the webview renders. Its bar and strips (the caller, where it stands, a cut list), then
 * its diagram with the markers and the ways to what it called, and its details in the editors' tabs
 * (history, incidents, waiting, variables), the tab in the address; from 64rem on the diagram and
 * the details split the window's height, the reader moving the separator by mouse or keyboard,
 * under it the diagram takes a height of its own above the details. The incident in focus opens
 * its card, reads its text and selects its element; an incident the instance does not hold says
 * so. It writes nothing and hands nothing to a chat. Its states are its own: a first load's
 * skeleton, a failure with Try again unless no retry changes it, an instance the engine does not
 * know as a refusal without Try again, a failed refresh a strip under the bar.
 */
export function InstanceScreen(props: InstanceScreenProps) {
  const { engine, instance, tab, incident, navigate, onTab, ready = true } = props
  const wide = useWide()
  const query = useInstanceRead(engine, instance, ready)
  const { error, isFetching } = query
  // The screen under the page's name of its engine, which every link of the page names.
  const data = useMemo(
    () => (query.data === undefined ? undefined : { ...query.data, engine }),
    [query.data, engine],
  )
  const diagram = useDiagram(engine, data)
  const nameOf = useNames(data, diagram.data?.bpmnXml)
  const slots = useInstanceSlots(navigate)
  // The Refresh reads the instance again, and its diagram where that read failed: a diagram read
  // keeps its key and stays enabled, so nothing else would read it before the page loads anew.
  const refetch = () => {
    void query.refetch()
    if (diagram.isError) void diagram.refetch()
  }
  const refreshing = data !== undefined && isFetching
  const refreshError = data !== undefined ? (error ?? query.failureReason ?? null) : null
  return (
    <main data-slot="instance-screen" className="flex min-w-0 flex-col lg:min-h-0 lg:flex-1">
      <WidgetShell
        fill={wide}
        flush={data !== undefined}
        header={
          <>
            <InstanceBar
              engine={engine}
              instance={instance}
              data={data}
              refreshing={refreshing}
              onRefresh={ready ? refetch : undefined}
              slots={slots}
            />
            <RefreshNotice error={refreshError} onRetry={refetch} permanent={isRefusal} />
            {data !== undefined && (
              <InstanceStrips screen={data} focus={incident} nameOf={nameOf} navigate={navigate} />
            )}
          </>
        }
      >
        {data === undefined ? (
          <InstanceState
            engine={engine}
            instance={instance}
            error={error}
            onRetry={refetch}
            navigate={navigate}
          />
        ) : (
          <InstanceBody
            screen={data}
            xml={diagram.data?.bpmnXml}
            diagramFailed={diagram.isError || data.unread.includes("diagram")}
            tab={tab ?? (incident === undefined ? preselectedTab(data) : "incidents")}
            onTab={onTab}
            focus={incident}
            nameOf={nameOf}
            wide={wide}
            navigate={navigate}
            slots={slots}
          />
        )}
      </WidgetShell>
    </main>
  )
}

/**
 * The screen's read of its instance: fresh for 60 s, read again by itself up to three times after
 * a failure a retry may change, never after a refusal, and again when the reader comes back.
 */
function useInstanceRead(engine: string, instance: string, ready: boolean) {
  const query = useToolQuery<InstanceScreenFeed>(
    instanceScreenKey(engine, instance),
    INSTANCE_SCREEN_FEED,
    { engine, instance },
    {
      staleTime: READ_AGAIN_AFTER_MS,
      enabled: ready,
      retry: (failures, error) => failures < READ_RETRIES && !isRefusal(error),
    },
  )
  useReadOnReturn(query, ready, isRefusal)
  return query
}

/**
 * The diagram of the instance's version, read once the screen knows the version and it is there; a
 * failed read reads again when the reader comes back to the page, as the instance does.
 */
function useDiagram(engine: string, data: InstanceScreenFeed | undefined) {
  const definitionId = data?.instance.definition.id ?? ""
  const query = useToolQuery<DiagramFeed>(
    diagramKey(engine, definitionId),
    BPMN_XML_FEED,
    { engine, processDefinitionId: definitionId },
    { enabled: data !== undefined && !data.unread.includes("diagram") },
  )
  useReadOnReturn(query, query.isError)
  return query
}

/**
 * An element's name: the diagram's, else the one its rows carry (an element of an instance it
 * called among them), else its id.
 */
function useNames(data: InstanceScreenFeed | undefined, xml: string | null | undefined) {
  const names = useMemo(() => {
    const rows = [...(data?.path ?? []), ...(data?.waits ?? [])]
    const named = Object.fromEntries(
      rows.flatMap(({ elementId, elementName }) =>
        elementName === undefined ? [] : [[elementId, elementName] as const],
      ),
    )
    return typeof xml === "string" ? { ...named, ...parseBpmnNames(xml, "").elements } : named
  }, [xml, data])
  return useMemo(() => (elementId: string) => names[elementId] ?? elementId, [names])
}

/** The screen before it read its instance: loading, failed, or an instance the engine does not know. */
function InstanceState({
  engine,
  instance,
  error,
  onRetry,
  navigate,
}: {
  readonly engine: string
  readonly instance: string
  readonly error: Error | null
  readonly onRetry: () => void
  readonly navigate: Navigate
}) {
  const t = useT()
  if (error !== null && isUnknownInstance(error)) {
    return <UnknownInstance engine={engine} instance={instance} navigate={navigate} />
  }
  return (
    <ViewDataState
      loading={error === null}
      error={error}
      onRetry={onRetry}
      emptyText=""
      loadingText={t("screen.instance.loading", { instance: shortId(instance) })}
      errorTitle={t("screen.instance.failed", { instance: shortId(instance) })}
      retryLabel={t("action.tryAgain")}
    />
  )
}
