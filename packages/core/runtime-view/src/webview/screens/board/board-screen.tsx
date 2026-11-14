import { ClipboardListIcon, FileCodeIcon, RotateCcwIcon } from "lucide-react"
import { Card, Icon, SectionHeading, ViewBar } from "@miragon/pulse-ui"
import type { BoardTile, BoardView } from "../../../core/protocol/index.js"
import { BackTarget } from "../../components/back-target.js"
import { HeaderButton } from "../../components/header-button.js"
import { FreshnessStamp, type Freshness } from "../../components/live-stamp.js"
import { StatusStrip } from "../../components/status-strip.js"
import { CountLabels } from "../../format/count-labels.js"
import { useHost } from "../../host/host-context.js"
import { BoardEngines } from "./board-engines.js"
import { BoardLabels } from "./board-labels.js"
import { CounterCard } from "./counter-card.js"
import { IncidentListCard } from "./incident-list-card.js"
import { IncidentSummaryCard } from "./incident-summary-card.js"
import { InstanceListCard } from "./instance-list-card.js"
import { ProcessDiagramCard } from "./process-diagram-card.js"

export interface BoardScreenProps {
  readonly view: BoardView
  readonly freshness: Freshness
}

function BoardHeader({ view, freshness }: BoardScreenProps) {
  const host = useHost()
  return (
    <div data-part="context-bar" data-kind="board">
      <ViewBar
        title={view.title}
        {...BackTarget.propsOf(host)}
        icon={<Icon icon={ClipboardListIcon} />}
        facts={
          view.engines.length > 0 ? (
            <span className="min-w-0 truncate" data-part="context-key">
              {BoardLabels.scope(view)}
            </span>
          ) : undefined
        }
        actions={
          <>
            <HeaderButton
              icon={RotateCcwIcon}
              label="Refresh"
              title="Read every engine of this board again"
              intent={{ type: "refresh" }}
            />
            <HeaderButton
              icon={FileCodeIcon}
              label="Open file"
              title={`Open ${view.fileName}`}
              intent={{ type: "openBoardFile" }}
            />
          </>
        }
        freshness={<FreshnessStamp freshness={freshness} />}
      />
    </div>
  )
}

function ProblemsStrip({ view }: { readonly view: BoardView }) {
  const host = useHost()
  if (view.problems.length === 0) {
    return null
  }
  return (
    <StatusStrip
      tone="danger"
      title={`${CountLabels.plural(view.problems.length, "problem")} in ${view.fileName}.`}
      detail={BoardLabels.problems(view)}
      actions={[
        {
          label: "Open file",
          icon: FileCodeIcon,
          onClick: () => {
            host.post({ type: "openBoardFile" })
          },
        },
      ]}
    />
  )
}

function ProblemList({ view }: { readonly view: BoardView }) {
  if (view.problems.length === 0) {
    return null
  }
  return (
    <Card role="region" aria-labelledby="board-problems-title" className="border-danger gap-2">
      <SectionHeading
        as="h2"
        id="board-problems-title"
        title={`Problems in ${view.fileName}`}
        className="mb-0 px-3"
      />
      <ul className="flex flex-col gap-1 px-3">
        {view.problems.map((problem) => (
          <li key={`${problem.path} ${problem.reason}`}>
            <code>{problem.path}</code> {problem.reason}
          </li>
        ))}
      </ul>
    </Card>
  )
}

function Tile({ tile }: { readonly tile: BoardTile }) {
  switch (tile.kind) {
    case "counter":
      return <CounterCard tile={tile} />
    case "instanceList":
      return <InstanceListCard tile={tile} />
    case "incidentSummary":
      return <IncidentSummaryCard tile={tile} />
    case "processDiagram":
      return <ProcessDiagramCard tile={tile} />
    case "incidentList":
      return <IncidentListCard tile={tile} />
  }
}

export function BoardScreen({ view, freshness }: BoardScreenProps) {
  return (
    <div className="grid h-full min-w-0 grid-rows-[auto_auto_minmax(0,1fr)]">
      <BoardHeader view={view} freshness={freshness} />
      <div className="flex min-w-0 flex-col" data-part="strips">
        <ProblemsStrip view={view} />
        <BoardEngines engines={view.engines} />
      </div>
      <main
        className="bg-background @container/board flex min-h-0 flex-col gap-3 overflow-auto p-3"
        aria-label={view.title}
      >
        <ProblemList view={view} />
        {view.rows.map((row, index) => (
          <div
            className="grid min-w-0 auto-cols-[minmax(0,1fr)] grid-flow-col gap-3 @max-[760px]/board:grid-flow-row"
            key={index}
          >
            {row.map((tile, column) => (
              <Tile key={column} tile={tile} />
            ))}
          </div>
        ))}
      </main>
    </div>
  )
}
