import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { LocaleProvider } from "@miragon/pulse-ui"
import type { Connector } from "./engine/connector.ts"
import { EngineProvider } from "./engine/use-engine.tsx"
import { applyFormatLocale, viewerLocale } from "./locale.ts"
import { translate } from "./messages.ts"
import { DiagramSection } from "./sections/diagram.tsx"
import { HeaderSection } from "./sections/header.tsx"
import { IncidentsSection } from "./sections/incidents.tsx"
import { KpiSection } from "./sections/kpis.tsx"
import { OutcomesSection } from "./sections/outcomes.tsx"
import { PageGate } from "./sections/page-gate.tsx"
import { PerDaySection } from "./sections/per-day.tsx"
import { TasksSection } from "./sections/tasks.tsx"
import { PanelGrid } from "./temporary/panel.tsx"

/**
 * The process this dashboard shows, the one place that names it. A dashboard of another process
 * changes this key, records its fixtures (`pnpm record`, which reads the key from this line) and
 * edits the sections.
 */
export const PROCESS_KEY = "miraveloLeasing"

/**
 * The dashboard: its bar, then the sections behind the page's gate, each reading on its own
 * through `useSection`, so one failing section never blanks the page, and a page the runtime
 * refuses as a whole says so once in the sections' place. One column on a phone, two from 64rem.
 */
export function App({ processKey = PROCESS_KEY }: { readonly processKey?: string }) {
  return (
    <div className="bg-background text-foreground text-dense font-sans">
      <HeaderSection processKey={processKey} />
      <main className="flex flex-col gap-4 p-4">
        <PageGate>
          <KpiSection processKey={processKey} />
          <DiagramSection processKey={processKey} />
          <PanelGrid>
            <PerDaySection processKey={processKey} />
            <OutcomesSection processKey={processKey} />
          </PanelGrid>
          <PanelGrid>
            <IncidentsSection processKey={processKey} />
            <TasksSection processKey={processKey} />
          </PanelGrid>
        </PageGate>
      </main>
    </div>
  )
}

export interface PageProps {
  connector: Connector
  /** The viewer's language tag; default the browser's. */
  language?: string
  /** The engine's clock (the fixtures' recording time on the fixtures). */
  now?: () => Date
  processKey?: string
}

/** The dashboard with its providers: the viewer's language and the page's engine. */
export function Page({ connector, language, now, processKey }: PageProps) {
  const locale = viewerLocale(language ?? globalThis.navigator?.language)
  applyFormatLocale(locale)
  return (
    <LocaleProvider locale={locale.language} translator={translate}>
      <EngineProvider connector={connector} now={now}>
        <App processKey={processKey} />
      </EngineProvider>
    </LocaleProvider>
  )
}

/** Renders the page into its root element, `#root` of src/page.html. */
export function mount(props: PageProps): void {
  const root = document.getElementById("root")
  if (root === null) throw new Error("The page has no #root element.")
  document.documentElement.lang = viewerLocale(props.language ?? navigator.language).language
  createRoot(root).render(
    <StrictMode>
      <Page {...props} />
    </StrictMode>,
  )
}
