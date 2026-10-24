/**
 * How `operate auth login|status|logout` print (design §16.3): the view as JSON or KEY VALUE
 * rows on stdout, and lines on stderr with control characters replaced on a terminal.
 */

import { renderValue } from '../../output/render.js';
import { terminalSafe } from '../../output/terminal.js';
import type { OutputStream, Runtime } from '../../runtime.js';
import type { Display } from '../display.js';
import { maxWidthOf } from '../output-format.js';
import type { Session } from '../session.js';
import type { BearerStatusView } from './auth-bearer.js';
import { type LoginView, type LogoutView, viewRows } from './auth-view.js';

export type Format = Pick<Display, 'format' | 'pretty' | 'maxWidth'>;

export function withWidth(session: Session, runtime: Runtime): Format {
  return { ...session, maxWidth: maxWidthOf(runtime) };
}

export function printView(
  view: LoginView | LogoutView | BearerStatusView,
  display: Format,
  runtime: Runtime,
): void {
  const value = display.format === 'json' ? view : viewRows(view);
  runtime.stdout.write(renderValue(value, display));
}

/** stderr with control characters replaced on a terminal (the user name comes from the AS). */
export function safeStderr(runtime: Runtime): OutputStream {
  const { stderr } = runtime;
  return {
    isTTY: stderr.isTTY,
    write: (chunk) => {
      stderr.write(typeof chunk === 'string' && stderr.isTTY ? terminalSafe(chunk) : chunk);
    },
  };
}
