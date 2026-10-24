import type { PanelState } from '../../core/protocol/index.js';

export class PanelTitle {
  static ofEngine(name: string): string {
    return `${name} · Processes`;
  }

  static of(state: PanelState, fallback: string): string {
    const view =
      state.status === 'ready'
        ? state.view
        : state.status === 'failed'
          ? state.staleView
          : undefined;
    if (view === undefined) {
      return fallback;
    }
    if (view.kind === 'engine') {
      return PanelTitle.ofEngine(view.engine.name);
    }
    if (view.kind === 'definition') {
      return `${view.processName} · ${view.engine.name}`;
    }
    if (view.kind === 'migration') {
      const target = view.target === undefined ? '…' : `v${view.target.version}`;
      return `${view.processName} v${view.source.version} → ${target} · ${view.engine.name}`;
    }
    return `${view.instance.businessKey ?? view.instance.shortId} · ${view.instance.processName}`;
  }
}
