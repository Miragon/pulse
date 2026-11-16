import { useProblemWords } from "@miragon/pulse-blocks"
import {
  Button,
  Icon,
  StatusStrip,
  formatNumber,
  useLocale,
  type StatusStripTone,
} from "@miragon/pulse-ui"
import { describeError, type DescribedError } from "@miragon/pulse-widget-shell/widgets"
import { Server } from "lucide-react"
import { useT, type T } from "../../messages/use-t.js"
import type { BoardStartData } from "../../view-models.board.js"

type BoardEngine = BoardStartData["engines"][number]
type FailedEngine = Extract<BoardEngine, { state: "failed" }>
type ReadyEngine = Extract<BoardEngine, { state: "ready" }>

/**
 * The failures `describeError` words for an engine, with their tone: one that does not answer is
 * an outage (danger), a refused profile or login waits for whoever runs the server (warning, as
 * the landing's `HEALTH_FAILURE_TONE`). Its other kinds speak of an entry or a request, not of
 * an engine, so the board says it could not read the engine instead.
 */
const ENGINE_FAILURE_TONE: Partial<Record<DescribedError["kind"], StatusStripTone>> = {
  unreachable: "danger",
  timeout: "danger",
  profileRefused: "warning",
  unauthorized: "warning",
  forbidden: "warning",
}

/**
 * The board's own hints where `describeError`'s would send the user to another engine: a board
 * reads the engines its file names, so there is none to pick, and its other tiles still show.
 */
const BOARD_HINT: Partial<Record<DescribedError["kind"], string>> = {
  unreachable: "board.hint.unreachable",
  profileRefused: "board.hint.profileRefused",
}

/** The failure's text, naming its engine as the server's texts do, so the words name it too. */
function namedFailure({ name, failure }: FailedEngine): string {
  const text = failure.message ?? failure.code
  const named = text.includes(`(engine ${name})`) || text.includes(`Engine "${name}"`)
  return named ? text : `${text} (engine ${name})`
}

/** What to do about a failure `describeError` words for an engine: the board's hint, else its. */
function hintOf(t: T, described: DescribedError): string {
  const key = BOARD_HINT[described.kind]
  return key === undefined ? described.hint : t(key)
}

/**
 * A failed engine in the board's words, through `describeError`: what happened and what to do,
 * the engine's own text under Details.
 */
function FailedEngineStrip({ engine }: { readonly engine: FailedEngine }) {
  const t = useT()
  const locale = useLocale()
  const described = describeError({ message: namedFailure(engine) }, locale)
  const tone = ENGINE_FAILURE_TONE[described.kind]
  return (
    <StatusStrip
      tone={tone ?? "danger"}
      title={tone ? described.title : t("board.engineNotRead", { engine: engine.name })}
      detail={tone ? hintOf(t, described) : t("board.engineNotReadHint")}
      details={engine.failure.message}
    />
  )
}

/** A name the board gives that no profile of the server carries. */
function NotConfiguredStrip({ name }: { readonly name: string }) {
  const t = useT()
  return (
    <StatusStrip
      tone="warning"
      title={t("board.notConfigured", { engine: name })}
      detail={t("board.notConfiguredHint")}
    />
  )
}

/** The notes of the board's file: what Pulse shows without, each after its JSON path. */
function NotesStrip({ data }: { readonly data: BoardStartData }) {
  const t = useT()
  const say = useProblemWords()
  if (data.notes.length === 0) return null
  return (
    <StatusStrip
      tone="info"
      title={t("board.notes", { count: formatNumber(data.notes.length) })}
      details={data.notes.map((note) => `${note.path} ${say(note)}`).join("\n")}
    />
  )
}

/** The strips under the board's bar: each engine that was not read in its place, the file's notes. */
export function BoardStrips({ data }: { readonly data: BoardStartData }) {
  return (
    <>
      {data.engines.map((engine) =>
        engine.state === "failed" ? (
          <FailedEngineStrip key={engine.name} engine={engine} />
        ) : engine.state === "notConfigured" ? (
          <NotConfiguredStrip key={engine.name} name={engine.name} />
        ) : null,
      )}
      <NotesStrip data={data} />
    </>
  )
}

/** A ready engine's facts: its product and version, what runs and what has an incident there. */
function engineFacts(t: T, engine: ReadyEngine): string {
  const totals = engine.totals
  return [
    [engine.product, engine.version].filter((part) => part !== "").join(" "),
    totals && t("board.engine.running", { count: formatNumber(totals.running) }),
    totals && t("board.engine.withIncident", { count: formatNumber(totals.withIncident) }),
  ]
    .filter((fact) => fact !== undefined)
    .join(" · ")
}

/** The board's engines that answered, each a way into its overview in this cockpit. */
export function BoardEngines({
  data,
  onOpen,
}: {
  readonly data: BoardStartData
  readonly onOpen: (engine: string) => void
}) {
  const t = useT()
  const ready = data.engines.filter((engine): engine is ReadyEngine => engine.state === "ready")
  if (ready.length === 0) return null
  return (
    <div
      className="bg-card border-border px-gutter flex flex-wrap gap-x-3 gap-y-0.5 border-b py-1"
      role="group"
      aria-label={t("board.enginesLabel")}
    >
      {ready.map((engine) => (
        <Button
          key={engine.name}
          type="button"
          variant="ghost"
          size="sm"
          className="max-w-full min-w-0 gap-1.5 px-1.5 font-normal has-[>svg]:px-1.5"
          title={t("board.openEngineTitle", { engine: engine.name })}
          onClick={() => onOpen(engine.name)}
        >
          <Icon icon={Server} />
          <span className="font-semibold">{engine.name}</span>
          <span className="text-muted-foreground min-w-0 truncate">{engineFacts(t, engine)}</span>
        </Button>
      ))}
    </div>
  )
}
