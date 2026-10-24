import type { LiveUpdates } from './live-updates.js';
import type { PanelView } from './panel-view.js';
import type { EngineBadge, Problem } from './view-models.js';

export type PanelState =
  | { readonly status: 'loading'; readonly title: string; readonly engine: EngineBadge }
  | {
      readonly status: 'ready';
      readonly view: PanelView;
      readonly refreshing: boolean;
      readonly live?: LiveUpdates;
    }
  | {
      readonly status: 'failed';
      readonly problem: Problem;
      readonly engine: EngineBadge;
      readonly staleView?: PanelView;
      readonly live?: LiveUpdates;
    };
