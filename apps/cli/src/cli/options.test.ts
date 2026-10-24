import { Command } from 'commander';
import { describe, expect, it } from 'vitest';
import { findOperation, loadCatalog } from '../catalog/catalog.js';
import { type OptionDoc, operationOptions } from '../docs/options.js';
import type { CommandValues } from '../operation/input.js';
import { helpConfiguration } from './help.js';
import {
  addOperationOptions,
  collect,
  commandValues,
  createOptions,
  optionDescription,
} from './options.js';

const catalog = loadCatalog();

function parse(group: string, name: string, args: readonly string[]): CommandValues {
  const operation = findOperation(catalog, group, name);
  if (operation === undefined) throw new Error(`unknown command ${group} ${name}`);
  const command = new Command(name).exitOverride().allowExcessArguments(true);
  const registered = addOperationOptions(command, operationOptions(operation, catalog.schemas));
  command.action(() => undefined).parse([...args], { from: 'user' });
  return commandValues(command, registered);
}

function doc(overrides: Partial<OptionDoc>): OptionDoc {
  return {
    flag: 'x',
    syntax: '--x <value>',
    kind: 'value',
    valueName: '<value>',
    type: 'string',
    required: false,
    source: 'query',
    description: 'An option.',
    ...overrides,
  };
}

describe('collect', () => {
  it('collects every occurrence in order', () => {
    expect(collect('a', undefined)).toEqual(['a']);
    expect(collect('b', ['a'])).toEqual(['a', 'b']);
    expect(collect('b', 'not a list')).toEqual(['b']);
  });

  it('does not modify the previous list', () => {
    const previous = ['a'];
    collect('b', previous);
    expect(previous).toEqual(['a']);
  });
});

describe('optionDescription', () => {
  it('adds the choices and the required marker', () => {
    expect(optionDescription(doc({}))).toBe('An option.');
    expect(optionDescription(doc({ enum: ['asc', 'desc'] }))).toBe(
      'An option. (choices: asc, desc)',
    );
    expect(optionDescription(doc({ required: true }))).toBe('An option. (required)');
    expect(optionDescription(doc({ description: '', required: true }))).toBe('(required)');
  });
});

describe('createOptions', () => {
  it('creates one commander option per kind, a hidden twin for booleans', () => {
    const shape = (options: ReturnType<typeof createOptions>) =>
      options.map((option) => [option.flags, option.negate, option.hidden, option.attributeName()]);
    expect(shape(createOptions(doc({ flag: 'max-results', valueName: '<n>' })))).toEqual([
      ['--max-results <n>', false, false, 'maxResults'],
    ]);
    const { valueName: _unused, ...withoutValueName } = doc({ kind: 'repeatable', flag: 'var' });
    expect(shape(createOptions(withoutValueName))).toEqual([
      ['--var <value>', false, false, 'var'],
    ]);
    expect(shape(createOptions(doc({ kind: 'presence', flag: 'all' })))).toEqual([
      ['--all', false, false, 'all'],
    ]);
    expect(shape(createOptions(doc({ kind: 'presence', flag: 'no-retries-left' })))).toEqual([
      ['--no-retries-left', false, false, 'noRetriesLeft'],
    ]);
    expect(shape(createOptions(doc({ kind: 'negated', flag: 'validate' })))).toEqual([
      ['--no-validate', true, false, 'validate'],
    ]);
    expect(shape(createOptions(doc({ kind: 'boolean', flag: 'skip-io' })))).toEqual([
      ['--skip-io', false, false, 'skipIo'],
      ['--no-skip-io', true, true, 'skipIo'],
    ]);
  });

  it('uses the syntax as help term', () => {
    const command = new Command('x').configureHelp(helpConfiguration());
    addOperationOptions(command, [
      doc({ kind: 'boolean', flag: 'skip-io', syntax: '--[no-]skip-io' }),
    ]);
    expect(command.helpInformation()).toContain('  --[no-]skip-io  An option.\n');
  });
});

describe('commandValues', () => {
  it('maps booleans: --x is true, --no-x is false, absent is not given', () => {
    expect(parse('process-instance', 'delete', ['id', '--skip-io-mappings']).flags).toEqual({
      'skip-io-mappings': true,
    });
    expect(parse('process-instance', 'delete', ['id', '--no-skip-io-mappings']).flags).toEqual({
      'skip-io-mappings': false,
    });
    expect(parse('process-instance', 'delete', ['id']).flags).toEqual({});
  });

  it('lets the last of --x and --no-x win', () => {
    const values = parse('process-instance', 'delete', [
      '--no-skip-subprocesses',
      '--skip-subprocesses',
    ]);
    expect(values.flags).toEqual({ 'skip-subprocesses': true });
  });

  it('maps presence flags, including flags that start with no-', () => {
    expect(parse('job', 'list', ['--no-retries-left', '--with-exception', '--all']).flags).toEqual({
      'no-retries-left': true,
      'with-exception': true,
      all: true,
    });
  });

  it('maps the negated --no-validate to false and leaves it out when absent', () => {
    expect(parse('task', 'claim', ['t1', '--no-validate']).flags).toEqual({ validate: false });
    expect(parse('task', 'claim', ['t1']).flags).toEqual({});
  });

  it('collects repeatable options and keeps the last value of single options', () => {
    const values = parse('process-definition', 'start', [
      'invoice',
      '--var',
      'a=1',
      '--business-key',
      'first',
      '--var',
      'b=2,3',
      '--business-key',
      'second',
    ]);
    expect(values).toEqual({
      args: ['invoice'],
      flags: { var: ['a=1', 'b=2,3'], 'business-key': 'second' },
    });
    const ids = parse('process-instance', 'delete-async', [
      '--process-instance-ids',
      'a,b',
      '--process-instance-ids',
      'c',
    ]);
    expect(ids.flags).toEqual({ 'process-instance-ids': ['a,b', 'c'] });
  });

  it('keeps positional arguments in order', () => {
    expect(parse('deployment', 'create', ['a.bpmn', '--deployment-name', 'n', 'b.dmn'])).toEqual({
      args: ['a.bpmn', 'b.dmn'],
      flags: { 'deployment-name': 'n' },
    });
  });
});
