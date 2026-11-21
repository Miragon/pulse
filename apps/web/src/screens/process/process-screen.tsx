import { useEffect, useMemo, useState, type KeyboardEvent } from "react"
import { InstanceFilters } from "@miragon/pulse-blocks"
import type { InstanceListFilterData } from "@miragon/pulse-screens"
import {
  isPermanentError,
  parseBpmnNames,
  useToolQuery,
  WidgetShell,
} from "@miragon/pulse-widget-shell/widgets"
import { useT } from "../../messages/index.js"
import type { Navigate } from "../../router/page-link.js"
import { BPMN_XML_FEED, diagramKey } from "../instance/instance-feed.js"
import { READ_AGAIN_AFTER_MS, useReadOnReturn } from "../read-on-return.js"
import { ScreenState } from "../cluster-problem.js"
import { RefreshNotice } from "../screen-chrome.js"
import { usePageSlots } from "../slots.js"
import { useWide } from "../use-wide.js"
import { InstanceList } from "./instance-list.js"
import { isListRefusal, useInstancePages, type InstancePages } from "./instance-pages.js"
import {
  isUnknownProcess,
  PROCESS_SCREEN_FEED,
  processScreenKey,
  VARIABLE_NAMES_FEED,
  variableNamesKey,
  type ProcessScreenFeed,
  type VariableNamesFeed,
} from "./process-feed.js"
import { ProcessBody } from "./process-body.js"
import { ProcessBar, ProcessStrips, UnknownProcess } from "./process-head.js"

/** How many times a failed read runs again by itself: TanStack's three, never for a refusal. */
const READ_RETRIES = 3

/** A refusal no retry changes: the kit's, and a process the engine has no version of. */
const isRefusal = (error: unknown): boolean => isPermanentError(error) || isUnknownProcess(error)

/** What the page reads of a version's diagram: its XML, null where the engine has none. */
interface DiagramFeed {
  readonly bpmnXml: string | null
}

/**
 * How the reader asked for another version: a pick in the bar's picker, which keeps the focus at the
 * picker (WCAG 3.2.2: a select's change moves no focus), or the way the older versions' notice
 * offers, after which the focus goes to the screen's heading like any move of the page.
 */
export type VersionMove = "pick" | "show"

export interface ProcessScreenProps {
  readonly engine: string
  /** The process's BPMN process ID. */
  readonly process: string
  /** The version's number the address names; none for the latest. */
  readonly version?: number
  /** The instance list's filter, which the page's address carries. */
  readonly filter: InstanceListFilterData
  readonly navigate: Navigate
  /** A filter of the list (a scope, an element, a key, a condition): the entry named anew. */
  readonly onFilter: (filter: InstanceListFilterData) => void
  /**
   * Another version, by its number: a new entry, the variable conditions kept, as in the editors;
   * a pick in the bar's picker keeps the reader there, the older versions' notice leads on.
   */
  readonly onVersion: (version: number, filter: InstanceListFilterData, move: VersionMove) => void
  /** Whether the screen reads: until then it names the process in its bar and shows it loading. */
  readonly ready?: boolean
}

/**
 * The web app's process screen (D10), at a process's own address: the process in one version
 * (its number in the address, else the latest) from the process screen's feed, the numbers the
 * editors' definition view shows (D2), rendered with the blocks the webview renders. Its bar (the
 * name, the engine, the version picker with each version's counts, the Refresh, the version in the
 * engine's web app, when it was read) and strips (older versions that still run with the way to
 * the newest of them, a history that misses running instances, what it could not read), then its
 * diagram with the counts on each element (root incidents, incidents in called instances apart,
 * running) and the call activities' links, and the version's instance list with its scopes,
 * counts, element chip, exact business key and variable conditions, pages of 50 by Load more. A
 * count's click filters the list to its element and scope, Escape clears the element; the filter
 * rides in the address. From 64rem on the diagram and the list split the window's height, the
 * reader moving the separator by mouse or keyboard; under it the diagram takes a height of its own
 * (240 to 560 px) with three rows of the list under it, and the page scrolls. It writes nothing,
 * selects nothing and hands nothing to a chat. Its states are its own: a first load's skeleton, a
 * failure with Try again unless no retry changes it, a process the engine has no version of as a
 * refusal without Try again, a failed refresh a strip under the bar.
 */
export function ProcessScreen(props: ProcessScreenProps) {
  const { engine, process, version, filter, navigate, onFilter, onVersion, ready = true } = props
  const wide = useWide()
  const read = useProcessScreen(engine, process, version, filter, ready)
  const { data, selected, diagram, list, names, nameOf, refreshing } = read
  const slots = usePageSlots(navigate)
  const [strips, setStrips] = useState<HTMLElement | null>(null)
  // Stacked, the diagram leaves the strips' height to the list's first rows too.
  const stripsHeight = useHeightOf(wide ? null : strips)
  const toVersion = (move: VersionMove) => (picked: number) => {
    onVersion(picked, keptAcrossVersions(filter), move)
  }
  return (
    <main
      data-slot="process-screen"
      className="flex min-w-0 flex-col lg:min-h-0 lg:flex-1"
      onKeyDown={escapeClears(filter, onFilter)}
    >
      <WidgetShell
        fill={wide}
        flush={data !== undefined}
        header={
          <>
            <ProcessBar
              engine={engine}
              process={process}
              data={read.bar}
              refreshing={refreshing}
              onRefresh={ready ? read.refetch : undefined}
              onVersion={toVersion("pick")}
            />
            <RefreshNotice
              error={read.refreshError}
              onRetry={read.refetch}
              permanent={isScreenRefusal}
              engine={engine}
            />
            {data !== undefined && (
              <div ref={setStrips} data-slot="process-strips">
                <ProcessStrips
                  screen={data}
                  version={version}
                  filter={filter}
                  counts={countsAfter(data, list)}
                  onVersion={toVersion("show")}
                />
              </div>
            )}
          </>
        }
      >
        {data === undefined || selected === undefined ? (
          <ProcessState
            engine={engine}
            process={process}
            error={read.error}
            onRetry={read.refetch}
            navigate={navigate}
          />
        ) : (
          <ProcessBody
            screen={data}
            xml={diagram.data?.bpmnXml}
            diagramFailed={diagram.isError || data.unread.includes("diagram")}
            selected={filter.elementId}
            stale={refreshing}
            wide={wide}
            above={stripsHeight}
            nameOf={nameOf}
            onSelect={(elementId, scope) => {
              onFilter(InstanceFilters.withElement(filter, elementId, scope))
            }}
            onOpenCall={(href) => {
              navigate(href)
            }}
            list={
              <InstanceList
                engine={engine}
                version={selected.version}
                filter={filter}
                list={list}
                names={names.names}
                refused={names.refused}
                onSuggest={names.suggest}
                elementName={nameOf}
                onFilter={onFilter}
                busy={refreshing}
                slots={slots}
              />
            }
          />
        )}
      </WidgetShell>
    </main>
  )
}

/** The height `element` takes, in px, as it changes; 0 without an element. */
function useHeightOf(element: HTMLElement | null): number {
  const [height, setHeight] = useState(0)
  useEffect(() => {
    if (element === null) return undefined
    const observer = new ResizeObserver(() => {
      setHeight(element.offsetHeight)
    })
    observer.observe(element)
    return () => {
      observer.disconnect()
    }
  }, [element])
  return element === null ? 0 : height
}

/** A refusal no retry changes of the screen's reads: its process's, its list's. */
const isScreenRefusal = (error: unknown): boolean => isRefusal(error) || isListRefusal(error)

/**
 * The list's counts the history's hint compares with the version's running instances, where they
 * were read no earlier than the versions (`runtime-contract.md`: the runtime's count first, then
 * the history's over every lifecycle, or an instance started between the two reads would read as
 * missing from the history): none while the list's first page is a placeholder or older than the
 * screen's read (an answer the server's floor kept from before a Refresh, say).
 */
function countsAfter(screen: ProcessScreenFeed, list: InstancePages) {
  const { data, isPlaceholderData } = list.first
  if (data === undefined || isPlaceholderData) return undefined
  return Date.parse(data.asOf) >= Date.parse(screen.asOf) ? data.counts : undefined
}

/**
 * What the screen reads: its process in one version (under the page's name of its engine, which
 * every link of the page names), the version's diagram, its instance list by the filter and its
 * variable names once the dialog asks for them. The list's first page is sent only once the
 * versions answered: at the start, since it reads the version they name; on Refresh and on the
 * reader's return, which read the versions first, then the list over them (the order the history's
 * hint reads in), and the diagram where its read failed. A failed refresh of either says so in the
 * strip under the bar, the content on screen kept.
 */
function useProcessScreen(
  engine: string,
  process: string,
  version: number | undefined,
  filter: InstanceListFilterData,
  ready: boolean,
) {
  const query = useProcessRead(engine, process, version, ready)
  // While another version reads, the bar keeps the version before (its name, its picker with the
  // reader's pick and focus); the body waits for the version asked for.
  const bar = useMemo(
    () => (query.data === undefined ? undefined : { ...query.data, engine }),
    [query.data, engine],
  )
  const data = query.isPlaceholderData ? undefined : bar
  const selected = data?.selected ?? undefined
  const diagram = useDiagram(engine, data)
  const list = useInstancePages(engine, selected?.id, filter, ready)
  const names = useVariableNames(engine, selected?.id)
  const nameOf = useNames(diagram.data?.bpmnXml)
  /** The versions read again, then the list over the version it lists, if they still name it. */
  const readAgain = (options?: { cancelRefetch: boolean }) => {
    const listed = selected?.id
    return query.refetch(options).then(async (result) => {
      if (listed !== undefined && result.data?.selected?.id === listed) {
        await list.first.refetch(options)
      }
    })
  }
  const refetch = () => {
    void readAgain()
    if (diagram.isError) void diagram.refetch()
  }
  useReadOnReturn(
    {
      dataUpdatedAt: query.dataUpdatedAt,
      errorUpdatedAt: query.errorUpdatedAt,
      error: query.error,
      refetch: readAgain,
    },
    ready,
    isRefusal,
  )
  const shown = data !== undefined
  return {
    bar,
    data,
    selected,
    diagram,
    list,
    names,
    nameOf,
    refetch,
    error: query.error,
    refreshing: bar !== undefined && query.isFetching,
    refreshError: shown ? (query.error ?? query.failureReason ?? listRefreshError(list)) : null,
  }
}

/** Why a read of the list's first page over the rows on screen failed: none without one. */
function listRefreshError({ first }: InstancePages): Error | null {
  if (first.data === undefined || first.isPlaceholderData) return null
  return first.error ?? first.failureReason ?? null
}

/**
 * Escape clears the element the list is filtered to, from anywhere on the screen but a field the
 * reader types or picks in and a dialog or popover that is open, which Escape closes first.
 */
function escapeClears(
  filter: InstanceListFilterData,
  onFilter: (filter: InstanceListFilterData) => void,
) {
  return (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== "Escape" || filter.elementId === undefined || isInField(event.target)) return
    if (document.querySelector(":popover-open, dialog[open]") !== null) return
    onFilter(InstanceFilters.withoutElement(filter))
  }
}

/** Whether a key comes from a field the reader types or picks in, which Escape belongs to. */
function isInField(target: EventTarget): boolean {
  return (
    (target instanceof HTMLInputElement && target.type !== "checkbox") ||
    target instanceof HTMLSelectElement
  )
}

/** What another version keeps of the list's filter: its variable conditions, as in the editors. */
function keptAcrossVersions({ variables }: InstanceListFilterData): InstanceListFilterData {
  return variables === undefined ? { scope: "running" } : { scope: "running", variables }
}

/**
 * The screen's read of its process: fresh for 60 s, read again by itself up to three times after a
 * failure a retry may change, never after a refusal (the reader's return reads it again, with the
 * list over it: `useProcessScreen`).
 */
function useProcessRead(
  engine: string,
  process: string,
  version: number | undefined,
  ready: boolean,
) {
  return useToolQuery<ProcessScreenFeed>(
    processScreenKey(engine, process),
    PROCESS_SCREEN_FEED,
    version === undefined ? { engine, process } : { engine, process, version },
    {
      staleTime: READ_AGAIN_AFTER_MS,
      enabled: ready,
      // Another version of the process reads under the version before: the bar keeps its place.
      placeholderData: (previous) => previous,
      retry: (failures, error) => failures < READ_RETRIES && !isRefusal(error),
    },
  )
}

/**
 * The diagram of the version shown, read once the screen knows it and it is there; a failed read
 * reads again when the reader comes back to the page.
 */
function useDiagram(engine: string, data: ProcessScreenFeed | undefined) {
  const definitionId = data?.selected?.id ?? ""
  const query = useToolQuery<DiagramFeed>(
    diagramKey(engine, definitionId),
    BPMN_XML_FEED,
    { engine, processDefinitionId: definitionId },
    { enabled: definitionId !== "" && data?.unread.includes("diagram") === false },
  )
  useReadOnReturn(query, query.isError)
  return query
}

/**
 * The version's variable names for the condition dialog and the kinds the engine refuses, read
 * once the reader first opens the dialog (`suggest`), never before.
 */
function useVariableNames(engine: string, definitionId: string | undefined) {
  const [asked, setAsked] = useState(false)
  const query = useToolQuery<VariableNamesFeed>(
    variableNamesKey(engine, definitionId ?? ""),
    VARIABLE_NAMES_FEED,
    { engine, definitionId: definitionId ?? "" },
    { enabled: asked && definitionId !== undefined, staleTime: READ_AGAIN_AFTER_MS },
  )
  return {
    names: query.data?.names,
    refused: query.data?.refused,
    suggest: () => {
      setAsked(true)
    },
  }
}

/** An element's name: the diagram's, else its id. */
function useNames(xml: string | null | undefined) {
  return useMemo(() => {
    const names = typeof xml === "string" ? parseBpmnNames(xml, "").elements : {}
    return (elementId: string) => names[elementId] ?? elementId
  }, [xml])
}

/** The screen before it read its process: loading, failed, or a process the engine has no version of. */
function ProcessState({
  engine,
  process,
  error,
  onRetry,
  navigate,
}: {
  readonly engine: string
  readonly process: string
  readonly error: Error | null
  readonly onRetry: () => void
  readonly navigate: Navigate
}) {
  const t = useT()
  if (error !== null && isUnknownProcess(error)) {
    return <UnknownProcess engine={engine} process={process} navigate={navigate} />
  }
  return (
    <ScreenState
      engine={engine}
      loading={error === null}
      error={error}
      onRetry={onRetry}
      emptyText=""
      loadingText={t("screen.process.loading", { process })}
      errorTitle={t("screen.process.failed", { process })}
      retryLabel={t("action.tryAgain")}
    />
  )
}
