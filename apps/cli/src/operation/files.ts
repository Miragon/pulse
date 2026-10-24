/** Reads files named on the command line, turning file system errors into usage errors. */

import { type OperateError, usageError } from '../errors.js';
import type { FileSystem } from '../runtime.js';

function errorCode(error: unknown): unknown {
  return typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
}

function fileError(path: string, error: unknown): OperateError {
  const code = errorCode(error);
  if (code === 'ENOENT') {
    return usageError(
      `File not found: ${path}`,
      'Relative paths are resolved against the current directory.',
    );
  }
  if (code === 'EISDIR') return usageError(`Not a file: ${path}`, 'Pass the path of a file.');
  const reason = error instanceof Error ? error.message : String(error);
  return usageError(`Cannot read file ${path}: ${reason}`);
}

export async function readInputFile(fs: FileSystem, path: string): Promise<Uint8Array> {
  // e.g. `--body @` or an empty positional; the file system error would name no path at all
  if (path === '') throw usageError('File path must not be empty', 'Pass the path of a file.');
  try {
    return await fs.readFile(path);
  } catch (error) {
    throw fileError(path, error);
  }
}
