import type { HostMessage, PanelState } from '../protocol/index.js';

export class StatePublisher {
  private revision = 0;

  constructor(private readonly post: (message: HostMessage) => void) {}

  publish(state: PanelState): void {
    this.revision += 1;
    this.post({ type: 'state', revision: this.revision, state });
  }
}
