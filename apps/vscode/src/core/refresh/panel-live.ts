import type { LiveUpdates, WebviewIntent } from '../protocol/index.js';
import type { PanelContext } from '../panels/panel-context.js';
import type { Attention } from './live-context.js';
import type { LiveView } from './refresh-cadence.js';
import { RefreshLoop, type Refreshable, type SettledRead } from './refresh-loop.js';

type LiveIntent = Extract<
  WebviewIntent,
  {
    readonly type:
      'pauseLiveUpdates' | 'resumeLiveUpdates' | 'turnOnLiveUpdates' | 'holdLiveUpdates';
  }
>;

const LIVE_INTENTS: ReadonlySet<WebviewIntent['type']> = new Set([
  'pauseLiveUpdates',
  'resumeLiveUpdates',
  'turnOnLiveUpdates',
  'holdLiveUpdates',
]);

export class PanelLive {
  private readonly loop: RefreshLoop | undefined;

  constructor(
    private readonly context: PanelContext,
    view: LiveView,
    target: Refreshable,
  ) {
    const live = context.live;
    this.loop =
      live === undefined
        ? undefined
        : new RefreshLoop(live, target, {
            view,
            environment: context.engine.environment,
            now: context.now,
          });
  }

  static handles(intent: WebviewIntent): intent is LiveIntent {
    return LIVE_INTENTS.has(intent.type);
  }

  status(): LiveUpdates | undefined {
    return this.loop?.status();
  }

  handle(intent: LiveIntent): void {
    switch (intent.type) {
      case 'pauseLiveUpdates':
        this.loop?.pause();
        return;
      case 'resumeLiveUpdates':
        this.loop?.resume();
        return;
      case 'turnOnLiveUpdates':
        this.context.effects.turnOnLiveUpdates(this.context.engine.environment);
        return;
      case 'holdLiveUpdates':
        this.loop?.holdForEditor(intent.held);
    }
  }

  attend(attention: Attention): void {
    this.loop?.attend(attention);
  }

  nudge(): void {
    this.loop?.nudge();
  }

  settled(read: SettledRead): void {
    this.loop?.settled(read);
  }

  dispose(): void {
    this.loop?.dispose();
  }
}
