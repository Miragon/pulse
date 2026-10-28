import type { ReactNode } from "react"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@miragon/mcp-toolkit-ui"
import { WidgetShell } from "@miragon/pulse-widget-shell/widgets"

/** Tabs mount on first activation, so lazy tabs do not query early; `keepMounted` keeps half-filled input. */
export interface DetailPageTab {
  id: string
  label: string
  count?: number
  content: ReactNode
  keepMounted?: boolean
}

/** Shared detail-page skeleton: pure layout, no fetching, no mutations, no i18n. */
export function DetailPage({
  header,
  kpi,
  diagram,
  tabs,
  content,
  defaultTab,
  children,
}: {
  header: ReactNode
  kpi?: ReactNode
  diagram?: ReactNode
  /** Tabbed body — takes precedence over `content` when non-empty. */
  tabs?: DetailPageTab[]
  /** Single-block body for pages where tabs would split cohesive context. */
  content?: ReactNode
  defaultTab?: string
  children?: ReactNode
}) {
  return (
    <WidgetShell>
      {header}
      {kpi}
      {diagram}
      {tabs && tabs.length > 0 ? (
        <section>
          <Tabs
            defaultValue={
              defaultTab && tabs.some((tab) => tab.id === defaultTab) ? defaultTab : tabs[0].id
            }
          >
            <TabsList variant="line">
              {tabs.map((tab) => (
                <TabsTrigger key={tab.id} value={tab.id}>
                  {tab.label}
                  {tab.count !== undefined && (
                    <span className="text-muted-foreground font-normal tabular-nums">
                      ({tab.count})
                    </span>
                  )}
                </TabsTrigger>
              ))}
            </TabsList>
            {tabs.map((tab) =>
              tab.keepMounted ? (
                <TabsContent
                  key={tab.id}
                  value={tab.id}
                  forceMount
                  className="pt-4 data-[state=inactive]:hidden"
                >
                  {tab.content}
                </TabsContent>
              ) : (
                <TabsContent key={tab.id} value={tab.id} className="pt-4">
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
