/**
 * Starts the system browser for `operate auth login` (design §16.10) without waiting for it.
 * `BROWSER` (non-blank) is run as one executable with the URL as its only argument (no shell, no
 * splitting); else `open` on macOS, `rundll32 url.dll,FileProtocolHandler` on Windows (no cmd
 * parsing of `&`) and `xdg-open` elsewhere, but only with a graphical session (`DISPLAY` or
 * `WAYLAND_DISPLAY`): over SSH xdg-open would start a text browser in the terminal.
 */

import { spawn } from 'node:child_process';

type Env = Readonly<Record<string, string | undefined>>;

function given(value: string | undefined): string | undefined {
  return value === undefined || value.trim() === '' ? undefined : value;
}

/** The command that opens `url`, or undefined when there is no browser to start. */
export function browserCommand(
  url: string,
  env: Env,
  platform: string,
): [string, string[]] | undefined {
  const browser = given(env.BROWSER);
  if (browser !== undefined) return [browser, [url]];
  if (platform === 'darwin') return ['open', [url]];
  if (platform === 'win32') return ['rundll32.exe', ['url.dll,FileProtocolHandler', url]];
  const graphical = given(env.DISPLAY) ?? given(env.WAYLAND_DISPLAY);
  return graphical === undefined ? undefined : ['xdg-open', [url]];
}

/** True when the browser process started; false when there is none. Never throws. */
export function openBrowser(url: string, env: Env, platform: string): Promise<boolean> {
  const protocol = URL.canParse(url) ? new URL(url).protocol : '';
  const command = browserCommand(url, env, platform);
  if (command === undefined || (protocol !== 'http:' && protocol !== 'https:')) {
    return Promise.resolve(false);
  }
  return new Promise((resolve) => {
    try {
      const child = spawn(command[0], command[1], { detached: true, stdio: 'ignore' });
      child.once('spawn', () => {
        child.unref();
        resolve(true);
      });
      child.once('error', () => {
        resolve(false);
      });
    } catch {
      resolve(false);
    }
  });
}
