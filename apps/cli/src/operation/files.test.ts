import { describe, expect, it } from 'vitest';
import { OperateError } from '../errors.js';
import type { FileSystem } from '../runtime.js';
import { readInputFile } from './files.js';

function failingFs(error: unknown): FileSystem {
  return {
    readFile: () =>
      Promise.resolve().then(() => {
        throw error;
      }),
    writeFile: () => Promise.resolve(),
    mkdir: () => Promise.resolve(),
    exists: () => Promise.resolve(false),
    remove: () => Promise.resolve(false),
    readdir: () => Promise.resolve([]),
    kind: () => Promise.resolve('missing' as const),
  };
}

async function caught(promise: Promise<unknown>): Promise<OperateError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(OperateError);
    return error as OperateError;
  }
  throw new Error('expected an error');
}

describe('readInputFile', () => {
  it('returns the file content', async () => {
    const data = new Uint8Array([1, 2, 3]);
    const fs = { ...failingFs(undefined), readFile: () => Promise.resolve(data) };
    await expect(readInputFile(fs, 'a.bin')).resolves.toBe(data);
  });

  it('rejects an empty path without touching the file system', async () => {
    let reads = 0;
    const fs = {
      ...failingFs(undefined),
      readFile: () => {
        reads++;
        return Promise.resolve(new Uint8Array());
      },
    };
    const error = await caught(readInputFile(fs, ''));
    expect(error.code).toBe('USAGE');
    expect(error.message).toBe('File path must not be empty');
    expect(error.details.hint).toBe('Pass the path of a file.');
    expect(reads).toBe(0);
    await expect(readInputFile(fs, ' ')).resolves.toEqual(new Uint8Array());
  });

  it('reports missing files', async () => {
    const error = await caught(
      readInputFile(
        failingFs(Object.assign(new Error('ENOENT: no such file'), { code: 'ENOENT' })),
        'x.bpmn',
      ),
    );
    expect(error.code).toBe('USAGE');
    expect(error.message).toBe('File not found: x.bpmn');
    expect(error.details.hint).toBe('Relative paths are resolved against the current directory.');
  });

  it('reports directories', async () => {
    const error = await caught(
      readInputFile(failingFs(Object.assign(new Error('EISDIR'), { code: 'EISDIR' })), 'dir'),
    );
    expect(error.message).toBe('Not a file: dir');
    expect(error.details.hint).toBe('Pass the path of a file.');
  });

  it('reports other errors with their message', async () => {
    const error = await caught(
      readInputFile(
        failingFs(Object.assign(new Error('permission denied'), { code: 'EACCES' })),
        'f',
      ),
    );
    expect(error.code).toBe('USAGE');
    expect(error.message).toBe('Cannot read file f: permission denied');
    expect(error.details).toEqual({});
  });

  it('reports non-Error rejections', async () => {
    expect((await caught(readInputFile(failingFs('boom'), 'f'))).message).toBe(
      'Cannot read file f: boom',
    );
    expect((await caught(readInputFile(failingFs(null), 'f'))).message).toBe(
      'Cannot read file f: null',
    );
  });
});
