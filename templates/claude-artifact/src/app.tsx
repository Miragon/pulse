import { PanelGrid, SectionStateGroup } from "@miragon/pulse-ui"
import { PageGate } from "@miragon/pulse-widget-shell/widgets"
import { PROCESS_KEY } from "./page.config.ts"
import { DiagramSection } from "./sections/diagram.tsx"
import { HeaderSection } from "./sections/header.tsx"
import { IncidentsSection } from "./sections/incidents.tsx"
import { KpiSection } from "./sections/kpis.tsx"
import { OutcomesSection } from "./sections/outcomes.tsx"
import { PerDaySection } from "./sections/per-day.tsx"
import { TasksSection } from "./sections/tasks.tsx"

/**
 * The dashboard: its bar, then the sections behind the page's gate, each reading on its own
 * through widget-shell's `useSectionRead`, so one failing section never blanks the page; sections
 * that fail alike say it once (`SectionStateGroup`), and a refusal of the viewer's connector as a
 * whole is the gate's one state in the sections' place (`PageGate`). Three calls a load, each
 * shared by the sections that show it. The panels stand two side by side where their grid has
 * 600 px, else one under the other. `mountClaudeArtifact` mounts it (src/artifact.tsx).
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
