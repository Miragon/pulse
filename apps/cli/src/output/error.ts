/**
 * Turns anything thrown into an OperateError and renders it for stderr: one JSON line for scripts
 * and agents, or a short multi-line text for humans. URL passwords are always masked, in the
 * request URL and in free text (network errors and their causes quote the URL).
 */

import type { OutputFormat } from '../config/types.js';
import { OperateError } from '../errors.js';
import { compact, stringifyJson } from '../util.js';
import { maskUrl, maskUrlsInText } from './secrets.js';

const INTERNAL_HINT =
  'This is likely a bug in operate. Re-run with --verbose for the stack trace and report it at https://github.com/Miragon/operate/issues.';

/** How many `cause` levels the verbose stack follows. */
const MAX_CAUSES = 5;

/** Control characters except LF and tab (ANSI escapes, CR) that would garble a terminal. */
const CONTROL = /[^\P{Cc}\n\t]/gu;

// Stryker disable BlockStatement: emptying the catch block is equivalent (it returns undefined too)
/** JSON text of a value, or undefined when it has none (undefined, functions) or cannot be serialized. */
function safeJson(value: unknown): string | undefined {
  try {
    return stringifyJson(value);
  } catch {
    return undefined;
  }
}
// Stryker restore BlockStatement

/** The `message` of an error-like object (may throw for hostile values such as getters). */
function messageProperty(value: unknown): string | undefined {
  const message = (value as { message?: unknown } | null | undefined)?.message;
  return typeof message === 'string' && message !== '' ? message : undefined;
}

/** Text for a thrown value that is not an Error; never throws. */
function describeThrown(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return messageProperty(value) ?? safeJson(value) ?? String(value);
  } catch {
    return `Unknown error (${typeof value})`;
  }
}

function errorMessage(error: Error): string {
  if (error.message === '') return error.name;
  return error.name === 'Error' ? error.message : `${error.name}: ${error.message}`;
}

/** OperateErrors pass through; everything else becomes an INTERNAL error with the original as cause. */
export function toOperateError(error: unknown): OperateError {
  if (error instanceof OperateError) return error;
  const message = error instanceof Error ? errorMessage(error) : describeThrown(error);
  return new OperateError('INTERNAL', message, { hint: INTERNAL_HINT }, error);
}

function causeChain(cause: unknown, depth: number): string[] {
  if (!(cause instanceof Error) || depth >= MAX_CAUSES) return [];
  return [
    `Caused by: ${cause.stack ?? errorMessage(cause)}`,
    ...causeChain(cause.cause, depth + 1),
  ];
}

function maskText(text: string): string {
  return maskUrlsInText(text, false);
}

function maskOptional(text: string | undefined): string | undefined {
  return text === undefined ? undefined : maskText(text);
}

function stackOf(error: OperateError): string {
  const own = error.stack ?? `${error.name}: ${error.message}`;
  return maskText([own, ...causeChain(error.cause, 0)].join('\n'));
}

function maskedRequest(error: OperateError): { method: string; url: string } | undefined {
  const { request } = error.details;
  return request === undefined
    ? undefined
    : { method: request.method, url: maskUrl(request.url, false) };
}

function jsonError(error: OperateError, verbose: boolean): string {
  const { details } = error;
  const body = {
    code: error.code,
    exitCode: error.exitCode,
    message: maskText(error.message),
    ...compact({
      status: details.status,
      engineType: details.engineType,
      engineMessage: maskOptional(details.engineMessage),
      engineCode: details.engineCode,
      hint: maskOptional(details.hint),
      request: maskedRequest(error),
      data: safeJson(details.data) === undefined ? undefined : details.data,
      stack: verbose ? stackOf(error) : undefined,
    }),
  };
  return `${stringifyJson({ error: body }) ?? ''}\n`;
}

/** Terminal-safe text with continuation lines indented: CRLF and CR end lines, too. */
function block(text: string, prefix: string): string {
  return text.replace(/\r\n?/g, '\n').replace(CONTROL, ' ').replaceAll('\n', `\n${prefix}`);
}

function labeled(label: string, text: string | undefined): string | undefined {
  return text === undefined ? undefined : `  ${label}: ${block(text, '    ')}`;
}

function humanError(error: OperateError, verbose: boolean): string {
  const { details } = error;
  const request = maskedRequest(error);
  const lines = [
    `Error: ${block(maskText(error.message), '  ')}`,
    labeled('Engine', details.engineType),
    labeled('Request', request === undefined ? undefined : `${request.method} ${request.url}`),
    labeled('Details', safeJson(details.data)),
    labeled('Hint', maskOptional(details.hint)),
    verbose ? `  Stack:\n    ${block(stackOf(error), '    ')}` : undefined,
  ];
  return `${lines.filter((line) => line !== undefined).join('\n')}\n`;
}

/** Renders an error for stderr; the stack (with causes) only when verbose. Ends with a newline. */
export function renderError(error: OperateError, format: OutputFormat, verbose = false): string {
  return format === 'json' ? jsonError(error, verbose) : humanError(error, verbose);
}
