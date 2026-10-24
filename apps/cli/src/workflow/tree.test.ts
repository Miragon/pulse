import { describe, expect, it } from 'vitest';
import { portOf } from '../../test/support/engine-port.js';
import { fakeServer, json } from '../../test/support/fake-fetch.js';
import { activeTree, treeNode } from './tree.js';

/** A fake engine whose instances have the children of `children` (parent id → child ids). */
function engine(children: Readonly<Record<string, readonly string[]>>) {
  return fakeServer().on('GET', '/process-instance', (request) => {
    const parent = request.query.get('superProcessInstance') ?? '';
    return json(
      (children[parent] ?? []).map((id) => ({
        id,
        definitionId: `child:1:${id}`,
        businessKey: null,
        suspended: id.endsWith('s'),
      })),
    );
  });
}

describe('treeNode', () => {
  it('reads a ProcessInstanceDto; the key from definitionKey or the definition id', () => {
    expect(
      treeNode(
        {
          id: 'p',
          definitionId: 'order:2:x',
          definitionKey: 'order',
          businessKey: 'B',
          suspended: true,
        },
        'parent',
        1,
      ),
    ).toEqual({
      id: 'p',
      parentId: 'parent',
      definitionId: 'order:2:x',
      definitionKey: 'order',
      businessKey: 'B',
      suspended: true,
      depth: 1,
    });
    expect(treeNode({ id: 'p', definitionId: 'order:2:x' }, undefined, 0)).toEqual({
      id: 'p',
      definitionId: 'order:2:x',
      definitionKey: 'order',
      suspended: false,
      depth: 0,
    });
    expect(treeNode({ id: 'p' }, undefined, 0)).toEqual({
      id: 'p',
      definitionId: '',
      suspended: false,
      depth: 0,
    });
    expect(treeNode({}, undefined, 0)).toBeUndefined();
  });
});

describe('activeTree', () => {
  it('walks the called instances breadth first, one round per level', async () => {
    const server = engine({ root: ['a', 'bs'], a: ['a1'], bs: [] });
    const tree = await activeTree(portOf(server.fetch), { id: 'root', definitionId: 'parent:1:x' });
    expect(tree.truncated).toBe(false);
    expect(tree.nodes.map((node) => [node.id, node.parentId, node.depth, node.suspended])).toEqual([
      ['root', undefined, 0, false],
      ['a', 'root', 1, false],
      ['bs', 'root', 1, true],
      ['a1', 'a', 2, false],
    ]);
    expect(server.requests.map((request) => request.query.get('superProcessInstance'))).toEqual([
      'root',
      'a',
      'bs',
      'a1',
    ]);
  });

  it('cuts the tree below depth 10', async () => {
    const chain = Object.fromEntries(
      Array.from({ length: 12 }, (_, index) => [
        index === 0 ? 'root' : `c${index}`,
        [`c${index + 1}`],
      ]),
    );
    const tree = await activeTree(portOf(engine(chain).fetch), { id: 'root' });
    expect(tree.truncated).toBe(true);
    expect(tree.nodes.at(-1)).toMatchObject({ id: 'c10', depth: 10 });
  });

  it('cuts the tree at 100 instances', async () => {
    const wide = {
      root: Array.from({ length: 60 }, (_, index) => `w${index}`),
      w0: Array.from({ length: 60 }, (_, index) => `x${index}`),
    };
    const tree = await activeTree(portOf(engine(wide).fetch), { id: 'root' });
    expect(tree.truncated).toBe(true);
    expect(tree.nodes).toHaveLength(100);
  });

  it('is truncated when a level has more children than one page loads', async () => {
    const many = { root: Array.from({ length: 101 }, (_, index) => `m${index}`) };
    const tree = await activeTree(portOf(engine(many).fetch), { id: 'root' });
    expect(tree.truncated).toBe(true);
  });

  it('is empty for a DTO without id', async () => {
    expect(await activeTree(portOf(engine({}).fetch), {})).toEqual({ nodes: [], truncated: false });
  });
});

describe('activeTree limits', () => {
  it('keeps exactly 100 instances untruncated and skips children without id', async () => {
    const full = { root: Array.from({ length: 99 }, (_, index) => `f${index}`) };
    const tree = await activeTree(portOf(engine(full).fetch), { id: 'root' });
    expect(tree).toMatchObject({ truncated: false });
    expect(tree.nodes).toHaveLength(100);
    const server = fakeServer().on('GET', '/process-instance', (request) =>
      json(
        request.query.get('superProcessInstance') === 'root'
          ? [{ businessKey: 'x' }, { id: 'k' }]
          : [],
      ),
    );
    const sparse = await activeTree(portOf(server.fetch), { id: 'root' });
    expect(sparse.nodes.map((node) => [node.id, node.parentId])).toEqual([
      ['root', undefined],
      ['k', 'root'],
    ]);
  });

  it('keeps depth 10 and cuts depth 11', async () => {
    const chain = Object.fromEntries(
      Array.from({ length: 10 }, (_, index) => [
        index === 0 ? 'root' : `c${index}`,
        [`c${index + 1}`],
      ]),
    );
    const tree = await activeTree(portOf(engine(chain).fetch), { id: 'root' });
    expect(tree.truncated).toBe(false);
    expect(tree.nodes.at(-1)).toMatchObject({ id: 'c10', depth: 10 });
  });
});
