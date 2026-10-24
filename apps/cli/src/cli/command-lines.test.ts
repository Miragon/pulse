/**
 * Every example command line (curated and generic) and every `operate` command in the code blocks
 * of the guide (the core and every topic) must be valid against the catalog: known group and
 * command, the right number of positional arguments, only options the command registers (operation
 * options from `operationOptions`, `--no-x` for boolean options, the global options of
 * GLOBAL_FLAGS) and values the CLI accepts. So neither the examples nor the guide can drift from
 * the catalog.
 */

import { describe, expect, it } from 'vitest';
import { GLOBAL_FLAGS } from '../../scripts/catalog/flags.js';
import { DOC_PAGES } from '../../test/support/doc-pages.js';
import { GUIDE_PAGES } from '../../test/support/guide-pages.js';
import { findByOperationId, findGroup, findOperation, loadCatalog } from '../catalog/catalog.js';
import { EFFECTS, type OperationSpec } from '../catalog/types.js';
import { GLOBAL_OPTIONS } from './globals.js';
import { validateBody } from '../catalog/validate.js';
import { normalizeDateTime } from '../operation/dates.js';
import { parseVariable } from '../operation/variables.js';
import { examplesFor } from '../docs/examples.js';
import { findGuideTopic } from '../docs/guide.js';
import { type OptionDoc, operationArguments, operationOptions } from '../docs/options.js';
import { commandWords } from '../docs/text.js';
import { findWorkflow, WORKFLOW_DOCS, type WorkflowDoc } from '../docs/workflow.js';
import { parseDuration } from '../operation/durations.js';
import { parseCondition } from '../workflow/conditions.js';

const catalog = loadCatalog();

interface FlagSpec {
  readonly takesValue: boolean;
  readonly check?: (value: string) => void;
}

type Flags = ReadonlyMap<string, FlagSpec>;

/** Short flags and the flags with a value, from the global options the CLI registers. */
const SHORT_FLAGS: Readonly<Record<string, string>> = Object.fromEntries(
  GLOBAL_OPTIONS.flatMap((spec) => (spec.short === undefined ? [] : [[spec.short, spec.long]])),
);
const GLOBAL_VALUE_FLAGS = GLOBAL_OPTIONS.filter((spec) => spec.value !== undefined).map(
  (spec) => spec.long,
);
const OPERATORS = new Set(['|', '||', '&&', ';', '>', '>>', '<', '2>']);

function unquote(word: string): string {
  return word.replace(/'([^']*)'/g, '$1');
}

function checkOutput(value: string): void {
  expect(['json', 'table']).toContain(value);
}

function checkJson(value: string): unknown {
  if (value === '-' || value.startsWith('@')) return undefined;
  return JSON.parse(value) as unknown;
}

const GLOBALS: Flags = new Map(
  GLOBAL_FLAGS.map((flag): [string, FlagSpec] => [
    flag,
    {
      takesValue: GLOBAL_VALUE_FLAGS.includes(flag),
      ...(flag === 'output' ? { check: checkOutput } : {}),
      ...(flag === 'timeout'
        ? {
            check: (value: string) => {
              expect(value).toMatch(/^\d+$/);
            },
          }
        : {}),
    },
  ]),
);

function valueCheck(option: OptionDoc, operation: OperationSpec): (value: string) => void {
  return (value) => {
    if (option.enum !== undefined) expect(option.enum).toContain(value);
    if (option.type === 'integer') expect(value).toMatch(/^-?\d+$/);
    if (option.type === 'number') expect(Number.isFinite(Number(value))).toBe(true);
    if (option.type === 'date-time') normalizeDateTime(value);
    if (option.source === 'variables') parseVariable(value, option.flag);
    if (option.source === 'body' && operation.body?.kind === 'json') {
      const body = checkJson(value);
      if (body === undefined) return;
      const problems = validateBody(operation.body.schema, body, catalog.schemas).filter(
        // required top-level properties may come from flags
        (problem) => !(problem.path === '$' && problem.message.startsWith('missing required')),
      );
      expect(problems).toEqual([]);
    }
  };
}

function operationFlags(operation: OperationSpec): Flags {
  const flags = new Map<string, FlagSpec>(GLOBALS);
  for (const option of operationOptions(operation, catalog.schemas)) {
    const takesValue = option.kind === 'value' || option.kind === 'repeatable';
    if (option.kind !== 'negated') {
      flags.set(option.flag, { takesValue, check: valueCheck(option, operation) });
    }
    if (option.kind === 'boolean' || option.kind === 'negated') {
      flags.set(`no-${option.flag}`, { takesValue: false });
    }
  }
  return flags;
}

/** Splits words into positionals and checks every option and its value; returns the positionals. */
function parseWords(words: readonly string[], flags: Flags): string[] {
  const positionals: string[] = [];
  for (let index = 0; index < words.length; index++) {
    const word = words[index]!;
    if (!word.startsWith('-')) {
      positionals.push(unquote(word));
      continue;
    }
    const name = word.startsWith('--') ? word.slice(2) : SHORT_FLAGS[word.slice(1)];
    const spec = name === undefined ? undefined : flags.get(name);
    expect(spec, `unknown option ${word}`).toBeDefined();
    if (spec?.takesValue === true) {
      const value = words[++index];
      expect(value, `missing value of ${word}`).toBeDefined();
      spec.check?.(unquote(value!));
    }
  }
  return positionals;
}

function checkOperationCommand(operation: OperationSpec, rest: readonly string[]): void {
  const positionals = parseWords(rest, operationFlags(operation));
  const args = operationArguments(operation);
  const required = args.filter((argument) => !argument.variadic).length;
  operation.params
    .filter((param) => param.in === 'path')
    .forEach((param, index) => {
      if (param.enum !== undefined) expect(param.enum).toContain(positionals[index]);
    });
  if (args.some((argument) => argument.variadic)) {
    expect(positionals.length).toBeGreaterThan(required);
  } else {
    expect(positionals).toHaveLength(required);
  }
  if (operation.effect === 'delete' || operation.effect === 'bulk') {
    expect(rest.some((word) => word === '--yes' || word === '-y' || word === '--dry-run')).toBe(
      true,
    );
  }
}

const OUTPUT_FLAGS: Flags = new Map(
  [...GLOBALS].filter(([flag]) => ['output', 'fields', 'pretty', 'help'].includes(flag)),
);

function withFlags(base: Flags, extra: Record<string, FlagSpec>): Flags {
  return new Map([...base, ...Object.entries(extra)]);
}

function checkCommands(rest: readonly string[]): void {
  const flags = withFlags(OUTPUT_FLAGS, {
    search: { takesValue: true },
    effect: {
      takesValue: true,
      check: (value) => {
        expect(EFFECTS).toContain(value);
      },
    },
  });
  const positionals = parseWords(rest, flags);
  expect(positionals.length).toBeLessThanOrEqual(1);
  if (positionals[0] !== undefined && positionals[0] !== 'workflow') {
    expect(findGroup(catalog, positionals[0])).toBeDefined();
  }
}

function checkDescribe(rest: readonly string[]): void {
  const [first, second, ...extra] = parseWords(rest, OUTPUT_FLAGS);
  expect(extra).toEqual([]);
  expect(first).toBeDefined();
  if (second !== undefined) {
    expect(findOperation(catalog, first!, second)).toBeDefined();
  } else {
    const known = first === 'workflow' || findWorkflow(first!) !== undefined;
    expect(
      known || (findGroup(catalog, first!) ?? findByOperationId(catalog, first!)) !== undefined,
    ).toBe(true);
  }
}

/** Value checks of the workflow options: choices, durations, conditions, variables, integers. */
function workflowCheck(option: OptionDoc): (value: string) => void {
  return (value) => {
    if (option.enum !== undefined) expect(option.enum).toContain(value);
    if (option.type === 'duration') parseDuration(value, `--${option.flag}`);
    if (option.type === 'condition') parseCondition(value);
    if (option.type === 'variables') parseVariable(value, option.flag);
    if (option.type === 'integer') expect(value).toMatch(/^\d+$/);
  };
}

function workflowFlags(doc: WorkflowDoc): Flags {
  const flags = new Map<string, FlagSpec>(GLOBALS);
  for (const option of doc.options) {
    const takesValue = option.kind === 'value' || option.kind === 'repeatable';
    const name = option.kind === 'negated' ? `no-${option.flag}` : option.flag;
    flags.set(name, { takesValue, check: workflowCheck(option) });
  }
  return flags;
}

/** A workflow command line: its options and the number of positionals. */
function checkWorkflow(doc: WorkflowDoc, rest: readonly string[]): void {
  const positionals = parseWords(rest, workflowFlags(doc));
  const [argument] = doc.arguments;
  if (argument === undefined) expect(positionals).toEqual([]);
  else if (argument.variadic) expect(positionals.length).toBeGreaterThan(0);
  else expect(positionals.length).toBeLessThanOrEqual(1);
  const definitionOnly =
    doc.name === 'retry' &&
    rest.includes('--process-definition-key') &&
    positionals.length === 0 &&
    !rest.includes('--business-key') &&
    !rest.includes('--latest');
  if (definitionOnly)
    expect(rest.some((word) => word === '--yes' || word === '--dry-run')).toBe(true);
}

function checkApi(rest: readonly string[]): void {
  const flags = withFlags(GLOBALS, {
    query: {
      takesValue: true,
      check: (value) => {
        expect(value).toMatch(/^[^=]+=/);
      },
    },
    body: { takesValue: true, check: (value) => checkJson(value) },
  });
  const [method, path, ...extra] = parseWords(rest, flags);
  expect(['GET', 'POST', 'PUT', 'DELETE']).toContain(method);
  expect(path).toMatch(/^\//);
  expect(extra).toEqual([]);
  if (method === 'DELETE') expect(rest).toContain('--yes');
}

const CONFIG_FLAGS: Flags = withFlags(OUTPUT_FLAGS, {
  profile: { takesValue: true },
  config: { takesValue: true },
  url: {
    takesValue: true,
    check: (value) => {
      expect(value).toMatch(/^https?:\/\/[^@]+$/);
    },
  },
  engine: { takesValue: true },
  auth: {
    takesValue: true,
    check: (value) => {
      expect(['none', 'basic', 'oauth', 'bearer']).toContain(value);
    },
  },
  'auth-user': {
    takesValue: true,
    check: (value) => {
      expect(value).toMatch(/^[^:\s]+$/);
    },
  },
  'auth-password-env': {
    takesValue: true,
    check: (value) => {
      expect(value).toMatch(/^[A-Za-z_][A-Za-z0-9_]*$/);
    },
  },
  'auth-password-stdin': { takesValue: false },
  'auth-token-env': {
    takesValue: true,
    check: (value) => {
      expect(value).toMatch(/^[A-Za-z_][A-Za-z0-9_]*$/);
    },
  },
  'auth-token-stdin': { takesValue: false },
  project: { takesValue: false },
  'oauth-issuer': {
    takesValue: true,
    check: (value) => {
      expect(value).toMatch(/^https:\/\/[^@?#]+$/);
    },
  },
  'oauth-client-id': { takesValue: true },
  timeout: { takesValue: true },
  header: {
    takesValue: true,
    check: (value) => {
      expect(value).toMatch(/^[\w-]+: \S/);
    },
  },
  'read-only': { takesValue: false },
  'no-read-only': { takesValue: false },
  default: { takesValue: false },
  'show-secrets': { takesValue: false },
});

/** Number of positionals after the subcommand: [min, max]. */
const CONFIG_SUBCOMMANDS: Readonly<Record<string, readonly [number, number]>> = {
  path: [0, 0],
  show: [0, 0],
  list: [0, 0],
  set: [1, 1],
  unset: [2, Infinity],
  use: [1, 1],
  delete: [1, 1],
};

function checkConfig(rest: readonly string[]): void {
  const [subcommand, ...positionals] = parseWords(rest, CONFIG_FLAGS);
  const range = CONFIG_SUBCOMMANDS[subcommand ?? ''];
  expect(range, `config ${subcommand}`).toBeDefined();
  expect(positionals.length).toBeGreaterThanOrEqual(range![0]);
  expect(positionals.length).toBeLessThanOrEqual(range![1]);
  if (subcommand === 'set') expect(positionals[0]).toMatch(/^[A-Za-z0-9][A-Za-z0-9._-]*$/);
}

/** `operate auth status|logout` (`auth login` is for a person, never in the guide). */
function checkAuth(rest: readonly string[]): void {
  const flags = withFlags(new Map([['output', GLOBALS.get('output')!]]), {
    profile: { takesValue: true },
    config: { takesValue: true },
    'auth-token-stdin': { takesValue: false },
    'auth-token-command': CONFIG_FLAGS.get('auth-token-command')!,
  });
  const [subcommand, ...positionals] = parseWords(rest, flags);
  expect(['status', 'logout']).toContain(subcommand);
  expect(positionals).toEqual([]);
}

/** `operate guide [topic]` or `operate guide --list`, with `-o` for the list. */
function checkGuide(rest: readonly string[]): void {
  const flags = withFlags(new Map([['output', GLOBALS.get('output')!]]), {
    list: { takesValue: false },
  });
  const positionals = parseWords(rest, flags);
  expect(positionals.length).toBeLessThanOrEqual(rest.includes('--list') ? 0 : 1);
  if (positionals[0] !== undefined) expect(findGuideTopic(positionals[0])).toBeDefined();
}

const UTILITIES: Readonly<Record<string, (rest: readonly string[]) => void>> = {
  commands: checkCommands,
  describe: checkDescribe,
  api: checkApi,
  ping: (rest) => {
    expect(parseWords(rest, GLOBALS)).toEqual([]);
  },
  guide: checkGuide,
  config: checkConfig,
  auth: checkAuth,
  completion: (rest) => {
    expect(rest).toHaveLength(1);
    expect(['bash', 'zsh', 'fish']).toContain(rest[0]);
  },
  ...Object.fromEntries(
    WORKFLOW_DOCS.map((doc) => [
      doc.name,
      (rest: readonly string[]) => {
        checkWorkflow(doc, rest);
      },
    ]),
  ),
};

/** Validates one command line given as words, the first being `operate`. */
function checkCommandLine(words: readonly string[]): void {
  expect(words[0]).toBe('operate');
  const [, first = '', second = '', ...rest] = words;
  const utility = UTILITIES[first];
  if (utility !== undefined) {
    utility(words.slice(2));
    return;
  }
  const operation = findOperation(catalog, first, second);
  expect(operation, `unknown command ${first} ${second}`).toBeDefined();
  checkOperationCommand(operation!, rest);
}

/** `operate` commands in the fenced code blocks, split at shell operators such as `|`. */
function guideCommands(markdown: string): string[][] {
  const commands: string[][] = [];
  let fenced = false;
  for (const line of markdown.split('\n')) {
    if (line.startsWith('```')) {
      fenced = !fenced;
      continue;
    }
    if (!fenced) continue;
    let segment: string[] = [];
    for (const word of [...commandWords(line), '|']) {
      if (!OPERATORS.has(word)) {
        segment.push(word);
        continue;
      }
      if (segment[0] === 'operate') commands.push(segment);
      segment = [];
    }
  }
  return commands;
}

describe('the command line checker', () => {
  const ok = (line: string) => () => {
    checkCommandLine(commandWords(line));
  };

  it('accepts valid operation and utility commands', () => {
    expect(ok('operate process-instance get abc -o table --pretty')).not.toThrow();
    expect(ok('operate process-instance list --no-with-incident --all')).not.toThrow();
    expect(ok("operate task complete t1 --var 'note=a b' --no-validate")).not.toThrow();
    expect(ok('operate deployment create a.bpmn b.dmn --base-dir .')).not.toThrow();
    expect(ok('operate metrics sum job-acquisition-attempt')).not.toThrow();
    expect(ok('operate commands task --search claim --effect write')).not.toThrow();
    expect(ok('operate describe getProcessInstances')).not.toThrow();
    expect(ok('operate config unset prod url headers')).not.toThrow();
    expect(
      ok('operate config set p --auth basic --auth-user demo --auth-password-env PW'),
    ).not.toThrow();
    expect(ok('operate ping --auth basic --auth-user demo --auth-password-stdin')).not.toThrow();
    expect(ok('operate api PUT /job/j1/retries --body {"retries":1}')).not.toThrow();
    expect(ok('operate inspect p1 --history --no-variables -o table')).not.toThrow();
    expect(
      ok('operate wait --business-key B --until task:a --until ended --wait-timeout 2m'),
    ).not.toThrow();
    expect(ok('operate retry --process-definition-key k --dry-run')).not.toThrow();
    expect(ok('operate deploy a b --start-key k --var x=1')).not.toThrow();
    expect(ok('operate status --fail-on warning --stale-after 10m')).not.toThrow();
    expect(ok('operate completion zsh')).not.toThrow();
    expect(ok('operate describe inspect')).not.toThrow();
    expect(ok('operate commands workflow')).not.toThrow();
    expect(ok('operate guide')).not.toThrow();
    expect(ok('operate guide auth')).not.toThrow();
    expect(ok('operate guide --list -o table')).not.toThrow();
  });

  it('rejects drift from the catalog', () => {
    expect(ok('operate process-instance get')).toThrow();
    expect(ok('operate process-instance get a b')).toThrow();
    expect(ok('operate process-instance lists')).toThrow();
    expect(ok('operate process-instance get abc --nope')).toThrow();
    expect(ok('operate process-instance get abc --no-pretty')).toThrow();
    expect(ok('operate process-instance list --active=true')).toThrow();
    expect(ok('operate process-instance list --no-active')).toThrow();
    expect(ok('operate process-instance list --sort-order up')).toThrow();
    expect(ok('operate metrics sum my-metrics-name')).toThrow();
    expect(ok('operate process-instance list --max-results ten')).toThrow();
    expect(ok('operate process-instance list --fields')).toThrow();
    expect(ok('operate process-instance list -o yaml')).toThrow();
    expect(ok('operate historic-process-instance list --started-after yesterday')).toThrow();
    expect(ok('operate task complete t1 --var novalue')).toThrow();
    expect(ok('operate task complete t1 --body \'{"variablez":{}}\'')).toThrow();
    expect(ok('operate process-instance delete abc')).toThrow();
    expect(ok('operate deployment create')).toThrow();
    expect(ok('operate commands no-such-group')).toThrow();
    expect(ok('operate commands --effect remove')).toThrow();
    expect(ok('operate describe task nothing')).toThrow();
    expect(ok('operate config set')).toThrow();
    expect(ok('operate config set p --auth digest')).toThrow();
    expect(ok('operate config set p --oauth-issuer http://login.example.com')).toThrow();
    expect(ok('operate config set p --auth-password-env MY-VAR')).toThrow();
    expect(ok('operate config set p --auth-token-env MY-VAR')).toThrow();
    expect(ok('operate config set p --auth-user a:b')).toThrow();
    expect(ok('operate config rename a b')).toThrow();
    expect(ok('operate api FETCH /x')).toThrow();
    expect(ok('operate api DELETE /process-instance/abc')).toThrow();
    expect(ok('operate ping extra')).toThrow();
    expect(ok('operate guide --pretty')).toThrow();
    expect(ok('operate guide setup')).toThrow();
    expect(ok('operate guide auth recipes')).toThrow();
    expect(ok('operate guide auth --list')).toThrow();
    expect(ok('operate guide --list -o yaml')).toThrow();
    expect(ok('operate inspect a b')).toThrow();
    expect(ok('operate inspect a --nope')).toThrow();
    expect(ok('operate wait a --until done')).toThrow();
    expect(ok('operate wait a --wait-timeout soon')).toThrow();
    expect(ok('operate status x')).toThrow();
    expect(ok('operate status --fail-on never')).toThrow();
    expect(ok('operate deploy')).toThrow();
    expect(ok('operate retry --process-definition-key k')).toThrow();
    expect(ok('operate retry a --retries one')).toThrow();
    expect(ok('operate completion powershell')).toThrow();
  });

  it('finds commands in fenced code blocks only, split at shell operators', () => {
    const markdown = [
      'operate outside a block',
      '```sh',
      "echo '{}' | operate task list --body - > out.json",
      'operate ping && operate guide',
      'export X=1',
      '```',
      'operate after the block',
    ].join('\n');
    expect(guideCommands(markdown)).toEqual([
      ['operate', 'task', 'list', '--body', '-'],
      ['operate', 'ping'],
      ['operate', 'guide'],
    ]);
  });
});

describe('examples', () => {
  it('are valid for every operation of the catalog', () => {
    for (const operation of catalog.operations) {
      for (const example of examplesFor(operation)) {
        const words = commandWords(example);
        expect(words.slice(0, 3), example).toEqual(['operate', operation.group, operation.name]);
        expect(() => {
          checkOperationCommand(operation, words.slice(3));
        }, example).not.toThrow();
      }
    }
  });
});

const TOP_LEVEL = new Set([...WORKFLOW_DOCS.map((doc) => doc.name), 'completion']);

describe('workflow command lines of the README and the docs pages', () => {
  const lines = DOC_PAGES.flatMap(([, text]) => guideCommands(text)).filter((words) =>
    TOP_LEVEL.has(words[1] ?? ''),
  );

  it('has the workflow commands and the completion commands', () => {
    expect(new Set(lines.map((words) => words[1]))).toEqual(TOP_LEVEL);
  });

  it.each(lines.map((words) => [words.join(' '), words] as const))('%s is valid', (_, words) => {
    checkCommandLine(words);
  });
});

describe('workflow examples', () => {
  it('are valid for every workflow command', () => {
    for (const doc of WORKFLOW_DOCS) {
      for (const example of doc.examples) {
        expect(() => {
          checkCommandLine(commandWords(example));
        }, example).not.toThrow();
      }
    }
  });
});

/**
 * The minimum number of command lines over all guide pages: well below their count, so that
 * independent edits that each drop a few lines cannot break main by a narrow margin.
 */
const MIN_GUIDE_COMMANDS = 60;

describe('guide', () => {
  const commands = GUIDE_PAGES.flatMap(([page, text]) =>
    guideCommands(text).map((words) => [page, words] as const),
  );

  it('has plenty of command lines over all pages, and some on every page', () => {
    expect(commands.length).toBeGreaterThanOrEqual(MIN_GUIDE_COMMANDS);
    expect(new Set(commands.map(([page]) => page))).toEqual(
      new Set(GUIDE_PAGES.map(([page]) => page)),
    );
  });

  it.each(commands.map(([page, words]) => [page, words.join(' '), words] as const))(
    '%s: %s is valid',
    (_, __, words) => {
      checkCommandLine(words);
    },
  );
});
