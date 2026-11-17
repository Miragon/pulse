import { useMemo, useState } from "react"
import { BoardGrid, type BoardSlots } from "@miragon/pulse-blocks"
import {
  Button,
  Icon,
  ViewBar,
  cn,
  formatClock,
  formatInstant,
  formatNumber,
} from "@miragon/pulse-ui"
import {
  HostModelContext,
  WidgetShell,
  useDetailView,
  useQueryClient,
} from "@miragon/pulse-widget-shell/widgets"
import { ClipboardList, Clock, RefreshCw } from "lucide-react"
import { useT } from "../../messages/use-t.js"
import { ENGINE_BOARD_DATA } from "../../tool-names.js"
import type { BoardStartData } from "../../view-models.board.js"
import { boardContext } from "../cockpit-app/model-context.js"
import { useHandOff } from "../lib/hand-off.js"
import { useNav } from "../navigation.js"
import { BoardDiagram } from "./board-diagram.js"
import { BoardId } from "./board-id.js"
import { BoardEngines, BoardStrips } from "./board-strips.js"
import { BoardTable } from "./board-table.js"
import { engineTargetOf } from "./board-targets.js"

/** The board's query: under the cockpit's `engine:` root, so a write's refresh reaches it too. */
const boardQueryKey = (board: string) => ["engine:board", board] as const

/**
 * Reads every engine of the board again. The server keeps a build for 30 seconds per caller and
 * board, so a refresh within them shows the same numbers and the same time, which the bar states.
 */
function BoardRefreshButton({ board }: { readonly board: string }) {
  const t = useT()
  const client = useQueryClient()
  const [refreshing, setRefreshing] = useState(false)
  return (
    <Button
      type="button"
      variant="toolbar"
      size="sm"
      disabled={refreshing}
      title={t("board.refreshTitle")}
      onClick={() => {
        setRefreshing(true)
        void client
          .invalidateQueries({ queryKey: boardQueryKey(board) })
          .finally(() => setRefreshing(false))
      }}
    >
      <Icon icon={RefreshCw} className={cn(refreshing && "motion-safe:animate-spin")} />
      {t(refreshing ? "board.refreshing" : "board.refresh")}
    </Button>
  )
}

/** The board's bar: its title, its engines, its Refresh and the time its numbers were read. */
function BoardBar({ board, data }: { readonly board: string; readonly data: BoardStartData }) {
  const t = useT()
  const names = data.engines.map((engine) => engine.name).join(", ")
  return (
    <ViewBar
      title={data.title}
      icon={<Icon icon={ClipboardList} />}
      facts={
        data.engines.length > 0 ? (
          <span className="min-w-0 truncate">
            {t("board.engines", { count: formatNumber(data.engines.length), names })}
          </span>
        ) : undefined
      }
      actions={<BoardRefreshButton board={board} />}
      freshness={
        <span title={formatInstant(data.asOf)} className="inline-flex items-center gap-1.5">
          <Icon icon={Clock} />
          {t("board.asOf", { time: formatClock(data.asOf, { seconds: false }) })}
        </span>
      }
    />
  )
}

/** The cockpit's slots for the tiles: its table, its id, its diagram, a target onto its routes. */
function useBoardSlots(data: BoardStartData | null): BoardSlots {
  const go = useNav()
  return useMemo(
    () => ({
      Table: BoardTable,
      Id: BoardId,
      Diagram: BoardDiagram,
      onOpen: (target) => {
        if (data) go({ type: "board-target", ...engineTargetOf(target, data) })
      },
    }),
    [data, go],
  )
}

/**
 * A board of the server's board files, the cockpit's app-level route: the tiles Pulse for VS
 * Code and Pulse for Orca show (`@miragon/pulse-blocks`) with the cockpit's slots, over the board
 * feed (`engine_board_data`), seeded with the start data of `engine_open_cockpit`. Each engine that
 * was not read says so in its place; a tile opens the engine's own route here.
 */
export function BoardView({
  board,
  data: initialData = null,
  title,
}: {
  readonly board: string
  readonly data?: BoardStartData | null
  /** The route's title before the board's own: its id, or the title the board had where it opened. */
  readonly title?: string
}) {
  const t = useT()
  const { context } = useHandOff()
  const go = useNav()
  const { data, guard, notice } = useDetailView<BoardStartData>({
    initialData,
    key: boardQueryKey(board),
    tool: ENGINE_BOARD_DATA,
    args: { board },
    ready: true,
    loadingText: t("board.loading"),
    emptyText: t("board.empty"),
    refreshErrorTitle: t("board.refreshFailed"),
    title,
  })
  const slots = useBoardSlots(data)
  if (!data) return guard
  return (
    <WidgetShell
      header={
        <>
          <BoardBar board={board} data={data} />
          {notice}
          <BoardStrips data={data} />
          <BoardEngines
            data={data}
            onOpen={(engine) => go({ type: "board-target", engine, view: { section: "overview" } })}
          />
        </>
      }
    >
      <HostModelContext content={context(boardContext(board, data))}>{null}</HostModelContext>
      <BoardGrid rows={data.rows} slots={slots} />
    </WidgetShell>
  )
}
