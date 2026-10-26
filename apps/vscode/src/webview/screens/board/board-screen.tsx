import type { BoardTile, BoardView } from "../../../core/protocol/index.js"
import { BackButton } from "../../components/back-button.js"
import { HeaderButton } from "../../components/header-button.js"
import { Icon } from "../../components/icon.js"
import { FreshnessStamp, type Freshness } from "../../components/live-stamp.js"
import { glyphs } from "../../components/lucide-glyphs.json"
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
  return (
    <header class="context-bar context-bar--board">
      <div class="context-bar__subject">
        <BackButton class="context-bar__back" />
        <Icon of={glyphs.ClipboardList} />
        <h1 class="context-bar__title">{view.title}</h1>
        {view.engines.length > 0 && (
          <span class="context-bar__key context-bar__shrink">{BoardLabels.scope(view)}</span>
        )}
        <HeaderButton
          icon={glyphs.RotateCcw}
          label="Refresh"
          title="Read every engine of this board again"
          intent={{ type: "refresh" }}
        />
        <HeaderButton
          icon={glyphs.FileCode}
          label="Open file"
          title={`Open ${view.fileName}`}
          intent={{ type: "openBoardFile" }}
        />
      </div>
      <div class="context-bar__meta">
        <FreshnessStamp freshness={freshness} />
      </div>
    </header>
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
          icon: glyphs.FileCode,
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
    <section class="board-card board-problems" aria-labelledby="board-problems-title">
      <h2 id="board-problems-title" class="board-card__title">{`Problems in ${view.fileName}`}</h2>
      <ul class="board-problems__list">
        {view.problems.map((problem) => (
          <li key={`${problem.path} ${problem.reason}`} class="board-problems__item">
            <code>{problem.path}</code> {problem.reason}
          </li>
        ))}
      </ul>
    </section>
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
    <div class="screen screen--with-strips">
      <BoardHeader view={view} freshness={freshness} />
      <div class="strip-stack">
        <ProblemsStrip view={view} />
        <BoardEngines engines={view.engines} />
      </div>
      <main class="board" aria-label={view.title}>
        <ProblemList view={view} />
        {view.rows.map((row, index) => (
          <div class="board__row" key={index}>
            {row.map((tile, column) => (
              <Tile key={column} tile={tile} />
            ))}
          </div>
        ))}
      </main>
    </div>
  )
}
