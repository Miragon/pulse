import { CircleXIcon, FileCodeIcon } from "lucide-react"
import { Button, Icon, TONE_ICON } from "@miragon/pulse-ui"
import type { BoardProblem, RefusedTile } from "../../../core/protocol/index.js"
import { useHost } from "../../host/host-context.js"
import { BoardCard } from "./board-card.js"

export interface ProblemListProps {
  readonly problems: readonly BoardProblem[]
  readonly label: string
}

export function ProblemList({ problems, label }: ProblemListProps) {
  return (
    <ul className="flex min-w-0 flex-col gap-1 [overflow-wrap:anywhere]" aria-label={label}>
      {problems.map((problem) => (
        <li key={`${problem.path} ${problem.reason}`}>
          <code>{problem.path}</code> {problem.reason}
        </li>
      ))}
    </ul>
  )
}

export function RefusedCard({ tile }: { readonly tile: RefusedTile }) {
  const host = useHost()
  return (
    <BoardCard title={tile.title} kind="refused">
      <p className="text-foreground inline-flex items-center gap-1.5" data-part="refused-reason">
        <Icon icon={CircleXIcon} className={TONE_ICON.danger} />
        Pulse reads nothing for this widget until you fix it.
      </p>
      <ProblemList problems={tile.problems} label="Problems of this widget" />
      <p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          title="Open the board file"
          onClick={() => {
            host.post({ type: "openBoardFile" })
          }}
        >
          <Icon icon={FileCodeIcon} />
          Open file
        </Button>
      </p>
    </BoardCard>
  )
}
