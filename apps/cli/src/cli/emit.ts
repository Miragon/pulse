/**
 * Writes operation results: rendered output to stdout/stderr, binary responses only to pipes, and
 * `--out-file` (response body to a file, summary to stdout).
 */

import { usageError } from '../errors.js';
import type { OperationResult } from '../operation/result.js';
import {
  fieldWarnings,
  type Rendered,
  type RenderOptions,
  renderResult,
  renderValue,
  unwrapXml,
} from '../output/render.js';
import { terminalSafe } from '../output/terminal.js';
import type { OutputStream, Runtime } from '../runtime.js';
import { renderOptionsOf, type Session } from './session.js';

type Response = Exclude<OperationResult, { readonly kind: 'dry-run' }>;

export interface FileBody {
  readonly data: string | Uint8Array;
  readonly contentType: string;
}

/**
 * Writes text to a stream; on a terminal control characters are replaced (response bodies could
 * carry escape sequences). Bytes and output to pipes and files stay raw.
 */
export function writeText(stream: OutputStream, chunk: string | Uint8Array): void {
  stream.write(typeof chunk === 'string' && stream.isTTY ? terminalSafe(chunk) : chunk);
}

function writeRendered(rendered: Rendered, runtime: Runtime): void {
  if (rendered.stdout !== undefined) writeText(runtime.stdout, rendered.stdout);
  if (rendered.stderr !== undefined) writeText(runtime.stderr, rendered.stderr);
}

/**
 * The XML of an unwrap operation (with a final newline, like stdout); with `--fields` the projected
 * JSON; else the response body exactly as received (JSON re-rendered only for `--all`).
 */
function jsonFileBody(result: Extract<Response, { kind: 'json' }>, options: RenderOptions) {
  const xml = unwrapXml(result.value, options.unwrap);
  if (xml !== undefined) {
    // like stdout: a final newline, but nothing for an empty document
    const data = xml === '' || xml.endsWith('\n') ? xml : `${xml}\n`;
    return { data, contentType: 'application/xml' };
  }
  const data =
    options.fields === undefined && result.text !== undefined
      ? result.text
      : renderValue(result.value, { ...options, format: 'json' });
  return { data, contentType: 'application/json' };
}

/** The response body for `--out-file`: raw, projected with `--fields`, or the unwrapped XML. */
function fileBody(result: Response, options: RenderOptions): FileBody {
  switch (result.kind) {
    case 'json':
      return jsonFileBody(result, options);
    case 'text':
      return { data: result.text, contentType: result.contentType };
    case 'binary':
      return { data: result.data, contentType: result.contentType };
    case 'none':
      return { data: '', contentType: '' };
  }
}

function byteLength(data: string | Uint8Array): number {
  return typeof data === 'string' ? new TextEncoder().encode(data).length : data.length;
}

/**
 * `--out-file`: writes the body to the file and prints the summary `{outFile, bytes,
 * contentType}` (json) or `Wrote n bytes to <path>` (table). `warnings` go to stderr first.
 */
export async function writeOutFile(
  file: { readonly body: FileBody; readonly path: string; readonly warnings: string },
  options: RenderOptions,
  runtime: Runtime,
): Promise<void> {
  const { body, path, warnings } = file;
  try {
    await runtime.fs.writeFile(path, body.data);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw usageError(`Cannot write ${path}: ${reason}`, 'Check the --out-file path.');
  }
  const bytes = byteLength(body.data);
  const summary = { outFile: path, bytes, contentType: body.contentType };
  writeText(runtime.stderr, warnings);
  writeText(
    runtime.stdout,
    options.format === 'json'
      ? renderValue(summary, { format: 'json', pretty: options.pretty, maxWidth: options.maxWidth })
      : `Wrote ${bytes} bytes to ${path}\n`,
  );
}

/** Prints a result (or writes it to `--out-file`); `unwrap` is the XML property, if it applies. */
export async function emitResult(
  result: OperationResult,
  session: Session,
  runtime: Runtime,
  unwrap?: string,
): Promise<void> {
  const options = renderOptionsOf(session, runtime, unwrap);
  const outFile = session.globals.outFile;
  if (outFile !== undefined && result.kind !== 'dry-run') {
    const warnings = result.kind === 'json' ? fieldWarnings(result.value, options.fields) : '';
    await writeOutFile(
      { body: fileBody(result, options), path: outFile, warnings },
      options,
      runtime,
    );
    return;
  }
  if (result.kind === 'binary' && runtime.stdout.isTTY) {
    throw usageError(
      `Binary response (${result.contentType}); use --out-file <path>`,
      'Binary data is only written to stdout when it is redirected to a file or pipe.',
    );
  }
  writeRendered(renderResult(result, options), runtime);
}
