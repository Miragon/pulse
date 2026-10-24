/**
 * `--verbose`: formats the structured trace events of the HTTP client as `> METHOD url`,
 * `> Name: value` and `< status text (N ms, M bytes)` lines on stderr, secrets masked, and notes
 * about decisions without an answer of their own as `* message` (like `curl -v`).
 */

import type { TraceEvent } from '../http/types.js';
import { maskHeaders, maskUrl } from '../output/secrets.js';
import type { OutputStream } from '../runtime.js';

export function formatTrace(event: TraceEvent, showSecrets: boolean): string {
  if (event.type === 'request') {
    const headers = Object.entries(maskHeaders(event.headers, showSecrets));
    const lines = [
      `> ${event.method} ${maskUrl(event.url, showSecrets)}`,
      ...headers.map(([name, value]) => `> ${name}: ${value}`),
    ];
    return `${lines.join('\n')}\n`;
  }
  if (event.type === 'note') return `* ${event.message}\n`;
  const status = [String(event.status), event.statusText].filter((part) => part !== '').join(' ');
  return `< ${status} (${event.durationMs} ms, ${event.bytes} bytes)\n`;
}

/** The `trace` callback of the HTTP client, writing to `stream`. */
export function traceWriter(stream: OutputStream, showSecrets: boolean) {
  return (event: TraceEvent): void => {
    stream.write(formatTrace(event, showSecrets));
  };
}
