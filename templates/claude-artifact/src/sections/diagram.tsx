import { useMemo } from "react"
import { DiagramDecorations, type BadgeCountKind } from "@miragon/pulse-screens"
import { Skeleton } from "@miragon/pulse-ui"
import { readDiagram } from "../data/process-dashboard.ts"
import { useSection } from "../engine/use-engine.tsx"
import { useT } from "../messages.ts"
import { DiagramLegend } from "../temporary/diagram-legend.tsx"
import { Panel } from "../temporary/panel.tsx"
import { ProcessDiagram, type DrawnElement } from "../temporary/process-diagram.tsx"
import { SectionState } from "../temporary/section-state.tsx"
import { CutNote } from "./cut-note.tsx"
import { goTo, processNameOf, rowAnchor, useElementNames } from "./names.ts"

/**
 * Where a count on the diagram leads on this page, the first of these the page holds: an
 * activity's root incidents to its row of Open incidents, the incidents in the instances it called
 * to its line under them, each else to Open incidents; a user task's running instances to its row
 * of Open tasks (each waits there as an open task), else to Open tasks. The page lists no
 * instances, so the running instances at any other element lead nowhere: none, and their count is
 * drawn without a button.
 */
export function countTargets(element: DrawnElement, kind: BadgeCountKind): readonly string[] {
  switch (kind) {
    case "incidents":
      return [rowAnchor("incidents", element.id), "incidents"]
    case "incidentsInCalledInstances":
      return [rowAnchor("calledIncidents", element.id), "incidents"]
    case "running":
      return element.type === "bpmn:UserTask" ? [rowAnchor("tasks", element.id), "tasks"] : []
  }
}

/**
 * The latest version's diagram with every version's counts on it: the root incidents at each
 * element (its outline marked), apart the incidents in the instances a call activity called, and
 * the running activity instances.
 */
export function DiagramSection({ processKey }: { readonly processKey: string }) {
  const t = useT()
  const section = useSection((engine) => readDiagram(engine, processKey), [processKey])
  const data = section.data
  const version = data?.process.latest?.version
  const nameOf = useElementNames(data?.process.xml)
  const decorations = useMemo(
    () => DiagramDecorations.of({ badges: data?.badges ?? [], calls: [] }),
    [data?.badges],
  )
  return (
    <Panel
      title={t("diagram.title")}
      hint={version === undefined ? undefined : t("diagram.scope", { version })}
      trailing={version === undefined ? undefined : <DiagramLegend version={version} />}
    >
      <SectionState section={section} skeleton={<Skeleton className="h-80 w-full" />}>
        {(diagram) =>
          diagram.process.xml === null || diagram.process.latest === null ? (
            <p className="text-muted-foreground m-0">{t("diagram.noXml")}</p>
          ) : (
            <div className="flex flex-col gap-2">
              <CutNote cut={diagram.cut} />
              <div className="border-border overflow-hidden rounded-md border">
                <ProcessDiagram
                  xml={diagram.process.xml}
                  decorations={decorations}
                  badges={diagram.badges}
                  ariaLabel={t("diagram.label", {
                    process: processNameOf(diagram.process.xml, processKey),
                    version: diagram.process.latest.version,
                  })}
                  nameOf={(id) => nameOf(id) ?? id}
                  drawFailed={t("diagram.drawFailed")}
                  selectable={(element, kind) => countTargets(element, kind).length > 0}
                  onSelect={(element, kind) => {
                    goTo(countTargets(element, kind))
                  }}
                />
              </div>
              <p className="text-muted-foreground m-0">{t("diagram.runningNote")}</p>
            </div>
          )
        }
      </SectionState>
    </Panel>
  )
}
