import type { ReactNode } from "react"
import {
  Button,
  cn,
  FOCUS_RING_INSET,
  TONE_DOT,
  TONE_ICON,
  useLocale,
  Icon,
  KometMark,
  WidgetHeader,
  formatNumber,
  type ToneVariant,
  SectionHeading,
} from "@miragon/pulse-ui"
import { WidgetShell } from "@miragon/pulse-widget-shell/widgets"
import {
  ArrowRight,
  Ban,
  CircleDashed,
  ClipboardList,
  KeyRound,
  Layers,
  LoaderCircle,
  Unplug,
  type LucideIcon,
} from "lucide-react"
import { DEFAULT_ENVIRONMENT_ID, groupEnginesByEnvironment } from "../../lib/shared/environments.js"
import { translator } from "../../messages/use-t.js"
import type { ListedBoard, ListedRefusedBoard } from "../../view-models.board.js"
import {
  HEALTH_FAILURE_TONE,
  healthFailureOf,
  isHealthFailure,
  type HealthFailure,
} from "../lib/health-verdict.js"
import { useEngineHealth } from "./engine-health.js"

/** In words, so colour is never the only signal. */
export type EngineStatusKind =
  "loading" | HealthFailure | "empty" | "incidents" | "failedJobs" | "idle" | "healthy"

/**
 * #322 U15, from the same live health as the engine's overview. A profile the server refused and
 * an engine that refused the server's login are states of their own (`healthFailureOf`): the
 * server never asks the one, and the other answered, so neither is unreachable.
 */
export function engineStatusKind(health: {
  isError: boolean
  error: unknown
  summary:
    | {
        totalDefinitions: number
        totalRunningInstances: number
        totalFailedJobs: number
        totalIncidents: number
      }
    | undefined
}): EngineStatusKind {
  if (health.isError) return healthFailureOf(health.error)
  const s = health.summary
  if (!s) return "loading"
  if (s.totalDefinitions === 0) return "empty"
  if (s.totalIncidents > 0) return "incidents"
  if (s.totalFailedJobs > 0) return "failedJobs"
  if (s.totalRunningInstances === 0) return "idle"
  return "healthy"
}

/** A refused login is the server's key, whether the engine rejected it (401) or its access (403). */
const FAILURE_ICON: Readonly<Record<HealthFailure, LucideIcon>> = {
  unreachable: Unplug,
  refused: Ban,
  unauthorized: KeyRound,
  forbidden: KeyRound,
}

/** CI §3.7; the dot is the engine's one live verdict, the overview badge's tone. */
function StatusMark({ kind, tone }: { kind: EngineStatusKind; tone: ToneVariant }) {
  if (kind === "loading") {
    return <Icon icon={LoaderCircle} className="text-muted-foreground motion-safe:animate-spin" />
  }
  if (isHealthFailure(kind)) {
    return <Icon icon={FAILURE_ICON[kind]} className={TONE_ICON[HEALTH_FAILURE_TONE[kind]]} />
  }
  if (kind === "empty") return <Icon icon={CircleDashed} className="text-muted-foreground" />
  return (
    <span className="inline-flex size-4 items-center justify-center" aria-hidden="true">
      <span className={cn("size-2 rounded-full", TONE_DOT[tone])} />
    </span>
  )
}

/** A row of the chooser's lists: one 28 px line (40 px on touch) of 13 px text. */
const ROW = "text-dense min-h-row px-cell py-cell flex w-full items-center gap-3 text-left"

/** The way into a row's view, after its words. */
function RowArrow() {
  return <Icon icon={ArrowRight} dense className="text-muted-foreground" />
}

/** The state sits inside the button, so it is part of its accessible name. */
function EngineRow({
  engineId,
  isDefault,
  onEnter,
}: {
  engineId: string
  isDefault: boolean
  onEnter: () => void
}) {
  const locale = useLocale()
  const tr = (key: string, params?: Record<string, unknown>) => translator(locale, key, params)
  const { query, summary, tone } = useEngineHealth(engineId)
  const kind = engineStatusKind({ isError: query.isError, error: query.error, summary })
  const status =
    kind === "incidents"
      ? tr("cockpit.landing.status.incidents", {
          count: formatNumber(summary?.totalIncidents ?? 0),
        })
      : kind === "failedJobs"
        ? tr("cockpit.landing.status.failedJobs", {
            count: formatNumber(summary?.totalFailedJobs ?? 0),
          })
        : tr(`cockpit.landing.status.${kind}`)
  return (
    <button
      type="button"
      onClick={onEnter}
      data-status={kind}
      className={cn("hover:bg-accent transition-colors", ROW, FOCUS_RING_INSET)}
    >
      <StatusMark kind={kind} tone={tone} />
      <span className="text-foreground min-w-0 truncate font-semibold">{engineId}</span>
      {isDefault && (
        <span className="border-input text-muted-foreground text-small shrink-0 rounded-sm border px-1.5">
          {tr("cockpit.landing.default")}
        </span>
      )}
      {/* A comma for the accessible name ("prod-a, 18 Incidents"); the eye reads the gap. */}
      <span className="sr-only">, </span>
      <span className="text-muted-foreground ms-auto shrink-0 text-right">{status}</span>
      <RowArrow />
    </button>
  )
}

/** The server's boards, and its board files that give no board, by their problem count. */
export interface ServerBoards {
  boards: readonly ListedBoard[]
  refusedBoards: readonly ListedRefusedBoard[]
}

/**
 * A board opens as the cockpit's board view, marked as its view bar marks it; its engines sit
 * inside the button, in its name. They take only the room the title leaves, so a narrow row cuts
 * them before the title that names the board.
 */
function BoardRow({ board, onOpen }: { board: ListedBoard; onOpen: () => void }) {
  const locale = useLocale()
  const engines = translator(locale, "board.engines", {
    count: formatNumber(board.engines.length),
    names: board.engines.join(", "),
  })
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn("hover:bg-accent transition-colors", ROW, FOCUS_RING_INSET)}
    >
      <Icon icon={ClipboardList} className="text-muted-foreground" />
      <span className="text-foreground min-w-0 truncate font-semibold">{board.title}</span>
      <span className="sr-only">, </span>
      <span className="text-muted-foreground min-w-0 flex-1 truncate text-right">{engines}</span>
      <RowArrow />
    </button>
  )
}

/**
 * A board file that gives no board opens nothing: its id, refused in the tone of a refused
 * profile, and how many problems it has. Their words are in the server's log at startup.
 */
function RefusedBoardRow({ id, problems }: { id: string; problems: number }) {
  const locale = useLocale()
  return (
    <div className={ROW} data-status="refused">
      <Icon icon={Ban} className={TONE_ICON.warning} />
      <span className="text-foreground min-w-0 truncate font-semibold">{id}</span>
      <span className="sr-only">, </span>
      <span className="text-muted-foreground ms-auto shrink-0 text-right">
        {translator(locale, "cockpit.landing.boardRefused", { count: formatNumber(problems) })}
      </span>
      {/* Where the other rows have their way in: the words end where theirs do. */}
      <span className="size-3 shrink-0" aria-hidden="true" />
    </div>
  )
}

/** The boards under the engines: each opens on a click, a refused file says why it does not. */
function BoardList({
  boards,
  onOpenBoard,
}: {
  boards: ServerBoards
  onOpenBoard: (board: string, title: string) => void
}) {
  const locale = useLocale()
  const title = translator(locale, "cockpit.landing.boards")
  return (
    <section aria-label={title} className="flex flex-col gap-2">
      <SectionHeading as="h2" title={title} className="mb-0" />
      <ul className="border-border bg-card divide-border divide-y overflow-hidden rounded-md border">
        {boards.boards.map((board) => (
          <li key={board.id}>
            <BoardRow board={board} onOpen={() => onOpenBoard(board.id, board.title)} />
          </li>
        ))}
        {boards.refusedBoards.map((file) => (
          <li key={file.id}>
            <RefusedBoardRow id={file.id} problems={file.problems} />
          </li>
        ))}
      </ul>
      {boards.refusedBoards.length > 0 && (
        <p className="text-muted-foreground text-small">
          {translator(locale, "cockpit.landing.boardRefusedHint")}
        </p>
      )}
    </section>
  )
}

/**
 * #322 U15: hangs on the theme slot a customer brand empties (`--brand-mark-display: none`). The
 * title is the app-level one (`WidgetHeader` `size="app"`), the signature above it.
 */
export function LandingHeader({ subtitle, action }: { subtitle?: string; action?: ReactNode }) {
  const locale = useLocale()
  return (
    <div className="flex min-w-0 items-center gap-4">
      <KometMark />
      <div className="min-w-0 flex-1">
        <p
          data-brand-signature=""
          className="text-muted-foreground text-small font-semibold"
          style={{ display: "var(--brand-mark-display, block)" }}
        >
          {translator(locale, "cockpit.signature")}
        </p>
        <WidgetHeader
          size="app"
          title={translator(locale, "cockpit.landing.title")}
          sub={subtitle}
          actions={action}
        />
      </div>
    </div>
  )
}

/** What the chooser offers: its engines, in environments where they are named, and its boards. */
function subtitleKey(named: boolean, boards: ServerBoards | null): string {
  if (boards && boards.boards.length > 0) return "cockpit.landing.subtitle.boards"
  return named ? "cockpit.landing.subtitle.env" : "cockpit.landing.subtitle"
}

/**
 * The same live health and verdict as the engine's own overview (#322 U15). With `boards` (the
 * server's ENGINE_BOARDS_DIR) the boards follow the engines, which then have a heading of their
 * own where no environment names them.
 */
export function LandingChooser({
  engines,
  defaultEngineId,
  onEnterEngine,
  onOpenFleet,
  boards = null,
  onOpenBoard = () => {},
  notice,
}: {
  engines: Array<{ id: string; environment?: string }>
  defaultEngineId?: string | null
  onEnterEngine: (id: string) => void
  /** Omitted with a single engine. */
  onOpenFleet?: () => void
  /** Null without boards: the chooser shows the engines alone. */
  boards?: ServerBoards | null
  onOpenBoard?: (board: string, title: string) => void
  notice?: ReactNode
}) {
  const locale = useLocale()
  const tr = (key: string, params?: Record<string, unknown>) => translator(locale, key, params)
  const groups = groupEnginesByEnvironment(engines)
  const named = groups.length > 1 || groups[0]?.id !== DEFAULT_ENVIRONMENT_ID
  // Beside the boards, the engines have a heading too: an environment's, else "Engines".
  const headed = named || boards !== null
  const groupTitle = (id: string) => (named ? id : tr("cockpit.landing.engines"))
  const groupLabel = (id: string) =>
    named ? tr("cockpit.landing.envLabel", { env: id }) : tr("cockpit.landing.engines")
  const subtitle = tr(subtitleKey(named, boards), {
    count: formatNumber(engines.length),
    envCount: formatNumber(groups.length),
    boardCount: formatNumber(boards?.boards.length ?? 0),
  })
  return (
    <WidgetShell header={notice}>
      <div className="gap-section mx-auto flex w-full max-w-3xl flex-col">
        <LandingHeader
          subtitle={subtitle}
          action={
            onOpenFleet && (
              <Button type="button" variant="outline" onClick={onOpenFleet}>
                <Icon icon={Layers} />
                {tr("cockpit.landing.fleet.open")}
              </Button>
            )
          }
        />
        {groups.map((g) => (
          <section
            key={g.id}
            aria-label={headed ? groupLabel(g.id) : undefined}
            className="flex flex-col gap-2"
          >
            {headed && <SectionHeading as="h2" title={groupTitle(g.id)} className="mb-0" />}
            <ul className="border-border bg-card divide-border divide-y overflow-hidden rounded-md border">
              {g.engines.map((e) => (
                <li key={e.id}>
                  <EngineRow
                    engineId={e.id}
                    isDefault={e.id === defaultEngineId}
                    onEnter={() => onEnterEngine(e.id)}
                  />
                </li>
              ))}
            </ul>
          </section>
        ))}
        {boards && <BoardList boards={boards} onOpenBoard={onOpenBoard} />}
      </div>
    </WidgetShell>
  )
}
