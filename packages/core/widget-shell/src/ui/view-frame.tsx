import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react"
import { ErrorState, Skeleton, useLocale } from "@miragon/mcp-toolkit-ui"
import { modelContextText } from "./ask-ai-prompt.js"
import { DisplayModeToggle, useDisplayModeControl } from "./display-mode-toggle.js"
import { formatTime } from "./format.js"
import { kitLabels, type KitLabels } from "./kit-labels.js"
import { useShellHost } from "./shell-host.js"
import { viewCallContext, type ViewCall } from "./view-call.js"
import { ViewDataState } from "./view-data-state.js"
import { ViewErrorBoundary } from "./view-error-boundary.js"
import { HostModelContext } from "./view-host.js"
import type { ViewComponent } from "./views.js"

/** After this long, the waiting line adds what to do. */
export const SLOW_HINT_MS = 8_000

/**
 * The view's lifecycle around ONE view component: waiting, error (the kit's words, the raw text
 * under Details, Try again), cancelled, a missing view, then the view itself under a toolbar that
 * carries the "Reloaded at" stamp and the fullscreen switch. No title: views carry their heading.
 * Host-agnostic, so it renders under `TestViewHost` too.
 */
export function ViewFrame({ call, view }: { call: ViewCall; view: ViewComponent | undefined }) {
  const frameRef = useRef<HTMLDivElement>(null)
  const labels = kitLabels(useLocale())
  const { phase } = call
  // The frame stays the focus target, so a retry never drops focus to the document.
  const retry = useCallback(() => {
    frameRef.current?.focus()
    call.retry()
  }, [call])
  const spec = view ? viewCallContext(phase) : null
  return (
    <div ref={frameRef} tabIndex={-1} data-slot="view-frame" className="outline-hidden">
      {spec && <HostModelContext content={modelContextText(spec)} />}
      <FrameBody call={call} view={view} labels={labels} onRetry={retry} />
    </div>
  )
}

function FrameBody({
  call: { phase },
  view: View,
  labels,
  onRetry,
}: {
  call: ViewCall
  view: ViewComponent | undefined
  labels: KitLabels
  onRetry: () => void
}) {
  if (!View) {
    return (
      <div className="px-4 py-4">
        <ErrorState title={labels.viewMissing} />
      </div>
    )
  }
  switch (phase.phase) {
    case "waiting":
      return <ViewWaiting labels={labels} />
    case "cancelled":
      return (
        <div className="px-4 py-4">
          <p role="status" className="text-muted-foreground text-small">
            {labels.cancelled}
          </p>
        </div>
      )
    case "error":
      return (
        <div className="px-4 py-4">
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
        <ViewMain reloadedAt={phase.reloadedAt} labels={labels}>
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
    <div className="flex flex-col gap-4 px-4 py-4">
      <Skeleton aria-hidden="true" className="h-8 w-48" />
      <Skeleton aria-hidden="true" className="h-32 w-full" />
      <div role="status" className="text-muted-foreground text-small flex flex-col gap-1">
        <p>{labels.loadingView}</p>
        {slow && <p data-slot="slow-hint">{labels.slowHint}</p>}
      </div>
    </div>
  )
}

/**
 * Fullscreen, the view owns the viewport and scrolls itself; inline the host sizes the frame from
 * its height. Safe-area insets pad it on mobile hosts.
 */
function ViewMain({
  reloadedAt,
  labels,
  children,
}: {
  reloadedAt: number | null
  labels: KitLabels
  children: ReactNode
}) {
  const { safeArea } = useShellHost()
  const { displayMode, canFullscreen } = useDisplayModeControl()
  const style: CSSProperties = {
    ...(displayMode === "fullscreen" ? { minHeight: "100vh", overflowY: "auto" } : null),
    paddingTop: safeArea?.top,
    paddingRight: safeArea?.right,
    paddingBottom: safeArea?.bottom,
    paddingLeft: safeArea?.left,
  }
  return (
    <main style={style}>
      {(reloadedAt !== null || canFullscreen) && (
        <div data-slot="view-toolbar" className="flex min-h-12 items-center gap-2 px-4 py-2">
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
