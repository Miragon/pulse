import type { ReactNode } from "react"
import {
  Alert,
  AlertDescription,
  Card,
  CardContent,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  cn,
  TONE_ICON,
} from "@miragon/mcp-toolkit-ui"
import { CircleAlert, TrendingDown, TrendingUp } from "lucide-react"
import {
  Icon,
  formatDuration,
  formatNumber,
  formatPercent,
} from "@miragon/pulse-widget-shell/widgets"
import type { CompareKpiDelta, CompareKpis } from "@miragon/pulse-analytics-client"
import { useT, type T } from "../messages/use-t.js"

/** Hand-off facts (#338): a null delta (zero baseline) is never sent as 0. */
export function deltaFacts(delta: CompareKpiDelta, suppressed: boolean) {
  return {
    // Starts compare PER DAY, so a clamped (shorter) window compares fairly.
    startedPerDayDeltaPct: delta.started_per_day_delta_pct,
    incidentRateDeltaPp: delta.incident_rate_delta_pp,
    elementIncidentRateDeltaPp: delta.element_incident_rate_delta_pp,
    avgDurationDeltaPct: delta.avg_duration_delta_pct,
    p95DurationDeltaPct: delta.p95_duration_delta_pct,
    suppressed,
  }
}

/**
 * U6: only a quality metric gets a verdict, from `minChange` on (in the delta's
 * unit) so rounding jitter stays neutral. Fewer starts are no regression.
 */
export type DeltaRule =
  { kind: "volume" } | { kind: "quality"; worseIfUp: boolean; minChange: number }

/** A duration changes noticeably from 5 % on (relative). */
export const DURATION_MIN_CHANGE_PCT = 5
/** An incident rate changes noticeably from 1 incident per 100 starts on (absolute). */
export const RATE_MIN_CHANGE = 1

export type DeltaVerdict = "worse" | "better" | "notReliable"

/** Rounded like `Intl.NumberFormat`, so the verdict judges the number on screen. */
function shownDelta(value: number): number {
  return Math.sign(value) * (Math.round(Math.abs(value) * 10) / 10)
}

/** Suppressed comparisons read "not reliable": the screen must not judge what the model is told is noise. */
export function deltaVerdict(
  value: number | null,
  rule: DeltaRule,
  suppressed: boolean,
): DeltaVerdict | undefined {
  if (value === null || rule.kind === "volume") return undefined
  if (suppressed) return "notReliable"
  const shown = shownDelta(value)
  if (Math.abs(shown) < rule.minChange) return undefined
  const bad = rule.worseIfUp ? shown > 0 : shown < 0
  return bad ? "worse" : "better"
}

/** `pct` is relative; `rate` is absolute, in incidents per 100 starts. */
type DeltaUnit = "pct" | "rate"

export function formatDelta(value: number | null, unit: DeltaUnit): string {
  const shown = value === null ? null : shownDelta(value)
  if (unit === "pct") return formatPercent(shown, { signed: true })
  return formatNumber(shown, { signDisplay: "exceptZero", maximumFractionDigits: 1 })
}

/** Nullable rates and durations render "not measured", never "0,0" or "0 ms". */
type ComparableKpis = Pick<CompareKpis, "instance_count"> & {
  incident_rate_pct: number | null
  element_incident_count: number | null
  element_incident_rate_pct: number | null
  avg_duration_sec: number | null
  p95_duration_sec: number | null
}

/** Incidents per 100 starts, one decimal: "6,6" / "6.6" (no %: a rate may pass 100). */
const rateValue = (n: number | null) =>
  n === null ? null : formatNumber(n, { minimumFractionDigits: 1, maximumFractionDigits: 1 })
const durationValue = (sec: number | null) => (sec === null ? null : formatDuration(sec * 1000))

export type ComparisonMetric = {
  label: string
  before: string
  after: string
  delta: { value: number | null; unit: DeltaUnit; rule: DeltaRule }
}

const VOLUME: DeltaRule = { kind: "volume" }
/** Incidents per 100 starts: up is worse, from 1 per 100 starts on (also the dashboard's trend). */
export const RATE_UP_IS_WORSE: DeltaRule = {
  kind: "quality",
  worseIfUp: true,
  minChange: RATE_MIN_CHANGE,
}
const DURATION_UP_IS_WORSE: DeltaRule = {
  kind: "quality",
  worseIfUp: true,
  minChange: DURATION_MIN_CHANGE_PCT,
}

/** Deltas stay numeric here; formatting and the verdict happen in {@link ComparisonCard}. */
const COMPARE_METRICS: Array<{
  labelKey: string
  value: (k: ComparableKpis) => string | null
  delta: (d: CompareKpiDelta) => number | null
  unit: DeltaUnit
  rule: DeltaRule
  elementOnly?: boolean
}> = [
  {
    // A volume: no verdict.
    labelKey: "aComparison.metricStarted",
    value: (k) => formatNumber(k.instance_count),
    delta: (d) => d.started_per_day_delta_pct,
    unit: "pct",
    rule: VOLUME,
  },
  {
    labelKey: "aComparison.metricIncidentRate",
    value: (k) => rateValue(k.incident_rate_pct),
    delta: (d) => d.incident_rate_delta_pp,
    unit: "rate",
    rule: RATE_UP_IS_WORSE,
  },
  {
    labelKey: "aComparison.metricElementIncidentRate",
    value: (k) => rateValue(k.element_incident_rate_pct),
    delta: (d) => d.element_incident_rate_delta_pp,
    unit: "rate",
    rule: RATE_UP_IS_WORSE,
    elementOnly: true,
  },
  {
    labelKey: "aComparison.metricAvgDuration",
    value: (k) => durationValue(k.avg_duration_sec),
    delta: (d) => d.avg_duration_delta_pct,
    unit: "pct",
    rule: DURATION_UP_IS_WORSE,
  },
  {
    labelKey: "aComparison.metricP95Duration",
    value: (k) => durationValue(k.p95_duration_sec),
    delta: (d) => d.p95_duration_delta_pct,
    unit: "pct",
    rule: DURATION_UP_IS_WORSE,
  },
]

export function buildComparisonMetrics(
  t: T,
  before: ComparableKpis,
  after: ComparableKpis,
  delta: CompareKpiDelta,
): ComparisonMetric[] {
  const unavailable = t("aComparison.valueUnavailable")
  const elementScoped =
    before.element_incident_count !== null || after.element_incident_count !== null
  return COMPARE_METRICS.filter((m) => !m.elementOnly || elementScoped).map((m) => ({
    label: t(m.labelKey),
    before: m.value(before) ?? unavailable,
    after: m.value(after) ?? unavailable,
    delta: { value: m.delta(delta), unit: m.unit, rule: m.rule },
  }))
}

const VERDICT_KEY: Record<DeltaVerdict, string> = {
  worse: "aComparison.deltaWorse",
  better: "aComparison.deltaBetter",
  notReliable: "aComparison.deltaNotReliable",
}

/** The number stays neutral (CI); a verdict adds icon plus word, never colour alone. */
function DeltaCell({
  delta,
  suppressed,
  t,
}: {
  delta: ComparisonMetric["delta"]
  suppressed: boolean
  t: T
}) {
  const verdict = deltaVerdict(delta.value, delta.rule, suppressed)
  const word = verdict ? t(VERDICT_KEY[verdict]) : undefined
  const judged = verdict === "worse" || verdict === "better"
  return (
    <TableCell data-verdict={verdict ?? "none"}>
      <span
        className={cn(
          "inline-flex items-center gap-1.5 tabular-nums",
          verdict === "notReliable" && "text-muted-foreground",
        )}
      >
        {judged && (
          <Icon
            icon={(delta.value ?? 0) > 0 ? TrendingUp : TrendingDown}
            dense
            className={TONE_ICON[verdict === "worse" ? "danger" : "success"]}
          />
        )}
        {formatDelta(delta.value, delta.unit)}
        {word && <span className="text-muted-foreground text-small">{word}</span>}
      </span>
    </TableCell>
  )
}

/** Destructive is reserved for errors. */
export function ComparisonEmptyState({ children }: { children: ReactNode }) {
  return (
    <Alert>
      <AlertDescription>{children}</AlertDescription>
    </Alert>
  )
}

/** Not the toolkit `Badge`: it forces 12 px icons, the view keeps 16 px (`scanIconSizes`). */
export function SuppressedBadge({ children }: { children: ReactNode }) {
  return (
    <span
      className="text-foreground text-small inline-flex w-fit shrink-0 items-center gap-1 rounded-sm border px-2 py-0.5 font-medium whitespace-nowrap"
      data-suppressed=""
    >
      <Icon icon={CircleAlert} dense />
      {children}
    </span>
  )
}

export function ComparisonCard({
  title,
  badges,
  meta,
  beforeLabel,
  afterLabel,
  tableLabel,
  metrics,
  suppressed,
  actions,
  note,
}: {
  title: string
  badges: ReactNode
  meta?: ReactNode
  beforeLabel: ReactNode
  afterLabel: ReactNode
  tableLabel: string
  metrics: ComparisonMetric[]
  /** A side is below `minBucketSize`: every quality delta reads "not reliable". */
  suppressed: boolean
  actions?: ReactNode
  /** Optional caveat under the table, e.g. why a metric reads "not measured". */
  note?: ReactNode
}) {
  const t = useT()
  return (
    <Card>
      <CardContent>
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-foreground text-section">{title}</h2>
          {badges}
          {actions && <div className="ml-auto flex items-center gap-2">{actions}</div>}
        </div>
        {meta && <div className="mt-1">{meta}</div>}

        <Table className="mt-4" aria-label={tableLabel}>
          <TableHeader>
            <TableRow>
              <TableHead scope="col">{t("aComparison.metricColumnHeader")}</TableHead>
              <TableHead scope="col">{beforeLabel}</TableHead>
              <TableHead scope="col">{afterLabel}</TableHead>
              <TableHead scope="col">{t("aComparison.deltaColumnHeader")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {metrics.map((m) => (
              <TableRow key={m.label}>
                <TableCell>{m.label}</TableCell>
                <TableCell className="tabular-nums">{m.before}</TableCell>
                <TableCell className="tabular-nums">{m.after}</TableCell>
                <DeltaCell delta={m.delta} suppressed={suppressed} t={t} />
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {note && (
          <Alert className="mt-4">
            <AlertDescription>{note}</AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  )
}
