import type { ReactNode } from "react"
import { TabCount, Tabs, TabsContent, TabsList, TabsTrigger } from "@miragon/pulse-ui"
import { WidgetShell } from "@miragon/pulse-widget-shell/widgets"

/** Tabs mount on first activation, so lazy tabs do not query early; `keepMounted` keeps half-filled input. */
export interface DetailPageTab {
  id: string
  label: string
  /** A count the page already holds (its data on screen), never one read for the tab. */
  count?: number
  content: ReactNode
  keepMounted?: boolean
}

/**
 * Shared detail-page skeleton: pure layout, no fetching, no mutations, no i18n. The view's bar and
 * the strips under it run from edge to edge, the rest sits in the gutter; the tab bar runs from
 * edge to edge too, the webview's line tabs with their counts.
 */
export function DetailPage({
  header,
  notice,
  summary,
  diagram,
  tabs,
  content,
  defaultTab,
  children,
}: {
  /** The view's bar (`WidgetHeader`). */
  header: ReactNode
  /** A `StatusStrip` docked under the bar (a failed refresh over the data shown). */
  notice?: ReactNode
  /** The first section under the bar: the facts, a failure and its remedy, KPIs. */
  summary?: ReactNode
  diagram?: ReactNode
  /** Tabbed body. Takes precedence over `content` when non-empty. */
  tabs?: DetailPageTab[]
  /** Single-block body for pages where tabs would split cohesive context. */
  content?: ReactNode
  defaultTab?: string
  children?: ReactNode
}) {
  return (
    <WidgetShell
      header={
        <>
          {header}
          {notice}
        </>
      }
    >
      {summary}
      {diagram}
      {tabs && tabs.length > 0 ? (
        <section>
          <Tabs
            className="gap-section"
            defaultValue={
              defaultTab && tabs.some((tab) => tab.id === defaultTab) ? defaultTab : tabs[0].id
            }
          >
            {/* A view's tab bar: from edge to edge of the card, out of the content's gutter; in a
                narrow card its tabs stay one line and scroll inside it (the kit's line list), each
                reached with the arrows, rather than widen the view. */}
            <TabsList variant="line" className="-mx-gutter w-auto">
              {tabs.map((tab) => (
                <TabsTrigger key={tab.id} value={tab.id}>
                  {tab.label}
                  {tab.count !== undefined && <TabCount count={tab.count} />}
                </TabsTrigger>
              ))}
            </TabsList>
            {tabs.map((tab) =>
              tab.keepMounted ? (
                <TabsContent
                  key={tab.id}
                  value={tab.id}
                  forceMount
                  className="data-[state=inactive]:hidden"
                >
                  {tab.content}
                </TabsContent>
              ) : (
                <TabsContent key={tab.id} value={tab.id}>
                  {tab.content}
                </TabsContent>
              ),
            )}
          </Tabs>
        </section>
      ) : (
        content
      )}
      {children}
    </WidgetShell>
  )
}
