/**
 * Shell completion candidates (design §17.10) over a plain model of the command tree that the CLI
 * builds from the same commander program it parses with, so completion and parsing cannot drift.
 * Static values only: nothing here reads the network. Pure.
 */

export type PathKind = 'files' | 'dirs';

export interface CompletionOption {
  /** Long flag first (`--output`), then the short one (`-o`). */
  readonly flags: readonly string[];
  readonly takesValue: boolean;
  readonly description: string;
  readonly values?: readonly string[];
  readonly path?: PathKind;
  /** The value is a profile name of the config file. */
  readonly profiles?: boolean;
}

/** What positional arguments complete to. */
export type Positional =
  | {
      readonly kind: 'values';
      readonly values: readonly string[];
      /** Descriptions of the values (`operate guide <topic>`), shown by zsh and fish. */
      readonly descriptions?: Readonly<Record<string, string>>;
    }
  | { readonly kind: 'path'; readonly path: PathKind }
  /** A profile name, then (`config unset`) any of `rest`, each once. */
  | { readonly kind: 'profiles'; readonly rest?: readonly string[] }
  | { readonly kind: 'top-level' | 'groups' | 'describe' };

export interface CompletionCommand {
  readonly name: string;
  readonly aliases: readonly string[];
  readonly description: string;
  readonly kind: 'utility' | 'workflow' | 'group' | 'command';
  readonly options: readonly CompletionOption[];
  readonly commands: readonly CompletionCommand[];
  readonly positional?: Positional;
}

export interface CompletionContext {
  readonly root: CompletionCommand;
  /** Global options, skipped before the command path. */
  readonly globals: readonly CompletionOption[];
  /** A group with its commands (registered on demand). */
  readonly group: (name: string) => CompletionCommand | undefined;
  readonly profiles: readonly string[];
}

interface Candidate {
  readonly value: string;
  readonly description: string;
}

interface Candidates {
  readonly kind: 'candidates';
  readonly candidates: readonly Candidate[];
}

export type Completion = Candidates | { readonly kind: 'path'; readonly path: PathKind };

const NONE: Candidates = { kind: 'candidates', candidates: [] };
const MAX_DESCRIPTION = 100;

function candidates(list: readonly Candidate[], current: string): Candidates {
  return {
    kind: 'candidates',
    candidates: list.filter((candidate) => candidate.value.startsWith(current)),
  };
}

function findOption(
  options: readonly CompletionOption[],
  token: string,
): CompletionOption | undefined {
  const name = token.includes('=') ? token.slice(0, token.indexOf('=')) : token;
  return options.find((option) => option.flags.includes(name));
}

function findCommand(commands: readonly CompletionCommand[], name: string) {
  return commands.find((command) => command.name === name || command.aliases.includes(name));
}

function valuesOf(
  option: CompletionOption,
  context: CompletionContext,
  current: string,
): Completion {
  if (option.path !== undefined) return { kind: 'path', path: option.path };
  const values = option.profiles === true ? context.profiles : (option.values ?? []);
  return candidates(
    values.map((value) => ({ value, description: '' })),
    current,
  );
}

function optionCandidates(options: readonly CompletionOption[], current: string): Completion {
  const long = options.flatMap((option) => {
    const flag = option.flags.find((candidate) => candidate.startsWith('--'));
    return flag === undefined ? [] : [{ value: flag, description: option.description }];
  });
  return candidates(long, current);
}

function commandCandidates(
  commands: readonly CompletionCommand[],
  current: string,
  kinds?: readonly string[],
): Candidates {
  const shown = commands.filter((command) => kinds === undefined || kinds.includes(command.kind));
  return candidates(
    shown.map((command) => ({ value: command.name, description: command.description })),
    current,
  );
}

function describeCandidates(
  before: readonly string[],
  context: CompletionContext,
  current: string,
): Completion {
  const [name, ...more] = before;
  if (name === undefined) {
    const kinds = ['group', 'workflow'];
    return withWorkflow(commandCandidates(context.root.commands, current, kinds), current);
  }
  const group = more.length > 0 ? undefined : context.group(name);
  return group === undefined ? NONE : commandCandidates(group.commands, current);
}

/** The description of a value, from own keys only (`constructor` has none). */
function valueDescription(
  descriptions: Readonly<Record<string, string>> | undefined,
  value: string,
): string {
  const own = descriptions !== undefined && Object.hasOwn(descriptions, value);
  return (own ? descriptions[value] : undefined) ?? '';
}

/** Candidates of the first positional argument per kind. */
function firstPositional(positional: Positional, context: CompletionContext, current: string) {
  switch (positional.kind) {
    case 'values':
      return candidates(
        positional.values.map((value) => ({
          value,
          description: valueDescription(positional.descriptions, value),
        })),
        current,
      );
    case 'top-level':
      return commandCandidates(context.root.commands, current);
    case 'profiles':
      return candidates(
        context.profiles.map((value) => ({ value, description: '' })),
        current,
      );
    default:
      return withWorkflow(commandCandidates(context.root.commands, current, ['group']), current);
  }
}

function positionalCandidates(
  command: CompletionCommand,
  before: readonly string[],
  context: CompletionContext,
  current: string,
): Completion {
  const positional = command.positional;
  if (positional?.kind === 'path') return { kind: 'path', path: positional.path };
  if (positional?.kind === 'describe') return describeCandidates(before, context, current);
  if (before.length > 0) {
    if (positional?.kind !== 'profiles') return NONE;
    const rest = (positional.rest ?? []).filter((value) => !before.includes(value));
    return candidates(
      rest.map((value) => ({ value, description: '' })),
      current,
    );
  }
  if (positional === undefined) return commandCandidates(command.commands, current);
  return firstPositional(positional, context, current);
}

/** `workflow`, the pseudo group of `commands` and `describe`. */
function withWorkflow(completion: Candidates, current: string): Candidates {
  if (!'workflow'.startsWith(current)) return completion;
  const workflow = { value: 'workflow', description: 'The workflow commands' };
  return { kind: 'candidates', candidates: [...completion.candidates, workflow] };
}

/** Index after the leading global options, or the completion when the current word is one of their values. */
function skipGlobals(
  context: CompletionContext,
  before: readonly string[],
  current: string,
  index = 0,
): number | Completion {
  const [token, ...rest] = before.slice(index);
  if (!token?.startsWith('-')) return index;
  const option = findOption(context.globals, token);
  if (option === undefined) return NONE;
  if (!option.takesValue || token.includes('=')) {
    return skipGlobals(context, before, current, index + 1);
  }
  if (rest.length === 0) return valuesOf(option, context, current);
  return skipGlobals(context, before, current, index + 2);
}

interface Located {
  readonly command: CompletionCommand;
  readonly rest: readonly string[];
}

/** The addressed command (a command and, for groups and `config`, a subcommand). */
function locate(context: CompletionContext, path: readonly string[]): Located | undefined {
  const [name = '', sub, ...rest] = path;
  const first = findCommand(context.root.commands, name);
  if (first === undefined) return undefined;
  if (first.commands.length === 0 || sub === undefined || sub.startsWith('-')) {
    return { command: first, rest: path.slice(1) };
  }
  const second = findCommand(first.commands, sub);
  return second === undefined ? undefined : { command: second, rest };
}

/** Positionals before the current word, or the completion when it is the value of an option. */
function positionals(
  command: CompletionCommand,
  rest: readonly string[],
  context: CompletionContext,
  current: string,
): string[] | Completion {
  const found: string[] = [];
  let awaiting: CompletionOption | undefined;
  for (const [index, token] of rest.entries()) {
    if (awaiting !== undefined) {
      awaiting = undefined;
      continue;
    }
    if (token === '--') return [...found, ...rest.slice(index + 1)];
    if (!token.startsWith('-') || token === '-') {
      found.push(token);
      continue;
    }
    const option = findOption(command.options, token);
    awaiting = option?.takesValue === true && !token.includes('=') ? option : undefined;
  }
  return awaiting === undefined ? found : valuesOf(awaiting, context, current);
}

/** The candidates for the word being completed (`current`), after the words `before` it. */
export function complete(
  context: CompletionContext,
  before: readonly string[],
  current: string,
): Completion {
  const start = skipGlobals(context, before, current);
  if (typeof start !== 'number') return start;
  if (start === before.length) {
    if (current.startsWith('-'))
      return optionCandidates([...context.root.options, ...context.globals], current);
    return commandCandidates(context.root.commands, current);
  }
  const located = locate(context, before.slice(start));
  if (located === undefined) return NONE;
  const found = positionals(located.command, located.rest, context, current);
  if (!Array.isArray(found)) return found;
  if (current.startsWith('-')) return optionCandidates(located.command.options, current);
  return positionalCandidates(located.command, found, context, current);
}

function oneLine(text: string): string {
  const line = text.replace(/[\t\n\r\p{Cc}]+/gu, ' ').trim();
  return line.length > MAX_DESCRIPTION ? `${line.slice(0, MAX_DESCRIPTION - 1)}…` : line;
}

/** The `__complete` output: `value<TAB>description` lines, or `:files` / `:dirs`. */
export function formatCompletion(completion: Completion): string {
  if (completion.kind === 'path') return `:${completion.path}\n`;
  return completion.candidates
    .map((candidate) => `${candidate.value}\t${oneLine(candidate.description)}\n`)
    .join('');
}
