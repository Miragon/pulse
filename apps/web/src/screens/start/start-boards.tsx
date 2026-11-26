import type { ScreenSlots } from "@miragon/pulse-blocks"
import { formatCount, Icon, SectionHeading, TONE_ICON } from "@miragon/pulse-ui"
import { Ban } from "lucide-react"
import type { ListedEngines } from "../../engine-list.js"
import { useT } from "../../messages/index.js"
import type { Navigate } from "../../router/page-link.js"
import { urlOf } from "../../router/routes.js"

type Board = NonNullable<ListedEngines["boards"]>[number]
type RefusedBoard = NonNullable<ListedEngines["refusedBoards"]>[number]

/**
 * The server's board files that give no board: each by its id and its count of problems in the
 * warning tone of a refused profile, opening nothing, and where their problems are.
 */
function RefusedBoards({ files }: { files: readonly RefusedBoard[] }) {
  const t = useT()
  return (
    <div className="text-muted-foreground mt-2 flex flex-col gap-1" data-part="refused-boards">
      <ul className="flex flex-col gap-1">
        {files.map(({ id, problems }) => (
          <li key={id} className="flex items-center gap-2" data-status="refused">
            <Icon icon={Ban} className={TONE_ICON.warning} />
            <span>
              <span className="text-foreground font-semibold">{id}</span>
              {` · ${t("screen.start.boards.refused", { count: formatCount(problems) })}`}
            </span>
          </li>
        ))}
      </ul>
      <p>{t("screen.start.boards.refusedHint")}</p>
    </div>
  )
}

/**
 * The server's boards on the start page: a row per board over the page's table, its title and the
 * engines it names, opening the board's page by the one row convention (a link, a new tab with
 * Ctrl or Cmd, its id copied with Ctrl or Cmd and C); under it the board files that give no board.
 */
export function StartBoards({
  boards,
  refused,
  slots,
  navigate,
}: {
  boards: readonly Board[]
  refused: readonly RefusedBoard[]
  slots: Pick<ScreenSlots, "Table">
  navigate: Navigate
}) {
  const t = useT()
  const { Table } = slots
  const addressOf = (board: Board) => urlOf({ view: "board", board: board.id })
  return (
    <section data-part="start-boards">
      <SectionHeading as="h2" title={t("screen.start.boards")} />
      {boards.length > 0 && (
        <Table<Board>
          name="boards"
          label={t("screen.start.boards")}
          columns={[
            {
              key: "board",
              label: t("screen.start.boards.column.board"),
              cell: (board) => <span className="font-semibold">{board.title}</span>,
            },
            {
              key: "engines",
              label: t("screen.start.boards.column.engines"),
              cell: (board) => board.engines.join(", "),
              hideBelow: "40rem",
            },
          ]}
          rows={boards}
          rowKey={(board) => board.id}
          onOpen={(board) => {
            navigate(addressOf(board))
          }}
          linkOf={addressOf}
          rowLabel={(board) => t("screen.start.boards.row", { title: board.title })}
          copyOf={(board) => ({ text: board.id, label: t("screen.start.boards.id") })}
          empty=""
        />
      )}
      {refused.length > 0 && <RefusedBoards files={refused} />}
    </section>
  )
}
