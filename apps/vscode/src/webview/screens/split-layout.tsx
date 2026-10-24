import type { ComponentChildren } from 'preact';
import { useRef, useState } from 'preact/hooks';
import { Separator } from '../components/separator.js';
import { useHost } from '../host/host-context.js';
import { UiStateStore } from '../host/ui-state-store.js';
import { SplitShare } from './split-share.js';

const DEFAULT_SHARE = 0.55;
const KEY_STEP = 0.05;

export interface SplitLayoutProps {
  readonly top: ComponentChildren;
  readonly bottom: ComponentChildren;
}

export function SplitLayout({ top, bottom }: SplitLayoutProps) {
  const { api } = useHost();
  const container = useRef<HTMLDivElement>(null);
  const [share, setShare] = useState(() => UiStateStore.read(api).diagramShare ?? DEFAULT_SHARE);
  const atDragStart = useRef(share);

  const commit = (next: number): void => {
    const clamped = SplitShare.clamp(next);
    setShare(clamped);
    UiStateStore.write(api, { diagramShare: clamped });
  };

  const onDrag = (event: PointerEvent): void => {
    const bounds = container.current?.getBoundingClientRect();
    if (bounds === undefined || bounds.height === 0) {
      return;
    }
    setShare(SplitShare.clamp((event.clientY - bounds.top) / bounds.height));
  };

  return (
    <div
      class="split-layout"
      ref={container}
      style={{ '--diagram-share': `${(share * 100).toFixed(1)}%` }}
    >
      <div class="split-layout__top">{top}</div>
      <Separator
        class="split-layout__handle"
        orientation="horizontal"
        label="Resize diagram and list"
        min={SplitShare.MIN * 100}
        max={SplitShare.MAX * 100}
        value={Math.round(share * 100)}
        keys={{
          ArrowUp: () => {
            commit(share - KEY_STEP);
          },
          ArrowDown: () => {
            commit(share + KEY_STEP);
          },
        }}
        onDragStart={() => {
          atDragStart.current = share;
        }}
        onDrag={onDrag}
        onDragEnd={() => {
          commit(share);
        }}
        onDragCancel={() => {
          setShare(atDragStart.current);
        }}
      />
      <div class="split-layout__bottom">{bottom}</div>
    </div>
  );
}
