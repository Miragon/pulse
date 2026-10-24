import '../../src/webview/theme/cd-tokens.generated.css';
import '@fontsource-variable/geist/wght.css';
import '@fontsource-variable/geist-mono/wght.css';
import 'diagram-js/assets/diagram-js.css';
import 'bpmn-js/dist/assets/bpmn-js.css';
import '../../src/webview/theme/cd-canvas.css';
import '@miragon/modeler-shell/shell.css';
import '../../src/webview/styles/base.css';
import '../../src/webview/styles/components.css';
import '../../src/webview/styles/screens.css';
import '../../src/webview/styles/migration.css';
import '../../src/webview/styles/tables.css';
import '../../src/webview/styles/diagram.css';
import { render } from 'preact';
import { vi } from 'vitest';
import type { PanelState, WebviewIntent } from '../../src/core/protocol/index.js';
import { App } from '../../src/webview/app.js';
import { HostBridge } from '../../src/webview/host/host-bridge.js';
import type { VsCodeApi } from '../../src/webview/host/host-bridge.js';

export interface Harness {
  readonly root: HTMLElement;
  readonly bridge: HostBridge;
  readonly api: VsCodeApi;
  readonly posted: WebviewIntent[];
  publish(state: PanelState, revision?: number): void;
  unmount(): void;
}

export function fakeApi(posted: WebviewIntent[], initial?: unknown): VsCodeApi {
  let stored: unknown = initial;
  return {
    postMessage: (message) => {
      if ((message as WebviewIntent).type !== 'activity') {
        posted.push(message as WebviewIntent);
      }
    },
    getState: () => stored,
    setState: (state) => {
      stored = state;
    },
  };
}

export function postState(state: PanelState, revision: number): void {
  window.postMessage({ type: 'state', revision, state }, '*');
}

export interface MountOptions {
  readonly width?: number;
  readonly stored?: unknown;
}

export function mountApp({ width = 1200, stored }: MountOptions = {}): Harness {
  document.documentElement.dataset.cdTheme = 'light';
  delete document.documentElement.dataset.cdKontrast;
  const root = document.createElement('div');
  root.style.cssText = `position: fixed; inset: 0; width: ${width}px; height: 800px;`;
  document.body.append(root);
  const posted: WebviewIntent[] = [];
  const api = fakeApi(posted, stored);
  const bridge = new HostBridge(api);
  render(<App bridge={bridge} />, root);
  let revision = 0;
  return {
    root,
    bridge,
    api,
    posted,
    publish: (state, at) => {
      revision = at ?? revision + 1;
      postState(state, revision);
    },
    unmount: () => {
      render(null, root);
      bridge.dispose();
      root.remove();
    },
  };
}

export function waitForElement<T extends Element>(root: ParentNode, selector: string): Promise<T> {
  return vi.waitFor(
    () => {
      const found = root.querySelector<T>(selector);
      if (found === null) {
        throw new Error(`Nothing matches ${selector} yet.`);
      }
      return found;
    },
    { timeout: 5000, interval: 25 },
  );
}

export function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        resolve();
      });
    });
  });
}

export function buttonNamed(root: ParentNode, name: string): HTMLButtonElement {
  const button = [...root.querySelectorAll('button')].find(
    (candidate) => candidate.textContent.trim() === name,
  );
  if (button === undefined) {
    throw new Error(`No button named ${name}.`);
  }
  return button;
}

export function radioNamed(root: ParentNode, name: string): HTMLButtonElement {
  const radio = [...root.querySelectorAll<HTMLButtonElement>('[role="radio"]')].find(
    (candidate) => candidate.firstChild?.textContent?.trim() === name,
  );
  if (radio === undefined) {
    throw new Error(`No radio named ${name}.`);
  }
  return radio;
}

export function press(target: Element, key: string, init: KeyboardEventInit = {}): void {
  target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...init }));
}

export async function fontsLoaded(): Promise<void> {
  await Promise.all([...document.fonts].map((face) => face.load()));
}
