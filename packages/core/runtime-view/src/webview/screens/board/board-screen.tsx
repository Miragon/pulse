import { ClipboardListIcon, FileCodeIcon, RotateCcwIcon } from "lucide-react"
import { BoardGrid, ProblemList, useNoteLines, useProblemWords } from "@miragon/pulse-blocks"
import { Card, Icon, LocaleProvider, SectionHeading, ViewBar } from "@miragon/pulse-ui"
import { useMemo } from "react"
import type { BoardView } from "../../../core/protocol/index.js"
import { BackTarget } from "../../components/back-target.js"
import { HeaderButton } from "../../components/header-button.js"
import { FreshnessStamp, type Freshness } from "../../components/live-stamp.js"
import { StatusStrip } from "../../components/status-strip.js"
import { CountLabels } from "../../format/count-labels.js"
import { useHost } from "../../host/host-context.js"
import { BoardDiagrams, DiagramXmls } from "./board-diagram.js"
import { BoardEngines } from "./board-engines.js"
import { BoardLabels } from "./board-labels.js"
import { useBoardSlots } from "./board-slots.js"

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

function NotesStrip({ view }: { readonly view: BoardView }) {
  const host = useHost()
  const lineOf = useNoteLines()
  if (view.notes.length === 0) {
    return null
  }
  return (
    <div className="min-w-0" data-part="board-notes">
      <StatusStrip
        tone="info"
        title={`${CountLabels.plural(view.notes.length, "note")} on this board.`}
        details={BoardLabels.notes(view, lineOf)}
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
    </div>
  )
}

function FileProblems({ view }: { readonly view: BoardView }) {
  const say = useProblemWords()
  if (view.problems.length === 0) {
    return null
  }
  const problems = view.problems.map((problem) => ({
    path: problem.path,
    text: BoardLabels.fileProblem(problem, say),
  }))
  return (
    <Card role="region" aria-labelledby="board-problems-title" className="border-danger gap-2">
      <SectionHeading
        as="h2"
        id="board-problems-title"
        title={`Problems in ${view.fileName}`}
        className="mb-0 px-3"
      />
      <div className="px-3">
        <ProblemList problems={problems} label={`Problems in ${view.fileName}`} />
      </div>
    </Card>
  )
}

function TileGrid({ view }: { readonly view: BoardView }) {
  const slots = useBoardSlots()
  const xmls = useMemo(() => BoardDiagrams.xmlsOf(view.rows), [view.rows])
  const rows = useMemo(
    () => view.rows.map((row) => row.map((tile) => BoardDiagrams.drawable(tile))),
    [view.rows],
  )
  if (rows.length === 0) {
    return null
  }
  return (
    <DiagramXmls value={xmls}>
      <BoardGrid rows={rows} slots={slots} />
    </DiagramXmls>
  )
}

export function BoardScreen({ view, freshness }: BoardScreenProps) {
  return (
    <LocaleProvider locale="en">
      <div className="grid h-full min-w-0 grid-rows-[auto_auto_minmax(0,1fr)]">
        <BoardHeader view={view} freshness={freshness} />
        <div className="flex min-w-0 flex-col" data-part="strips">
          <ProblemsStrip view={view} />
          <NotesStrip view={view} />
          <BoardEngines engines={view.engines} />
        </div>
        <main
          className="bg-background flex min-h-0 flex-col gap-3 overflow-auto p-3"
          aria-label={view.title}
        >
          <FileProblems view={view} />
          <TileGrid view={view} />
        </main>
      </div>
    </LocaleProvider>
  )
}
