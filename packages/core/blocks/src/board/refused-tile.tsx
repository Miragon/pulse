import { CircleXIcon, FileCodeIcon } from "lucide-react"
import { Button, Icon, TONE_ICON } from "@miragon/pulse-ui"
import type { RefusedData } from "@miragon/pulse-board"
import { useWords } from "../messages/translate.js"
import { BoardCard } from "./board-card.js"
import { useProblemWords } from "./problem-words.js"
import type { BoardSlots } from "./slots.js"
import { tileTitle } from "./tile-words.js"

/** A problem of a board file as a person reads it: its JSON path and what is wrong there. */
export interface ProblemLine {
  readonly path: string
  readonly text: string
}

export interface ProblemListProps {
  readonly problems: readonly ProblemLine[]
  /** Names the list. */
  readonly label: string
}

/** The problems of a board file or of a widget, each its path and its words. */
export function ProblemList({ problems, label }: ProblemListProps) {
  return (
    <ul className="flex min-w-0 flex-col gap-1 [overflow-wrap:anywhere]" aria-label={label}>
      {problems.map((problem) => (
        <li key={`${problem.path} ${problem.text}`}>
          <code>{problem.path}</code> {problem.text}
        </li>
      ))}
    </ul>
  )
}

export interface RefusedTileProps {
  readonly tile: RefusedData
  readonly slots: Pick<BoardSlots, "onOpenFile">
}

/** A widget the file breaks, in its place: why it reads nothing and the way to the file. */
export function RefusedTile({ tile, slots }: RefusedTileProps) {
  const t = useWords()
  const say = useProblemWords()
  const { onOpenFile } = slots
  return (
    <BoardCard title={tileTitle(t, tile)} kind="refused">
      <p className="text-foreground inline-flex items-center gap-1.5" data-part="refused-reason">
        <Icon icon={CircleXIcon} className={TONE_ICON.danger} />
        {t("refused.reason")}
      </p>
      <ProblemList
        problems={tile.problems.map((problem) => ({ path: problem.path, text: say(problem) }))}
        label={t("refused.problems")}
      />
      {onOpenFile !== undefined && (
        <p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            title={t("refused.openFileTitle")}
            onClick={() => {
              onOpenFile()
            }}
          >
            <Icon icon={FileCodeIcon} />
            {t("refused.openFile")}
          </Button>
        </p>
      )}
    </BoardCard>
  )
}
