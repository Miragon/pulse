import type { ComponentChildren } from 'preact';
import { useEffect, useMemo, useState } from 'preact/hooks';
import type { PanelState, PanelView } from '../core/protocol/index.js';
import type { Freshness } from './components/context-bar.js';
import type { HostBridge } from './host/host-bridge.js';
import { HostContext } from './host/host-context.js';
import type { Host } from './host/host-context.js';
import { DefinitionScreen } from './screens/definition-screen.js';
import { EngineScreen } from './screens/engine-screen.js';
import { InstanceScreen } from './screens/instance-screen.js';
import { MigrationScreen } from './screens/migration-screen.js';
import { ProblemStrip } from './screens/notices.js';
import { BlankScreen, FailedScreen, LoadingScreen } from './screens/waiting-screens.js';

interface ViewScreenProps {
  readonly view: PanelView;
  readonly freshness: Freshness;
  readonly stale: boolean;
  readonly problem?: ComponentChildren;
}

function ViewScreen({ view, ...rest }: ViewScreenProps) {
  if (view.kind === 'engine') {
    return <EngineScreen view={view} {...rest} />;
  }
  if (view.kind === 'migration') {
    return <MigrationScreen view={view} {...rest} />;
  }
  return view.kind === 'definition' ? (
    <DefinitionScreen view={view} refreshing={rest.freshness.kind === 'refreshing'} {...rest} />
  ) : (
    <InstanceScreen view={view} {...rest} />
  );
}

function Panel({ state }: { readonly state: PanelState | undefined }) {
  if (state === undefined) {
    return <BlankScreen />;
  }
  if (state.status === 'loading') {
    return <LoadingScreen title={state.title} engine={state.engine} />;
  }
  if (state.status === 'ready') {
    const at = state.view.asOf;
    const freshness: Freshness = state.refreshing
      ? { kind: 'refreshing', at, live: state.live }
      : { kind: 'asOf', at, live: state.live };
    return <ViewScreen view={state.view} freshness={freshness} stale={false} />;
  }
  if (state.staleView === undefined) {
    return <FailedScreen problem={state.problem} engine={state.engine} />;
  }
  return (
    <ViewScreen
      view={state.staleView}
      freshness={{ kind: 'offline', at: state.staleView.asOf, live: state.live }}
      stale
      problem={<ProblemStrip problem={state.problem} />}
    />
  );
}

const ACTIVITY_EVERY_MS = 30_000;
const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'wheel'] as const;

function useActivityReports(bridge: HostBridge): void {
  useEffect(() => {
    let reportedAt = Number.NEGATIVE_INFINITY;
    const report = (): void => {
      const now = Date.now();
      if (now - reportedAt >= ACTIVITY_EVERY_MS) {
        reportedAt = now;
        bridge.post({ type: 'activity' });
      }
    };
    for (const type of ACTIVITY_EVENTS) {
      document.addEventListener(type, report, { capture: true, passive: true });
    }
    return () => {
      for (const type of ACTIVITY_EVENTS) {
        document.removeEventListener(type, report, { capture: true });
      }
    };
  }, [bridge]);
}

export function App({ bridge }: { readonly bridge: HostBridge }) {
  const [state, setState] = useState<PanelState | undefined>(() => bridge.current());
  useEffect(() => bridge.subscribe(setState), [bridge]);
  useActivityReports(bridge);
  const backLabel = state === undefined ? undefined : bridge.back()?.label;
  const host = useMemo<Host>(
    () => ({
      api: bridge.api,
      back: backLabel === undefined ? undefined : { label: backLabel },
      post: (intent) => {
        bridge.post(intent);
      },
    }),
    [bridge, backLabel],
  );
  return (
    <HostContext.Provider value={host}>
      <Panel state={state} />
    </HostContext.Provider>
  );
}
