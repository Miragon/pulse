import { mountShell, type ShellHandle } from '@miragon/modeler-shell';
import {
  connectAppearance,
  connectReducedMotion,
  mountVsCodeShell,
} from '@miragon/modeler-shell/vscode/webview';

const SHELL_OPTIONS = { themes: ['light', 'dark'], lang: 'en' } as const;

export interface MountedShell {
  readonly shell: ShellHandle;
  readonly disconnect: () => void;
}

export class CanvasShell {
  static mount(host: HTMLElement, keysOnCanvas: boolean): MountedShell {
    if (!keysOnCanvas) {
      return { shell: mountVsCodeShell(host, SHELL_OPTIONS), disconnect: () => undefined };
    }
    const disconnects = [connectAppearance(SHELL_OPTIONS), connectReducedMotion()];
    return {
      shell: mountShell(host, { ...SHELL_OPTIONS, host: 'ide', keyScope: 'root' }),
      disconnect: () => {
        for (const disconnect of disconnects) {
          disconnect();
        }
      },
    };
  }
}
