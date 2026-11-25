import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { LocaleProvider, PanelGrid, SectionStateGroup } from "@miragon/pulse-ui"
import type { Connector } from "./engine/connector.ts"
import { viewerTimeZone } from "./engine/engine.ts"
import { EngineProvider } from "./engine/use-engine.tsx"
import { applyFormatLocale, viewerLocale } from "./locale.ts"
import { translate } from "./messages.ts"
import { PROCESS_KEY } from "./page.config.ts"
import { DiagramSection } from "./sections/diagram.tsx"
import { HeaderSection } from "./sections/header.tsx"
import { IncidentsSection } from "./sections/incidents.tsx"
import { KpiSection } from "./sections/kpis.tsx"
import { OutcomesSection } from "./sections/outcomes.tsx"
import { PageGate } from "./sections/page-gate.tsx"
import { PerDaySection } from "./sections/per-day.tsx"
import { TasksSection } from "./sections/tasks.tsx"

/**
 * The dashboard: its bar, then the sections behind the page's gate, each reading on its own
 * through `useSection`, so one failing section never blanks the page; sections that fail alike say
 * it once (`SectionStateGroup`), and a page the runtime refuses as a whole says so once in the
 * sections' place. Three calls a load, each shared by the sections that show it. The panels stand
 * two side by side where their grid has 600 px, else one under the other.
 */
export function App({ processKey = PROCESS_KEY }: { readonly processKey?: string }) {
  return (
    <div className="bg-background text-foreground text-dense font-sans">
      <HeaderSection processKey={processKey} />
      <main className="gap-section p-gutter flex flex-col">
        <PageGate>
          <SectionStateGroup>
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
          </SectionStateGroup>
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
  /** The time zone whose days the page counts in; default the viewer's (the fixtures' own). */
  timeZone?: string
  processKey?: string
}

/** The dashboard with its providers: the viewer's language and the page's engine. */
export function Page({ connector, language, now, timeZone, processKey }: PageProps) {
  const locale = viewerLocale(language ?? globalThis.navigator?.language)
  // One zone for the days the server counts and the dates the page writes.
  const zone = timeZone ?? viewerTimeZone()
  applyFormatLocale(locale, zone)
  return (
    <LocaleProvider locale={locale.language} translator={translate}>
      <EngineProvider connector={connector} now={now} timeZone={zone}>
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
