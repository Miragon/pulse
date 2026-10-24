import type { ComponentChildren } from 'preact';
import { useCallback, useEffect, useMemo, useState } from 'preact/hooks';
import type { InstanceView } from '../../core/protocol/index.js';
import { ContextBar } from '../components/context-bar.js';
import type { Freshness } from '../components/context-bar.js';
import { RuntimeDiagram } from '../components/runtime-diagram.js';
import { WebUiButton } from '../components/web-ui-button.js';
import { Tabs } from '../components/tabs.js';
import type { TabItem } from '../components/tabs.js';
import type { Decorations } from '../diagram/decoration-layer.js';
import { ElementCodes } from '../diagram/element-codes.js';
import { DiagramLegend } from '../diagram/diagram-legend.js';
import { useHost } from '../host/host-context.js';
import { UiStateStore } from '../host/ui-state-store.js';
import { WriteContext } from '../host/write-context.js';
import type { InstanceTab } from '../host/ui-state-store.js';
import { HistoryTab } from './history-tab.js';
import { IncidentsTab } from './incidents-tab.js';
import { InstanceHeaderDetails } from './instance-header.js';
import { MovePanel } from './move-panel.js';
import { NoticeStrip } from './notices.js';
import { SplitLayout } from './split-layout.js';
import { useTokenMove, type TokenMove } from './token-move.js';
import { VariablesTab } from './variables-tab.js';
import { WaitingTab } from './waiting-tab.js';

export interface InstanceScreenProps {
  readonly view: InstanceView;
  readonly freshness: Freshness;
  readonly stale: boolean;
  readonly problem?: ComponentChildren;
}

function useElementNames(view: InstanceView) {
  const [names, setNames] = useState<ReadonlyMap<string, string>>(new Map());
  const waitNames = useMemo(
    () =>
      new Map(
        view.waitStates.flatMap((row) =>
          row.elementName === undefined ? [] : [[row.elementId, row.elementName] as const],
        ),
      ),
    [view],
  );
  const nameOf = useCallback(
    (elementId: string) => names.get(elementId) ?? waitNames.get(elementId) ?? elementId,
    [names, waitNames],
  );
  return { nameOf, setNames };
}

function useInstanceTab(view: InstanceView) {
  const { api } = useHost();
  const [tab, setTab] = useState<InstanceTab>(
    () =>
      UiStateStore.read(api).instanceTab ?? (view.incidents.length > 0 ? 'incidents' : 'waiting'),
  );
  const select = (next: InstanceTab): void => {
    setTab(next);
    UiStateStore.write(api, { instanceTab: next });
  };
  return { tab, select };
}

function useSelectedElement() {
  const host = useHost();
  const [selected, setSelected] = useState<string | undefined>(undefined);
  const [shown, setShown] = useState<{ readonly elementId: string } | undefined>(undefined);
  useEffect(() => {
    if (shown !== undefined) {
      requestAnimationFrame(() => {
        document
          .querySelector<HTMLElement>(`[data-move-from="${CSS.escape(shown.elementId)}"]`)
          ?.focus();
      });
    }
  }, [shown]);
  const selectElement = (elementId: string): void => {
    setSelected(elementId);
    host.post({ type: 'selectElement', elementId });
  };
  const showElement = (elementId: string): void => {
    selectElement(elementId);
    setShown({ elementId });
  };
  return { selected, selectElement, showElement };
}

function TabContent({
  tab,
  view,
  nameOf,
  onShowElement,
}: {
  readonly tab: InstanceTab;
  readonly view: InstanceView;
  readonly nameOf: (id: string) => string;
  readonly onShowElement: (elementId: string) => void;
}) {
  if (tab === 'incidents') {
    return <IncidentsTab incidents={view.incidents} elementName={nameOf} />;
  }
  if (tab === 'waiting') {
    return (
      <WaitingTab
        waitStates={view.waitStates}
        elementName={nameOf}
        onShowElement={view.moves === undefined ? undefined : onShowElement}
      />
    );
  }
  if (tab === 'history') {
    return <HistoryTab path={view.path} elementName={nameOf} />;
  }
  return <VariablesTab variables={view.variables} elementName={nameOf} />;
}

function InstanceStrips({
  view,
  problem,
}: {
  readonly view: InstanceView;
  readonly problem: ComponentChildren;
}) {
  return (
    <div class="strip-stack">
      {problem}
      {view.outcome !== undefined && <NoticeStrip notice={view.outcome} />}
      {view.notice !== undefined && <NoticeStrip notice={view.notice} />}
      {view.headline !== undefined && <NoticeStrip notice={view.headline} />}
    </div>
  );
}

function InstanceBar({
  view,
  freshness,
}: {
  readonly view: InstanceView;
  readonly freshness: Freshness;
}) {
  const { instance } = view;
  return (
    <ContextBar
      subject="instance"
      title={instance.businessKey ?? instance.shortId}
      engine={view.engine}
      freshness={freshness}
    >
      <InstanceHeaderDetails instance={instance} />
      <WebUiButton link={view.webUi} />
    </ContextBar>
  );
}

function useDecorations(
  view: InstanceView,
  stale: boolean,
  selected: string | undefined,
  move: TokenMove,
): Decorations {
  return useMemo<Decorations>(
    () => ({
      badges: [],
      markers: view.markers,
      calls: view.calls,
      stale,
      focusElementId: selected,
      codes: ElementCodes.of(view.model, view.incidents),
      move: move.decoration,
      moveEntry: move.entry,
    }),
    [
      view.markers,
      view.calls,
      view.model,
      view.incidents,
      stale,
      selected,
      move.decoration,
      move.entry,
    ],
  );
}

function InstanceDetails({
  view,
  tabs,
  tab,
  select,
  nameOf,
  move,
  onShowElement,
}: {
  readonly view: InstanceView;
  readonly tabs: readonly TabItem<InstanceTab>[];
  readonly tab: InstanceTab;
  readonly select: (tab: InstanceTab) => void;
  readonly nameOf: (id: string) => string;
  readonly move: TokenMove;
  readonly onShowElement: (elementId: string) => void;
}) {
  if (move.choice !== undefined) {
    return (
      <section class="list-region" aria-label="Move a token">
        <MovePanel
          choice={move.choice}
          option={move.option}
          fromLabel={nameOf(move.choice.from)}
          onPick={move.pick}
          onClose={move.close}
        />
      </section>
    );
  }
  return (
    <section class="list-region" aria-label="Instance details">
      <Tabs
        label="Instance details"
        items={tabs}
        selected={tab}
        onSelect={select}
        aside={<DiagramLegend kind="markers" />}
      >
        <TabContent tab={tab} view={view} nameOf={nameOf} onShowElement={onShowElement} />
        {view.truncated && (
          <p class="muted truncated-note">
            Some lists are cut off. Pulse shows the first entries only.
          </p>
        )}
      </Tabs>
    </section>
  );
}

export function InstanceScreen({ view, freshness, stale, problem }: InstanceScreenProps) {
  const { nameOf, setNames } = useElementNames(view);
  const { tab, select } = useInstanceTab(view);
  const { selected, selectElement, showElement } = useSelectedElement();
  const move = useTokenMove(view, selected);
  const decorations = useDecorations(view, stale, selected, move);
  const tabs: readonly TabItem<InstanceTab>[] = [
    { id: 'history', label: 'History', count: view.path.length },
    { id: 'incidents', label: 'Incidents', count: view.incidents.length },
    { id: 'waiting', label: 'Waiting', count: view.waitStates.length },
    { id: 'variables', label: 'Variables', count: view.variables.length },
  ];
  return (
    <WriteContext.Provider value={view.write}>
      <div class="screen screen--with-strips">
        <InstanceBar view={view} freshness={freshness} />
        <InstanceStrips view={view} problem={problem} />
        <SplitLayout
          top={
            <RuntimeDiagram
              xml={view.diagramXml}
              decorations={decorations}
              onSelectElement={move.choice === undefined ? selectElement : move.pick}
              onNames={setNames}
            />
          }
          bottom={
            <InstanceDetails
              view={view}
              tabs={tabs}
              tab={tab}
              select={select}
              nameOf={nameOf}
              move={move}
              onShowElement={showElement}
            />
          }
        />
      </div>
    </WriteContext.Provider>
  );
}
