import type { ReactNode } from "react"
import { Button, EmptyState, Icon } from "@miragon/pulse-ui"
import { OpenInCockpitLink, WidgetShell } from "@miragon/pulse-widget-shell/widgets"
import { ArrowLeft, Server } from "lucide-react"
import { useT } from "../../messages/use-t.js"
import type { ListedBoard } from "../../view-models.board.js"
import type { BoardsOnlyEngine } from "./boards-only.js"
import { BoardRow, type ServerBoards } from "./landing.js"

interface GateProps {
  engineId: string
  /** The server's boards as the engine list names them, for their titles; null before it answers. */
  boards: ServerBoards | null
  onOpenBoard: (board: string, title: string) => void
  /** Back to the chooser, where it shows: with more than one engine, or with boards. */
  onLanding?: () => void
}

/**
 * An engine the server reads on boards only (another dialect: `boardsOnly`, from the start data)
 * is the view's ONE state on every route: no section mounts, since every read of it would be
 * refused alike. The state reads nothing either: it names the boards that show the engine, each a
 * way in, or says that none does yet, and leads to the engine's own web app where its profile
 * names one. Its title is the route's heading (h1), as a route's view bar's is; its mark is an
 * engine's, as on the landing. Another engine renders its route (`children`).
 */
export function BoardsOnlyEngineGate({
  boardsOnly,
  children,
  ...props
}: GateProps & { boardsOnly: BoardsOnlyEngine | null; children: ReactNode }) {
  return boardsOnly ? <BoardsOnlyEngineState engine={boardsOnly} {...props} /> : children
}

/** A board by its id as the engine list names it, else by its id alone. */
function listedBoard(id: string, boards: ServerBoards | null): ListedBoard {
  return boards?.boards.find((board) => board.id === id) ?? { id, title: id, engines: [] }
}

function BoardsOnlyEngineState({
  engine,
  engineId,
  boards,
  onOpenBoard,
  onLanding,
}: GateProps & { engine: BoardsOnlyEngine }) {
  const t = useT()
  const listed = engine.boards.map((id) => listedBoard(id, boards))
  return (
    <WidgetShell>
      <div
        data-slot="boards-only-engine"
        className="gap-section mx-auto flex w-full max-w-3xl flex-col"
      >
        <EmptyState
          icon={<Icon icon={Server} />}
          titleAs="h1"
          title={t("cockpit.boardsOnly.title", { engine: engineId, product: engine.product })}
          description={t(
            listed.length > 0 ? "cockpit.boardsOnly.onBoards" : "cockpit.boardsOnly.noBoard",
          )}
        />
        {listed.length > 0 && (
          <ul
            aria-label={t("cockpit.boardsOnly.boards", { engine: engineId })}
            className="border-border bg-card divide-border divide-y overflow-hidden rounded-md border"
          >
            {listed.map((board) => (
              <li key={board.id}>
                <BoardRow board={board} onOpen={() => onOpenBoard(board.id, board.title)} />
              </li>
            ))}
          </ul>
        )}
        <WayOut engine={engine} onLanding={onLanding} />
      </div>
    </WidgetShell>
  )
}

/** The engine's own web app where its profile names one, and the way back to the chooser. */
function WayOut({ engine, onLanding }: { engine: BoardsOnlyEngine; onLanding?: () => void }) {
  const t = useT()
  const { webApp, webAppUrl } = engine
  if (webAppUrl === undefined && onLanding === undefined) return null
  return (
    <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-2">
      {webAppUrl !== undefined && (
        <>
          <p className="text-dense text-muted-foreground">
            {t("cockpit.boardsOnly.webApp", { webApp })}
          </p>
          <OpenInCockpitLink url={webAppUrl} vendor={webApp} />
        </>
      )}
      {onLanding && (
        <Button type="button" variant="outline" onClick={onLanding}>
          <Icon icon={ArrowLeft} />
          {t("cockpit.crumb.allEngines")}
        </Button>
      )}
    </div>
  )
}
