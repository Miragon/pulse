import { describe, expect, it } from 'vitest';
import { fakeRuntime } from '../../test/support/fake-runtime.js';
import { findByOperationId, loadCatalog } from '../catalog/catalog.js';
import type { MultipartBodySpec } from '../catalog/types.js';
import { OperateError } from '../errors.js';
import { bpmnProcessIds, collectResources, isBpmn, isDmn } from './resources.js';

const spec = findByOperationId(loadCatalog(), 'createDeployment')?.body as MultipartBodySpec;

const FILES = {
  'project/src/main/resources/order.bpmn': '<x/>',
  'project/src/main/resources/sub/approval.dmn': '<x/>',
  'project/src/main/resources/sub/legacy.bpmn20.xml': '<x/>',
  'project/src/main/resources/sub/old.dmn11.xml': '<x/>',
  'project/src/main/resources/forms/approve.form': '{}',
  'project/src/main/resources/notes.txt': 'skip',
  'project/src/main/resources/.git/stale.bpmn': '<x/>',
  'project/src/main/resources/node_modules/dep/x.bpmn': '<x/>',
  'project/script.js': 'x',
};

function fs(others: readonly string[] = []) {
  return fakeRuntime({ files: FILES, others, dirs: ['project/empty'] }).fs;
}

async function usage(promise: Promise<unknown>): Promise<OperateError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof OperateError) return error;
  }
  throw new Error('expected a usage error');
}

describe('collectResources', () => {
  it('scans directories recursively, skipping dot-directories, node_modules and other files, sorted by path', async () => {
    const resources = await collectResources(fs(), ['project/src/main/resources'], { spec });
    expect(resources).toEqual([
      { file: 'project/src/main/resources/forms/approve.form', name: 'forms/approve.form' },
      { file: 'project/src/main/resources/order.bpmn', name: 'order.bpmn' },
      { file: 'project/src/main/resources/sub/approval.dmn', name: 'sub/approval.dmn' },
      { file: 'project/src/main/resources/sub/legacy.bpmn20.xml', name: 'sub/legacy.bpmn20.xml' },
      { file: 'project/src/main/resources/sub/old.dmn11.xml', name: 'sub/old.dmn11.xml' },
    ]);
  });

  it('names explicit files by their basename (any extension) and everything relative to --base-dir', async () => {
    expect(await collectResources(fs(), ['project/script.js'], { spec })).toEqual([
      { file: 'project/script.js', name: 'script.js' },
    ]);
    const based = await collectResources(
      fs(),
      ['project/script.js', 'project/src/main/resources/sub'],
      { spec, baseDir: 'project' },
    );
    expect(based.map((resource) => resource.name)).toEqual([
      'script.js',
      'src/main/resources/sub/approval.dmn',
      'src/main/resources/sub/legacy.bpmn20.xml',
      'src/main/resources/sub/old.dmn11.xml',
    ]);
  });

  it('does not follow symlinked directories', async () => {
    const resources = await collectResources(
      fs(['project/src/main/resources/linked']),
      ['project/src/main/resources/sub'],
      { spec },
    );
    expect(resources).toHaveLength(3);
  });

  it('refuses missing paths, other kinds, empty scans, no paths and duplicate or reserved names', async () => {
    expect((await usage(collectResources(fs(), [], { spec }))).message).toBe(
      'At least one file or directory is required',
    );
    expect((await usage(collectResources(fs(), ['nope'], { spec }))).message).toBe(
      'File not found: nope',
    );
    expect((await usage(collectResources(fs(['odd']), ['odd'], { spec }))).message).toBe(
      'Not a file or directory: odd',
    );
    expect((await usage(collectResources(fs(), ['project/empty'], { spec }))).message).toBe(
      'No BPMN, DMN or form files in project/empty',
    );
    // two files with the same name are a conflict (one file given twice is not)
    const duplicate = await usage(
      collectResources(
        fakeRuntime({ files: { 'a/order.bpmn': '<x/>', 'b/order.bpmn': '<y/>' } }).fs,
        ['a/order.bpmn', 'b/order.bpmn'],
        { spec },
      ),
    );
    expect(duplicate.message).toMatch(/^Duplicate resource name "order.bpmn"/);
    const reserved = fakeRuntime({ files: { 'x/deployment-name': '<x/>' } }).fs;
    expect(
      (await usage(collectResources(reserved, ['x/deployment-name'], { spec }))).message,
    ).toMatch(/is reserved for the form field --deployment-name/);
    const outside = await usage(
      collectResources(fs(), ['project/script.js'], { spec, baseDir: 'project/src' }),
    );
    expect(outside.message).toBe('File project/script.js is not inside --base-dir project/src');
  });
});

describe('collectResources with a file given twice', () => {
  it('deploys a file once, also when named explicitly and inside a directory argument', async () => {
    const files = { 'd2/sub/dec.dmn': '<x/>', 'd2/sub/order.bpmn': '<x/>' };
    const resources = await collectResources(
      fakeRuntime({ files }).fs,
      ['d2/sub/dec.dmn', 'd2/sub', 'd2/sub/dec.dmn'],
      { spec },
    );
    expect(resources).toEqual([
      { file: 'd2/sub/dec.dmn', name: 'dec.dmn' },
      { file: 'd2/sub/order.bpmn', name: 'order.bpmn' },
    ]);
  });
});

describe('bpmnProcessIds', () => {
  it('finds the executable processes with any namespace prefix, in document order', () => {
    const xml = [
      '<?xml version="1.0"?><bpmn:definitions xmlns:bpmn="x">',
      '<bpmn:process id="order" isExecutable="true">',
      '<bpmn:participant processRef="order"/><bpmn:processX id="no"/>',
      "</bpmn:process><semantic:process isExecutable='true' id='invoice'/>",
      '<process id="plain">',
      '<bpmn:process id="draft" isExecutable="false"/><bpmn:process name="no id"/>',
      '<bpmn:process camunda:id="wrong" id="" />',
      '</bpmn:definitions>',
    ].join('\n');
    expect(bpmnProcessIds(xml)).toEqual(['order', 'invoice', 'plain']);
    expect(bpmnProcessIds('<x/>')).toEqual([]);
  });
});

describe('isBpmn and isDmn', () => {
  it('tell process and decision resources by extension', () => {
    expect(['a.bpmn', 'a.bpmn20.xml', 'a.dmn', 'a.form'].map(isBpmn)).toEqual([
      true,
      true,
      false,
      false,
    ]);
    expect(['a.dmn', 'a.dmn11.xml', 'a.bpmn', 'a.xml'].map(isDmn)).toEqual([
      true,
      true,
      false,
      false,
    ]);
  });
});

describe('collectResources details', () => {
  it('deploys only names that end in a deployable extension and scans directories named like files', async () => {
    const files = {
      'r/a.bpmn.bak': '<x/>',
      'r/b.bpmn20.xml.orig': '<x/>',
      'r/c.dmn11.xml~': '<x/>',
      'r/d.formx': '{}',
      'r/e.dmn.old': '<x/>',
      'r/weird.bpmn/inner.dmn': '<x/>',
    };
    const runtime = fakeRuntime({ files });
    expect(await collectResources(runtime.fs, ['r'], { spec })).toEqual([
      { file: 'r/weird.bpmn/inner.dmn', name: 'weird.bpmn/inner.dmn' },
    ]);
  });

  it('names the fix in every usage error', async () => {
    const hints = await Promise.all(
      [
        collectResources(fs(), [], { spec }),
        collectResources(fs(), ['nope'], { spec }),
        collectResources(fs(['odd']), ['odd'], { spec }),
        collectResources(fs(), ['project/empty'], { spec }),
      ].map(async (promise) => (await usage(promise)).details.hint),
    );
    expect(hints).toEqual([
      'Example: operate deploy src/main/resources, or operate deploy . for the current directory.',
      'Relative paths are resolved against the current directory.',
      'Pass BPMN, DMN or form files, or directories.',
      'A directory deploys its *.bpmn, *.bpmn20.xml, *.dmn, *.dmn11.xml and *.form files (dot-directories and node_modules are skipped); name other files explicitly.',
    ]);
  });

  it('names an explicit file in a subdirectory by its basename without --base-dir', async () => {
    expect(
      await collectResources(fs(), ['project/src/main/resources/sub/approval.dmn'], { spec }),
    ).toEqual([{ file: 'project/src/main/resources/sub/approval.dmn', name: 'approval.dmn' }]);
  });
});

describe('isBpmn and isDmn anchors', () => {
  it('needs the extension at the end', () => {
    expect(['a.bpmn.bak', 'a.bpmn20.xml.bak', 'a.bpmnx'].map(isBpmn)).toEqual([
      false,
      false,
      false,
    ]);
    expect(['a.dmn.bak', 'a.dmn11.xml.bak', 'a.dmnx'].map(isDmn)).toEqual([false, false, false]);
  });
});
