import {
  BanIcon,
  ClockIcon,
  KeyRoundIcon,
  LoaderCircleIcon,
  PauseIcon,
  PlayIcon,
  UnplugIcon,
} from "lucide-react"
import { useEffect, useState, type ReactNode } from "react"
import { Button, Icon, TONE_ICON } from "@miragon/pulse-ui"
import type { LiveUpdates, Problem } from "../../core/protocol/index.js"
import { LiveLabels } from "../format/live-labels.js"
import { TimeLabels } from "../format/time-labels.js"
import { useHost } from "../host/host-context.js"

export type Freshness =
  | { readonly kind: "loading" }
  | { readonly kind: "asOf"; readonly at: string; readonly live?: LiveUpdates | undefined }
  | { readonly kind: "refreshing"; readonly at: string; readonly live?: LiveUpdates | undefined }
  | {
      readonly kind: "offline"
      readonly at?: string | undefined
      readonly live?: LiveUpdates | undefined
      readonly loginRefused?: Problem["loginRefused"]
    }

const REFUSED_LOGIN_LABELS = {
  unauthorized: "Credentials rejected",
  forbidden: "Access denied",
} as const

const CLOCK_TICK_MS = 15_000

const STAMP =
  "inline-flex min-w-[24ch] items-center justify-end gap-1.5 text-right whitespace-nowrap tabular-nums"

function useNow(): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const timer = setInterval(() => {
      setNow(new Date())
    }, CLOCK_TICK_MS)
    return () => {
      clearInterval(timer)
    }
  }, [])
  return now
}

export function LiveButton({ live }: { readonly live: LiveUpdates | undefined }) {
  const host = useHost()
  const control = LiveLabels.control(live)
  if (control === undefined) {
    return null
  }
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      title={control.label}
      aria-label={control.label}
      onClick={() => {
        host.post({ type: control.intent })
      }}
    >
      <Icon icon={control.playing ? PauseIcon : PlayIcon} />
    </Button>
  )
}

function OfflineStamp({
  at,
  live,
  loginRefused,
}: {
  readonly at?: string | undefined
  readonly live?: LiveUpdates | undefined
  readonly loginRefused?: Problem["loginRefused"]
}) {
  const since = at === undefined ? "" : ` · data from ${TimeLabels.asOf(at)}`
  const note = LiveLabels.note(live)
  const title = at === undefined ? undefined : `Last read ${TimeLabels.tooltip(at)}. ${note}`.trim()
  const state = loginRefused === undefined ? "Offline" : REFUSED_LOGIN_LABELS[loginRefused]
  return (
    <span className={STAMP} data-part="freshness" data-state="offline" title={title}>
      <Icon
        icon={loginRefused === undefined ? UnplugIcon : KeyRoundIcon}
        className={TONE_ICON.warning}
      />
      {`${state}${since}`}
    </span>
  )
}

function Stamp({
  state,
  title,
  children,
}: {
  readonly state: "paused" | "offline" | "stale"
  readonly title: string
  readonly children: ReactNode
}) {
  return (
    <span className={STAMP} data-part="freshness" data-state={state} title={title}>
      {children}
    </span>
  )
}

function ReadStamp({ at, live }: { readonly at: string; readonly live?: LiveUpdates | undefined }) {
  const now = useNow()
  const title = LiveLabels.readTooltip(at, live)
  const time = TimeLabels.asOf(at)
  if (live?.status === "paused") {
    return <Stamp state="paused" title={title}>{`Paused · as of ${time}`}</Stamp>
  }
  if (live?.status === "stopped") {
    return (
      <Stamp state="offline" title={title}>
        <Icon icon={live.reason === "gone" ? BanIcon : UnplugIcon} className={TONE_ICON.warning} />
        {`Stopped · data from ${time}`}
      </Stamp>
    )
  }
  if (live?.status === "reconnecting") {
    return (
      <Stamp state="offline" title={title}>
        <Icon icon={UnplugIcon} className={TONE_ICON.warning} />
        {`Reconnecting… · data from ${time}`}
      </Stamp>
    )
  }
  if (LiveLabels.isStale(live, now.getTime() - Date.parse(at))) {
    return (
      <Stamp state="stale" title={title}>
        <Icon icon={ClockIcon} className={TONE_ICON.warning} />
        {`As of ${time} · ${TimeLabels.relative(at, now)}`}
      </Stamp>
    )
  }
  return (
    <span className={STAMP} data-part="freshness" data-state="fresh" title={title}>
      {`As of ${time}`}
    </span>
  )
}

export function FreshnessStamp({ freshness }: { readonly freshness: Freshness }) {
  if (freshness.kind === "loading") {
    return (
      <span className={STAMP} data-part="freshness" data-state="loading">
        Loading…
      </span>
    )
  }
  if (freshness.kind === "refreshing") {
    return (
      <span className={STAMP} data-part="freshness" data-state="refreshing" role="status">
        <Icon icon={LoaderCircleIcon} className="motion-safe:animate-spin" />
        Refreshing…
      </span>
    )
  }
  if (freshness.kind === "offline") {
    return (
      <OfflineStamp at={freshness.at} live={freshness.live} loginRefused={freshness.loginRefused} />
    )
  }
  return <ReadStamp at={freshness.at} live={freshness.live} />
}
