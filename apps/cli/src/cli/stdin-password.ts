/**
 * `--auth-password-stdin`: the Basic auth password is the first line of stdin, so it never shows
 * up in the shell history or the process list. operate never prompts for it. `--auth-token-stdin`
 * reads a bearer token and `config set --oauth-client-secret-stdin` an OAuth client secret the
 * same way.
 */

import { usageError } from '../errors.js';
import type { Runtime } from '../runtime.js';

const PIPE_EXAMPLE = `printf '%s\\n' "$PASSWORD" | operate ... --auth-password-stdin`;

const LINE_FEED = 0x0a;

/** A secret read from stdin: the flag that reads it and what it is, for messages. */
export interface StdinSecret {
  readonly flag: string;
  readonly noun: string;
  /** A command line that pipes the secret into the command. */
  readonly example: string;
}

const PASSWORD: StdinSecret = {
  flag: '--auth-password-stdin',
  noun: 'password',
  example: PIPE_EXAMPLE,
};

/** `--auth-token-stdin`: a bearer token obtained elsewhere. */
export const TOKEN: StdinSecret = {
  flag: '--auth-token-stdin',
  noun: 'token',
  example: `gcloud auth print-access-token | operate ... --auth-token-stdin`,
};

/**
 * The first line of `data` without its line break (LF, CRLF or a trailing CR). Only that line is
 * decoded (a UTF-8 sequence never contains the byte of LF). Bytes that are not UTF-8, e.g. a
 * Latin-1 password file, are a usage error: replaced characters would send wrong credentials, and
 * engines lock a user after repeated failed logins. The error never quotes the bytes.
 */
export function firstLine(data: Uint8Array, secret: StdinSecret = PASSWORD): string {
  const end = data.indexOf(LINE_FEED);
  let line: string;
  try {
    // fatal: fails on bytes that are not UTF-8 instead of replacing them with U+FFFD; drops a BOM
    line = new TextDecoder('utf-8', { fatal: true }).decode(end < 0 ? data : data.subarray(0, end));
  } catch {
    throw usageError(
      `${secret.flag} read bytes that are not valid UTF-8`,
      `Re-encode the ${secret.noun} as UTF-8, e.g. with iconv -f latin1 -t utf-8; operate sends it UTF-8 encoded.`,
    );
  }
  return line.replace(/\r+$/, '');
}

/** What a command reads from stdin: the password, the token, the body (`--body -`). */
export interface StdinUse {
  readonly password: boolean;
  readonly token: boolean;
  readonly body: boolean;
}

/**
 * Two of `--auth-password-stdin`, `--auth-token-stdin` and `--body -` want stdin: a usage error,
 * raised before stdin is read.
 */
export function checkStdinUse(use: StdinUse): void {
  if (use.password && use.token) {
    throw usageError(
      '--auth-password-stdin and --auth-token-stdin both read stdin',
      'A command sends a Basic auth password or a bearer token, not both; pass the other one with OPERATE_PASSWORD or OPERATE_TOKEN, and choose the type with --auth.',
    );
  }
  const [flag, variable, option] = use.token
    ? ['--auth-token-stdin', 'the token with OPERATE_TOKEN', '--auth-token-env']
    : ['--auth-password-stdin', 'the password with OPERATE_PASSWORD', '--auth-password-env'];
  if ((use.password || use.token) && use.body) {
    throw usageError(
      `${flag} and --body - both read stdin`,
      `Pass the body as a file (--body @file.json), or ${variable} or a profile (${option}).`,
    );
  }
}

/** Reads the password (or another secret); a blank first line is a usage error. */
export async function readStdinPassword(
  runtime: Runtime,
  secret: StdinSecret = PASSWORD,
): Promise<string> {
  const password = firstLine(await runtime.readStdin(), secret);
  if (password.trim() === '') {
    throw usageError(
      `${secret.flag} read an empty ${secret.noun}`,
      `Pipe the ${secret.noun} into the command, e.g. ${secret.example}.`,
    );
  }
  return password;
}
