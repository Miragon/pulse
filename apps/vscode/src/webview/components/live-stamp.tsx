import type { LiveUpdates } from '../../core/protocol/index.js';
import { useEffect, useState } from 'preact/hooks';
import { glyphs } from './lucide-glyphs.json';
import { LiveLabels } from '../format/live-labels.js';
import { TimeLabels } from '../format/time-labels.js';
import { useHost } from '../host/host-context.js';
import { Icon } from './icon.js';

export type Freshness =
  | { readonly kind: 'loading' }
  | { readonly kind: 'asOf'; readonly at: string; readonly live?: LiveUpdates | undefined }
  | { readonly kind: 'refreshing'; readonly at: string; readonly live?: LiveUpdates | undefined }
  | {
      readonly kind: 'offline';
      readonly at?: string | undefined;
      readonly live?: LiveUpdates | undefined;
    };

const CLOCK_TICK_MS = 15_000;

function useNow(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => {
      setNow(new Date());
    }, CLOCK_TICK_MS);
    return () => {
      clearInterval(timer);
    };
  }, []);
  return now;
}

export function LiveButton({ live }: { readonly live: LiveUpdates | undefined }) {
  const host = useHost();
  const control = LiveLabels.control(live);
  if (control === undefined) {
    return null;
  }
  return (
    <button
      type="button"
      class="button button--ghost button--compact live-button"
      title={control.label}
      aria-label={control.label}
      onClick={() => {
        host.post({ type: control.intent });
      }}
    >
      <Icon of={control.playing ? glyphs.Pause : glyphs.Play} />
    </button>
  );
}

function OfflineStamp({
  at,
  live,
}: {
  readonly at?: string | undefined;
  readonly live?: LiveUpdates | undefined;
}) {
  const since = at === undefined ? '' : ` · data from ${TimeLabels.asOf(at)}`;
  const note = LiveLabels.note(live);
  const title =
    at === undefined ? undefined : `Last read ${TimeLabels.tooltip(at)}. ${note}`.trim();
  return (
    <span class="freshness freshness--offline" title={title}>
      <Icon of={glyphs.Unplug} />
      {`Offline${since}`}
    </span>
  );
}

function ReadStamp({ at, live }: { readonly at: string; readonly live?: LiveUpdates | undefined }) {
  const now = useNow();
  const title = LiveLabels.readTooltip(at, live);
  const time = TimeLabels.asOf(at);
  if (live?.status === 'paused') {
    return (
      <span class="freshness freshness--paused" title={title}>{`Paused · as of ${time}`}</span>
    );
  }
  if (live?.status === 'stopped') {
    return (
      <span class="freshness freshness--offline" title={title}>
        <Icon of={live.reason === 'gone' ? glyphs.Ban : glyphs.Unplug} />
        {`Stopped · data from ${time}`}
      </span>
    );
  }
  if (live?.status === 'reconnecting') {
    return (
      <span class="freshness freshness--offline" title={title}>
        <Icon of={glyphs.Unplug} />
        {`Reconnecting… · data from ${time}`}
      </span>
    );
  }
  if (LiveLabels.isStale(live, now.getTime() - Date.parse(at))) {
    return (
      <span class="freshness freshness--stale" title={title}>
        <Icon of={glyphs.Clock} />
        {`As of ${time} · ${TimeLabels.relative(at, now)}`}
      </span>
    );
  }
  return <span class="freshness" title={title}>{`As of ${time}`}</span>;
}

export function FreshnessStamp({ freshness }: { readonly freshness: Freshness }) {
  if (freshness.kind === 'loading') {
    return <span class="freshness">Loading…</span>;
  }
  if (freshness.kind === 'refreshing') {
    return (
      <span class="freshness" role="status">
        <Icon of={glyphs.LoaderCircle} class="spin" />
        Refreshing…
      </span>
    );
  }
  if (freshness.kind === 'offline') {
    return <OfflineStamp at={freshness.at} live={freshness.live} />;
  }
  return <ReadStamp at={freshness.at} live={freshness.live} />;
}
