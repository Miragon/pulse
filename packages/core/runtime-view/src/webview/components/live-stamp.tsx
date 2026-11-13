import type { ComponentChildren } from "preact"
import type { LiveUpdates, Problem } from "../../core/protocol/index.js"
import { useEffect, useState } from "preact/hooks"
import { glyphs } from "./lucide-glyphs.json"
import { LiveLabels } from "../format/live-labels.js"
import { TimeLabels } from "../format/time-labels.js"
import { useHost } from "../host/host-context.js"
import { Icon } from "./icon.js"

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
    <button
      type="button"
      class="button button--ghost button--compact live-button"
      title={control.label}
      aria-label={control.label}
      onClick={() => {
        host.post({ type: control.intent })
      }}
    >
      <Icon of={control.playing ? glyphs.Pause : glyphs.Play} />
    </button>
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
    <span
      class="freshness freshness--offline"
      data-part="freshness"
      data-state="offline"
      title={title}
    >
      <Icon of={loginRefused === undefined ? glyphs.Unplug : glyphs.KeyRound} />
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
  readonly children: ComponentChildren
}) {
  return (
    <span
      class={`freshness freshness--${state}`}
      data-part="freshness"
      data-state={state}
      title={title}
    >
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
        <Icon of={live.reason === "gone" ? glyphs.Ban : glyphs.Unplug} />
        {`Stopped · data from ${time}`}
      </Stamp>
    )
  }
  if (live?.status === "reconnecting") {
    return (
      <Stamp state="offline" title={title}>
        <Icon of={glyphs.Unplug} />
        {`Reconnecting… · data from ${time}`}
      </Stamp>
    )
  }
  if (LiveLabels.isStale(live, now.getTime() - Date.parse(at))) {
    return (
      <Stamp state="stale" title={title}>
        <Icon of={glyphs.Clock} />
        {`As of ${time} · ${TimeLabels.relative(at, now)}`}
      </Stamp>
    )
  }
  return (
    <span class="freshness" data-part="freshness" data-state="fresh" title={title}>
      {`As of ${time}`}
    </span>
  )
}

export function FreshnessStamp({ freshness }: { readonly freshness: Freshness }) {
  if (freshness.kind === "loading") {
    return (
      <span class="freshness" data-part="freshness" data-state="loading">
        Loading…
      </span>
    )
  }
  if (freshness.kind === "refreshing") {
    return (
      <span class="freshness" data-part="freshness" data-state="refreshing" role="status">
        <Icon of={glyphs.LoaderCircle} class="spin" />
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
