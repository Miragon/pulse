import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react"
import { ErrorState, Skeleton, useLocale, formatTime } from "@miragon/pulse-ui"
import { modelContextText } from "./ask-ai-prompt.js"
import { DisplayModeToggle, useDisplayModeControl } from "./display-mode-toggle.js"
import { kitLabels, type KitLabels } from "./kit-labels.js"
import { useShellHost } from "./shell-host.js"
import { viewCallContext, type ViewCall } from "./view-call.js"
import { ViewDataState } from "./view-data-state.js"
import { ViewErrorBoundary } from "./view-error-boundary.js"
import { HostModelContext, useHostFollowUp, type FollowUp } from "./view-host.js"
import type { ViewComponent } from "./views.js"

/** After this long, the waiting line adds what to do. */
export const SLOW_HINT_MS = 8_000

/**
 * Where the frame says what to do, a chat's words ask in the chat; a page posts to no chat, so
 * its words say to reload the page.
 */
function frameLabels(labels: KitLabels, followUp: FollowUp): KitLabels {
  if (followUp === "chat") return labels
  return { ...labels, slowHint: labels.pageSlowHint, viewMissing: labels.pageViewMissing }
}

/**
 * The view's lifecycle around ONE view component: waiting, error (the kit's words, the raw text
 * under Details, Try again), cancelled, a missing view, then the view itself under a toolbar that
 * carries the "Reloaded at" stamp and the fullscreen switch. No title: views carry their heading.
 * Host-agnostic, so it renders under `TestViewHost` too, its words for a chat or for a page.
 * Fullscreen the view fills the viewport, unless `fill` is false: a page's frame lays it out then.
 */
export function ViewFrame({
  call,
  view,
  fill = true,
}: {
  call: ViewCall
  view: ViewComponent | undefined
  fill?: boolean
}) {
  const frameRef = useRef<HTMLDivElement>(null)
  const labels = frameLabels(kitLabels(useLocale()), useHostFollowUp())
  const { phase } = call
  // The frame stays the focus target, so a retry never drops focus to the document.
  const retry = useCallback(() => {
    frameRef.current?.focus()
    call.retry()
  }, [call])
  const spec = view ? viewCallContext(phase) : null
  return (
    <div ref={frameRef} tabIndex={-1} data-slot="view-frame" className="outline-none">
      {spec && <HostModelContext content={modelContextText(spec)} />}
      <FrameBody call={call} view={view} labels={labels} onRetry={retry} fill={fill} />
    </div>
  )
}

function FrameBody({
  call: { phase },
  view: View,
  labels,
  onRetry,
  fill,
}: {
  call: ViewCall
  view: ViewComponent | undefined
  labels: KitLabels
  onRetry: () => void
  fill: boolean
}) {
  // Every phase before the view sits on the gutter, as the view's own content does.
  if (!View) {
    return (
      <div className="p-gutter">
        <ErrorState title={labels.viewMissing} />
      </div>
    )
  }
  switch (phase.phase) {
    case "waiting":
      return <ViewWaiting labels={labels} />
    case "cancelled":
      return (
        <div className="p-gutter">
          <p role="status" className="text-muted-foreground text-small">
            {labels.cancelled}
          </p>
        </div>
      )
    case "error":
      return (
        <div className="p-gutter">
          <ViewDataState
            loading={false}
            error={phase.error}
            onRetry={onRetry}
            emptyText=""
            errorTitle={labels.viewErrorTitle}
          />
        </div>
      )
    case "ready":
      return (
        <ViewMain reloadedAt={phase.reloadedAt} labels={labels} fill={fill}>
          <ViewErrorBoundary>
            <View data={phase.data as never} />
          </ViewErrorBoundary>
        </ViewMain>
      )
  }
}

/** No aria-busy above the live region: assistive technology may hold back the slow hint. */
function ViewWaiting({ labels }: { labels: KitLabels }) {
  const [slow, setSlow] = useState(false)
  useEffect(() => {
    const id = setTimeout(() => setSlow(true), SLOW_HINT_MS)
    return () => clearTimeout(id)
  }, [])
  return (
    <div className="gap-section p-gutter flex flex-col">
      <Skeleton aria-hidden="true" className="h-control w-48" />
      <Skeleton aria-hidden="true" className="h-32 w-full" />
      <div role="status" className="text-muted-foreground text-small flex flex-col gap-1">
        <p>{labels.loadingView}</p>
        {slow && <p data-slot="slow-hint">{labels.slowHint}</p>}
      </div>
    </div>
  )
}

/**
 * Fullscreen, the view owns the viewport and scrolls itself, unless a page's frame lays it out
 * (`fill` false: it takes its content's height under the frame's bar); inline the host sizes the
 * frame from its height. Safe-area insets pad it on mobile hosts.
 */
function ViewMain({
  reloadedAt,
  labels,
  fill,
  children,
}: {
  reloadedAt: number | null
  labels: KitLabels
  fill: boolean
  children: ReactNode
}) {
  const { safeArea } = useShellHost()
  const { displayMode, canFullscreen } = useDisplayModeControl()
  const style: CSSProperties = {
    ...(fill && displayMode === "fullscreen" ? { minHeight: "100vh", overflowY: "auto" } : null),
    paddingTop: safeArea?.top,
    paddingRight: safeArea?.right,
    paddingBottom: safeArea?.bottom,
    paddingLeft: safeArea?.left,
  }
  return (
    <main style={style}>
      {(reloadedAt !== null || canFullscreen) && (
        <div
          data-slot="view-toolbar"
          className="min-h-bar px-gutter flex items-center gap-2 py-1.5"
        >
          {reloadedAt !== null && (
            <p
              data-slot="view-reloaded-at"
              className="text-muted-foreground text-small min-w-0 truncate"
            >
              {labels.reloadedAt(
                formatTime(new Date(reloadedAt).toISOString(), { seconds: false }),
              )}
            </p>
          )}
          <div className="ml-auto flex shrink-0 items-center gap-1">
            <DisplayModeToggle />
          </div>
        </div>
      )}
      {children}
    </main>
  )
}
