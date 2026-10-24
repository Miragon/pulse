import { createContext } from 'preact';
import { useContext } from 'preact/hooks';
import type { BackLink, WebviewIntent } from '../../core/protocol/index.js';
import type { VsCodeApi } from './host-bridge.js';

export interface Host {
  readonly api: VsCodeApi;
  readonly back: BackLink | undefined;
  post(intent: WebviewIntent): void;
}

export const HostContext = createContext<Host | null>(null);

export function useHost(): Host {
  const host = useContext(HostContext);
  if (host === null) {
    throw new Error('HostContext is missing. Render the app inside <HostContext.Provider>.');
  }
  return host;
}
