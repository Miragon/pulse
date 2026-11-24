import { Panel, SectionState, Skeleton } from "@miragon/pulse-ui"
import {
  BpmnDiagram,
  DiagramLegend,
  type DiagramCountKind,
  type DiagramElement,
} from "@miragon/pulse-ui/bpmn"
import { readDiagram } from "../data/process-dashboard.ts"
import { useSection } from "../engine/use-engine.tsx"
import { useT } from "../messages.ts"
import { goTo, rowAnchor } from "./anchors.ts"

/** The diagram's room while its first read runs: about the height it draws in. */
const SKELETON_HEIGHT = 320

/**
 * Where a count on the diagram leads on this page, the first of these the page holds: an
 * activity's root incidents to its row of Open incidents, the incidents in the instances it called
 * to its line under them, each else to Open incidents; a user task's running instances to its row
 * of Open tasks (each waits there as an open task), else to Open tasks. The page lists no
 * instances, so the running instances at any other element lead nowhere: none, and their count is
 * drawn without a button.
 */
export function countTargets(element: DiagramElement, kind: DiagramCountKind): readonly string[] {
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
 * The latest version's diagram with every version's counts on it (`engine_activity_counts`, the
 * cockpit's element counts): the root incidents at each element (its outline marked), apart the
 * incidents in the instances a call activity called, and the running tokens. Its XML is the third
 * call of a load, `engine_get_process_definition_xml` of the version the counts name.
 */
export function DiagramSection({ processKey }: { readonly processKey: string }) {
  const t = useT()
  const section = useSection(
    (engine) => readDiagram(engine, processKey),
    [processKey],
    (diagram) => diagram.counts.asOf,
  )
  const version = section.data?.counts.version
  return (
    <Panel
      title={t("diagram.title")}
      hint={version === undefined ? undefined : t("diagram.scope", { version })}
      trailing={
        version === undefined ? undefined : <DiagramLegend scope={t("legend.scope", { version })} />
      }
    >
      <SectionState
        state={section.state}
        onRetry={section.retry}
        skeleton={<Skeleton className="w-full" style={{ height: SKELETON_HEIGHT }} />}
      >
        {({ counts, xml }) =>
          xml === null ? (
            <p className="text-muted-foreground m-0">{t("diagram.noXml")}</p>
          ) : (
            <BpmnDiagram
              xml={xml}
              decorations={counts.decorations}
              ariaLabel={t("diagram.label", {
                process: counts.processDefinitionName ?? processKey,
                version: counts.version,
              })}
              selectable={(element, count) => countTargets(element, count.kind).length > 0}
              onSelect={(element, count) => {
                goTo(countTargets(element, count.kind))
              }}
            />
          )
        }
      </SectionState>
    </Panel>
  )
}
