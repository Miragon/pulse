import {
  cn,
  Icon,
  READ_FAILURE_TONES,
  type ReadFailure,
  StatusBadge,
  TONE_DOT,
  TONE_ICON,
  type ToneVariant,
  VERDICT_TONES,
  type Verdict,
} from "@miragon/pulse-ui"
import {
  Ban,
  CircleDashed,
  CircleX,
  KeyRound,
  TriangleAlert,
  Unplug,
  type LucideIcon,
} from "lucide-react"
import type { EnginesWordKey } from "../../messages/engines-en.js"
import { useEnginesWords } from "../../messages/engines-words.js"

/**
 * An engine's live state where a surface shows it: the verdict the server decided (`ok`,
 * `warning`, `critical`: c7-core's one verdict over a Camunda 7 engine's open root incidents, which
 * a surface reads and never decides), why its read failed (the engine module's failed reads), still
 * reading, not read for a reason that is not the engine's (a page's ended session), or none where
 * the server decides no verdict (a Camunda 8 engine).
 */
export type EngineVerdict = Verdict | ReadFailure | "loading" | "unread" | "none"

/** The figures of the engine's screen the state reads beside its verdict: an empty engine's. */
export interface EngineVerdictFigures {
  readonly processes: number
  readonly incidents: number
}

/** What a state shows: a verdict, a failed read, or an engine with nothing deployed. */
type Shown = Verdict | ReadFailure | "empty"

/**
 * What `verdict` shows: an engine with nothing deployed and no open root incident whose verdict is
 * ok is Empty, neutral, never a check over an empty engine (as the chat's overview badge says);
 * nothing while it reads, where it was not read or where the server decides none.
 */
function shownOf(
  verdict: EngineVerdict,
  figures: EngineVerdictFigures | undefined,
): Shown | undefined {
  if (verdict === "loading" || verdict === "unread" || verdict === "none") return undefined
  const empty = figures !== undefined && figures.processes === 0 && figures.incidents === 0
  return verdict === "ok" && empty ? "empty" : verdict
}

/** The tone of what shows: the kit's tables of a verdict and of a failed read. */
function toneOf(shown: Shown): ToneVariant {
  if (shown === "empty") return VERDICT_TONES.ok
  return shown in VERDICT_TONES
    ? VERDICT_TONES[shown as Verdict]
    : READ_FAILURE_TONES[shown as ReadFailure]
}

/** A failed read's icon of its own shape: the outage, the refused profile, the server's key. */
const FAILURE_ICON: Readonly<Record<ReadFailure, LucideIcon>> = {
  unreachable: Unplug,
  refused: Ban,
  unauthorized: KeyRound,
  forbidden: KeyRound,
}

/**
 * A verdict that is no ok's dot: a degraded engine's triangle, a critical one's crossed circle, the
 * kit's glyphs of the warning and danger tones (`CountFigure`'s, `StatusStrip`'s).
 */
const VERDICT_ICON: Readonly<Record<Exclude<Verdict, "ok">, LucideIcon>> = {
  warning: TriangleAlert,
  critical: CircleX,
}

/**
 * The mark of what shows, each of its own shape, so its state reads without colour too (forced
 * colours, colour vision, a narrow region that shows the mark alone): an ok engine's dot in its
 * tone, a degraded or critical one's glyph in its tone, an empty engine's dashed circle, a failed
 * read's icon in its tone (no verdict).
 */
function Mark({ shown }: { readonly shown: Shown }) {
  if (shown === "empty") return <Icon icon={CircleDashed} className="text-muted-foreground" />
  if (shown in FAILURE_ICON) {
    const failure = shown as ReadFailure
    return <Icon icon={FAILURE_ICON[failure]} className={TONE_ICON[READ_FAILURE_TONES[failure]]} />
  }
  if (shown !== "ok") {
    const verdict = shown as Exclude<Verdict, "ok">
    return <Icon icon={VERDICT_ICON[verdict]} className={TONE_ICON[VERDICT_TONES[verdict]]} />
  }
  return (
    <span className="inline-flex size-4 shrink-0 items-center justify-center" aria-hidden="true">
      <span data-part="verdict" className={cn("size-2 rounded-full", TONE_DOT[VERDICT_TONES.ok])} />
    </span>
  )
}

/** The word of a state, by its key in the catalog of the tables across engines. */
const wordKey = (shown: Shown): EnginesWordKey => `engines.verdict.${shown}`

/**
 * An engine's live state as the bar of its screen shows it, the header's badge: the verdict's word
 * in its tone (Empty for an ok engine with nothing deployed, `figures`), a failed read's word in the
 * tone of a failed read, nothing while it reads, where it was not read or where the server decides
 * no verdict.
 */
export function EngineVerdictBadge({
  verdict,
  figures,
}: {
  readonly verdict: EngineVerdict
  /** The engine screen's figures, once read: an ok engine with nothing deployed is Empty. */
  readonly figures?: EngineVerdictFigures
}) {
  const t = useEnginesWords()
  const shown = shownOf(verdict, figures)
  if (shown === undefined) return null
  return (
    <span data-part="engine-verdict" data-state={shown} className="contents">
      <StatusBadge tone={toneOf(shown)}>{t(wordKey(shown))}</StatusBadge>
    </span>
  )
}

/**
 * An engine's live state in a table's cell (the State column): its mark and its word, the word
 * read out alone in a region narrower than 28rem, where its mark's shape and its title still show
 * it (as pulse-ui's `StateLabel` with `iconOnlyBelow`); a quiet
 * dash with its reason where nothing shows (`why`: still reading, not read, no verdict for the
 * engine).
 */
export function EngineVerdictCell({
  verdict,
  figures,
  why,
}: {
  readonly verdict: EngineVerdict
  readonly figures?: EngineVerdictFigures
  /** Why a state without a verdict shows none, which the dash says in its title. */
  readonly why: string
}) {
  const t = useEnginesWords()
  const shown = shownOf(verdict, figures)
  if (shown === undefined) {
    return (
      <span title={why} className="text-muted-foreground" data-part="engine-verdict">
        <span aria-hidden="true">—</span>
        <span className="sr-only">{why}</span>
      </span>
    )
  }
  const word = t(wordKey(shown))
  return (
    <span
      data-part="engine-verdict"
      data-state={shown}
      title={word}
      className="inline-flex min-w-0 items-baseline gap-1.5 @max-md:align-middle"
    >
      <span className="inline-flex self-center">
        <Mark shown={shown} />
      </span>
      <span className="min-w-0 truncate @max-md:sr-only">{word}</span>
    </span>
  )
}
