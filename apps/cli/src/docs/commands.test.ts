import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { loadCatalog, operationsInGroup } from '../catalog/catalog.js';
import type { Catalog, Effect, OperationSpec } from '../catalog/types.js';
import { type CommandSummary, listCommands, listGroups } from './commands.js';

const catalog = loadCatalog();
const EFFECTS: readonly Effect[] = ['read', 'write', 'delete', 'bulk'];

function fakeOperation(
  group: string,
  name: string,
  extra: Partial<OperationSpec> = {},
): OperationSpec {
  return {
    operationId: `${group}-${name}`,
    group,
    name,
    aliases: [],
    method: 'GET',
    path: `/${group}/${name}`,
    summary: `${name} of ${group}`,
    description: '',
    deprecated: false,
    effect: 'read',
    engineScoped: true,
    params: [],
    responses: [],
    ...extra,
  };
}

const fakeCatalog: Catalog = {
  source: { title: 'fake', version: '1', url: 'https://example.com' },
  groups: [
    { name: 'zeta', tag: 'Zeta', description: 'Last group' },
    { name: 'alpha', tag: 'Alpha', description: 'First group' },
    { name: 'alpha-beta', tag: 'Alpha Beta', description: 'Prefixed group' },
  ],
  operations: [
    fakeOperation('zeta', 'list'),
    fakeOperation('alpha', 'get', { effect: 'read', aliases: ['fetch-one'] }),
    fakeOperation('alpha-beta', 'delete', { effect: 'delete', method: 'DELETE', deprecated: true }),
    fakeOperation('alpha', 'delete', { effect: 'delete', method: 'DELETE', summary: 'Remove it' }),
  ],
  schemas: {},
};

/** Reference for --search: every word of the text occurs in one of the searched fields. */
function matchesText(summary: CommandSummary, search: string): boolean {
  const fields = [
    summary.command,
    ...summary.aliases,
    summary.operationId,
    summary.summary,
    summary.path,
  ].map((text) => text.toLowerCase());
  return search
    .toLowerCase()
    .split(/\s+/)
    .every((word) => fields.some((text) => text.includes(word)));
}

describe('listGroups', () => {
  it('lists every group with its description and command count, sorted by name', () => {
    expect(listGroups(fakeCatalog)).toEqual([
      { group: 'alpha', description: 'First group', commands: 2 },
      { group: 'alpha-beta', description: 'Prefixed group', commands: 1 },
      { group: 'zeta', description: 'Last group', commands: 1 },
    ]);
  });

  it('covers the whole catalog', () => {
    const groups = listGroups(catalog);
    expect(groups).toHaveLength(catalog.groups.length);
    expect(groups.reduce((sum, group) => sum + group.commands, 0)).toBe(catalog.operations.length);
    expect(groups.find((group) => group.group === 'engine')).toEqual({
      group: 'engine',
      description: 'List the process engines served by this REST API',
      commands: 1,
    });
    for (const group of groups) {
      expect(group.commands).toBe(operationsInGroup(catalog, group.group).length);
    }
  });
});

describe('listCommands', () => {
  it('summarizes the commands of a group', () => {
    expect(listCommands(catalog, { group: 'engine' })).toEqual([
      {
        command: 'engine list',
        aliases: ['get-process-engine-names'],
        operationId: 'getProcessEngineNames',
        method: 'GET',
        path: '/engine',
        effect: 'read',
        summary: catalog.operations.find((o) => o.operationId === 'getProcessEngineNames')!.summary,
        deprecated: false,
      },
    ]);
  });

  it('sorts by group, then by command name', () => {
    expect(listCommands(fakeCatalog, {}).map((summary) => summary.command)).toEqual([
      'alpha delete',
      'alpha get',
      'alpha-beta delete',
      'zeta list',
    ]);
  });

  it('keeps deprecated flags, methods and aliases', () => {
    expect(listCommands(fakeCatalog, { group: 'alpha-beta' })).toEqual([
      {
        command: 'alpha-beta delete',
        aliases: [],
        operationId: 'alpha-beta-delete',
        method: 'DELETE',
        path: '/alpha-beta/delete',
        effect: 'delete',
        summary: 'delete of alpha-beta',
        deprecated: true,
      },
    ]);
  });

  it('returns nothing for an unknown group', () => {
    expect(listCommands(catalog, { group: 'no-such-group' })).toEqual([]);
  });

  it('filters by effect', () => {
    expect(listCommands(fakeCatalog, { effect: 'delete' }).map((s) => s.command)).toEqual([
      'alpha delete',
      'alpha-beta delete',
    ]);
    const bulk = listCommands(catalog, { effect: 'bulk' });
    expect(bulk.length).toBeGreaterThan(0);
    expect(bulk.every((summary) => summary.effect === 'bulk')).toBe(true);
  });

  it('searches case-insensitively in command, aliases, operationId, summary and path', () => {
    const commands = (search: string) =>
      listCommands(fakeCatalog, { search }).map((summary) => summary.command);
    expect(commands('ZETA LIST')).toEqual(['zeta list']);
    expect(commands('Fetch-One')).toEqual(['alpha get']);
    expect(commands('ALPHA-GET')).toEqual(['alpha get']);
    expect(commands('remove')).toEqual(['alpha delete']);
    expect(commands('/alpha-beta/')).toEqual(['alpha-beta delete']);
    expect(commands('nothing matches')).toEqual([]);
    expect(commands('')).toHaveLength(4);
    expect(commands(' \t ')).toHaveLength(4);
  });

  it('needs every word of the search, in any order and in any of the fields', () => {
    const commands = (search: string) =>
      listCommands(fakeCatalog, { search }).map((summary) => summary.command);
    expect(commands('list zeta')).toEqual(['zeta list']);
    expect(commands('  alpha   remove ')).toEqual(['alpha delete']);
    expect(commands('alpha remove zeta')).toEqual([]);
    // a word does not match across the end of one field and the start of the next
    expect(commands('get\nfetch')).toEqual(['alpha get']);
    expect(commands('getfetch')).toEqual([]);
  });

  it('finds the commands of a group by its name written as words', () => {
    const found = listCommands(catalog, { search: 'Process Instance' }).map((s) => s.command);
    expect(found).toContain('process-instance list');
    expect(found).toContain('historic-process-instance list');
    expect(listCommands(catalog, { search: 'complete task' }).map((s) => s.command)).toContain(
      'task complete',
    );
  });

  it('finds real commands by operationId and path', () => {
    expect(listCommands(catalog, { search: 'FETCHANDLOCK' }).map((s) => s.command)).toEqual([
      'external-task fetch-and-lock',
    ]);
    expect(
      listCommands(catalog, { search: '/history/process-instance/{id}' }).map((s) => s.command),
    ).toEqual([
      'historic-process-instance delete',
      'historic-process-instance delete-variable-instances',
      'historic-process-instance get',
    ]);
  });

  it('combines group, effect and search', () => {
    expect(
      listCommands(catalog, { group: 'process-instance', effect: 'bulk', search: 'delete' }).map(
        (s) => s.command,
      ),
    ).toEqual([
      'process-instance delete-async',
      'process-instance delete-async-historic-query-based',
    ]);
  });

  it('returns exactly the operations of a group', () => {
    fc.assert(
      fc.property(fc.constantFrom(...catalog.groups.map((group) => group.name)), (group) => {
        const ids = listCommands(catalog, { group }).map((s) => `${s.command}/${s.operationId}`);
        const expected = operationsInGroup(catalog, group).map(
          (o) => `${o.group} ${o.name}/${o.operationId}`,
        );
        expect(ids.sort()).toEqual(expected.sort());
      }),
    );
  });

  it('returns exactly the commands matching the search text in one of the searched fields', () => {
    const fragments = catalog.operations.flatMap((o) => [o.name, o.operationId, o.path, o.summary]);
    const search = fc.oneof(
      fc.string({ maxLength: 4 }),
      fc
        .tuple(fc.constantFrom(...fragments), fc.nat(), fc.nat({ max: 6 }), fc.boolean())
        .map(([text, start, length, upper]) => {
          const begin = start % Math.max(1, text.length);
          const fragment = text.slice(begin, begin + length + 1);
          return upper ? fragment.toUpperCase() : fragment;
        }),
    );
    fc.assert(
      fc.property(
        search,
        fc.option(fc.constantFrom(...EFFECTS), { nil: undefined }),
        (text, effect) => {
          const filter = effect === undefined ? { search: text } : { search: text, effect };
          const results = listCommands(catalog, filter);
          for (const summary of results) {
            expect(matchesText(summary, text)).toBe(true);
            if (effect !== undefined) expect(summary.effect).toBe(effect);
          }
          const all = listCommands(catalog, effect === undefined ? {} : { effect });
          expect(results).toEqual(all.filter((summary) => matchesText(summary, text)));
        },
      ),
    );
  });
});
