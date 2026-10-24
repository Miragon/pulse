import { describe, expect, it } from 'vitest';
import { findByOperationId, loadCatalog } from '../catalog/catalog.js';
import type { MultipartBodySpec } from '../catalog/types.js';
import { OperateError } from '../errors.js';
import type { FileSystem } from '../runtime.js';
import type { FlagValue } from './command-values.js';
import { buildMultipart, resourceName } from './multipart.js';

const catalog = loadCatalog();

function spec(operationId: string): MultipartBodySpec {
  const body = findByOperationId(catalog, operationId)?.body;
  if (body?.kind !== 'multipart') throw new Error(`${operationId} has no multipart body`);
  return body;
}

function fakeFs(files: Record<string, string>): FileSystem & { reads: string[] } {
  const reads: string[] = [];
  return {
    reads,
    readFile: (path) => {
      reads.push(path);
      const content = files[path];
      if (content === undefined) {
        return Promise.reject(Object.assign(new Error(`ENOENT: ${path}`), { code: 'ENOENT' }));
      }
      return Promise.resolve(new TextEncoder().encode(content));
    },
    writeFile: () => Promise.resolve(),
    mkdir: () => Promise.resolve(),
    exists: (path) => Promise.resolve(path in files),
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

function caughtSync(action: () => unknown): OperateError {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(OperateError);
    return error as OperateError;
  }
  throw new Error('expected an error');
}

const deployment = spec('createDeployment');
const binary = spec('setProcessInstanceVariableBinary');
const files = { 'order.bpmn': '<bpmn/>', 'rules/approval.dmn': '<dmn/>', 'data.bin': 'xyz' };

describe('resourceName', () => {
  it('is the file name without a base directory', () => {
    expect(resourceName('processes/order.bpmn', undefined)).toBe('order.bpmn');
    expect(resourceName('/abs/path/x.dmn', undefined)).toBe('x.dmn');
  });

  it('is the posix path relative to the base directory', () => {
    expect(resourceName('/work/app/processes/order.bpmn', '/work/app')).toBe(
      'processes/order.bpmn',
    );
    expect(resourceName('/work/app/order.bpmn', '/work/app/')).toBe('order.bpmn');
    expect(resourceName('src/a/b.bpmn', 'src')).toBe('a/b.bpmn');
    expect(resourceName('/work/app/..x/y.bpmn', '/work/app')).toBe('..x/y.bpmn');
  });

  it.each([
    ['/work/other/order.bpmn', '/work/app'],
    ['/work/order.bpmn', '/work/app'],
    ['/work/app', '/work/app'],
    ['/work', '/work/app'],
  ])('rejects %s outside --base-dir %s', (file, baseDir) => {
    const error = caughtSync(() => resourceName(file, baseDir));
    expect(error.code).toBe('USAGE');
    expect(error.message).toBe(`File ${file} is not inside --base-dir ${baseDir}`);
    expect(error.details.hint).toBe(
      'Pass files below the base directory, or omit --base-dir to name resources by file name.',
    );
  });
});

describe('buildMultipart', () => {
  it('turns every resource file into a part named after the resource', async () => {
    const fs = fakeFs(files);
    const result = await buildMultipart(deployment, ['order.bpmn', 'rules/approval.dmn'], {}, fs);
    expect(result.fields).toEqual({});
    expect(result.files.map(({ field, fileName }) => ({ field, fileName }))).toEqual([
      { field: 'order.bpmn', fileName: 'order.bpmn' },
      { field: 'approval.dmn', fileName: 'approval.dmn' },
    ]);
    expect(await result.files[0]?.data.text()).toBe('<bpmn/>');
    expect(await result.files[1]?.data.text()).toBe('<dmn/>');
    expect(fs.reads).toEqual(['order.bpmn', 'rules/approval.dmn']);
  });

  it('names resources relative to --base-dir', async () => {
    const result = await buildMultipart(
      deployment,
      ['rules/approval.dmn'],
      { 'base-dir': '.' },
      fakeFs(files),
    );
    expect(result.files[0]?.fileName).toBe('rules/approval.dmn');
    expect(result.files[0]?.field).toBe('rules/approval.dmn');
  });

  it('maps string, boolean and date-time fields', async () => {
    const flags: Record<string, FlagValue> = {
      'deployment-name': 'orders',
      'tenant-id': ['t1', 't2'],
      'enable-duplicate-filtering': true,
      'deploy-changed-only': false,
      'deployment-activation-time': '2024-05-01T10:00Z',
    };
    const result = await buildMultipart(deployment, ['order.bpmn'], flags, fakeFs(files));
    expect(result.fields).toEqual({
      'tenant-id': 't2',
      'deploy-changed-only': 'false',
      'enable-duplicate-filtering': 'true',
      'deployment-name': 'orders',
      'deployment-activation-time': '2024-05-01T10:00:00.000+0000',
    });
  });

  it('validates typed fields', async () => {
    const error = await caught(
      buildMultipart(
        deployment,
        ['order.bpmn'],
        { 'deployment-activation-time': 'soon' },
        fakeFs(files),
      ),
    );
    expect(error.message).toBe('--deployment-activation-time expects a date-time, got "soon"');
    expect(
      (
        await caught(
          buildMultipart(
            deployment,
            ['order.bpmn'],
            { 'deploy-changed-only': 'maybe' },
            fakeFs(files),
          ),
        )
      ).message,
    ).toBe('--deploy-changed-only expects true or false, got "maybe"');
  });

  it('requires at least one resource file', async () => {
    const error = await caught(buildMultipart(deployment, [], {}, fakeFs(files)));
    expect(error.code).toBe('USAGE');
    expect(error.message).toBe('At least one resource file is required');
    expect(error.details.hint).toBe(
      'Example: operate deployment create order.bpmn approval.dmn --deployment-name orders',
    );
  });

  it('rejects duplicate resource names', async () => {
    const error = await caught(
      buildMultipart(deployment, ['a/x.bpmn', 'b/x.bpmn'], {}, fakeFs({})),
    );
    expect(error.message).toBe('Duplicate resource name "x.bpmn" (a/x.bpmn and b/x.bpmn)');
    expect(error.details.hint).toBe(
      'Use --base-dir to name resources by their path relative to a directory.',
    );
  });

  it.each(['tenant-id', 'deployment-name', 'deploy-changed-only'])(
    'rejects the resource name %s that is also a form field',
    async (name) => {
      const fs = fakeFs({ [`dir/${name}`]: 'x' });
      const error = await caught(buildMultipart(deployment, [`dir/${name}`], {}, fs));
      expect(error.code).toBe('USAGE');
      expect(error.message).toBe(
        `Resource name "${name}" of dir/${name} is reserved for the form field --${name}`,
      );
      expect(error.details.hint).toBe(
        'Rename the file, or use --base-dir to name it by its path relative to a directory.',
      );
      expect(fs.reads).toEqual([]);
      const result = await buildMultipart(deployment, [`dir/${name}`], { 'base-dir': '.' }, fs);
      expect(result.files.map((file) => file.field)).toEqual([`dir/${name}`]);
    },
  );

  it('names the flag of a renamed field when a resource name clashes', async () => {
    const renamed: MultipartBodySpec = {
      ...deployment,
      fields: [{ name: 'url', flag: 'body-url', type: 'string', description: '' }],
    };
    const error = await caught(buildMultipart(renamed, ['url'], {}, fakeFs({ url: 'x' })));
    expect(error.message).toBe(
      'Resource name "url" of url is reserved for the form field --body-url',
    );
  });

  it('names missing files', async () => {
    const error = await caught(buildMultipart(deployment, ['missing.bpmn'], {}, fakeFs(files)));
    expect(error.code).toBe('USAGE');
    expect(error.message).toBe('File not found: missing.bpmn');
  });

  it('reads binary fields from files named by their flag', async () => {
    const result = await buildMultipart(
      binary,
      [],
      { data: 'rules/../data.bin', 'value-type': 'File' },
      fakeFs({ 'rules/../data.bin': 'xyz' }),
    );
    expect(result.fields).toEqual({ valueType: 'File' });
    expect(result.files).toHaveLength(1);
    expect(result.files[0]?.field).toBe('data');
    expect(result.files[0]?.fileName).toBe('data.bin');
    expect(await result.files[0]?.data.text()).toBe('xyz');
  });

  it('omits binary fields that are not given', async () => {
    const result = await buildMultipart(binary, [], {}, fakeFs(files));
    expect(result).toEqual({ fields: {}, files: [] });
  });

  it('ignores positional files for operations without resources', async () => {
    const result = await buildMultipart(binary, ['order.bpmn'], {}, fakeFs(files));
    expect(result.files).toEqual([]);
  });

  it('maps renamed fields to their wire name', async () => {
    const attachment = spec('addAttachment');
    const result = await buildMultipart(
      attachment,
      [],
      { 'body-url': 'https://x', 'attachment-name': 'n', content: 'data.bin' },
      fakeFs(files),
    );
    expect(result.fields).toEqual({ 'attachment-name': 'n', url: 'https://x' });
    expect(result.files.map((file) => [file.field, file.fileName])).toEqual([
      ['content', 'data.bin'],
    ]);
  });
});
