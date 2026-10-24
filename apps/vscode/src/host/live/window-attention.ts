import type { Attention } from '../../core/index.js';
import * as vscode from 'vscode';

const IDLE_AFTER_MS = 15 * 60_000;

export class WindowAttention implements vscode.Disposable {
  private idle = false;
  private idleTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChange = this.changed.event;
  private readonly subscription: vscode.Disposable;

  constructor() {
    this.subscription = vscode.window.onDidChangeWindowState((state) => {
      this.track(state.active);
      this.changed.fire();
    });
    this.track(vscode.window.state.active);
  }

  of(visible: boolean): Attention {
    if (!visible) {
      return 'hidden';
    }
    if (!vscode.window.state.focused) {
      return 'background';
    }
    return this.idle ? 'idle' : 'watched';
  }

  noteActivity(): void {
    const wasIdle = this.idle;
    this.idle = false;
    this.track(vscode.window.state.active);
    if (wasIdle) {
      this.changed.fire();
    }
  }

  dispose(): void {
    clearTimeout(this.idleTimer);
    this.subscription.dispose();
    this.changed.dispose();
  }

  private track(active: boolean): void {
    clearTimeout(this.idleTimer);
    this.idleTimer = undefined;
    if (active) {
      this.idle = false;
      return;
    }
    this.idleTimer = setTimeout(() => {
      this.idle = true;
      this.changed.fire();
    }, IDLE_AFTER_MS);
  }
}
