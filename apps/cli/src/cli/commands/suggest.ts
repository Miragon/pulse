/**
 * Suggestions for unknown groups, commands and operationIds of `operate commands` and
 * `operate describe`: close spellings first (`closeNames` of src/util.ts, the one rule for every
 * "did you mean"), else matches of the command search (`listCommands`). Pure.
 */

import type { Catalog } from '../../catalog/types.js';
import { listCommands } from '../../docs/commands.js';
import { WORKFLOW_DOCS, WORKFLOW_GROUP } from '../../docs/workflow.js';
import { closeNames } from '../../util.js';

const MAX_SUGGESTIONS = 5;
/** Shorter words match too much of everything to be worth a search based suggestion. */
const MIN_SEARCH_LENGTH = 3;

/** True when `word` starts `name` or one of its kebab words (`var` → `task-variable`). */
function startsWord(name: string, word: string): boolean {
  return name.startsWith(word) || name.includes(`-${word}`);
}

/** Groups for an unknown group name: close spellings, else groups with a word starting so. */
export function groupSuggestions(catalog: Catalog, word: string): string[] {
  const names = [...catalog.groups.map((group) => group.name), WORKFLOW_GROUP.group];
  const close = closeNames(word, names);
  if (close.length > 0 || word.length < MIN_SEARCH_LENGTH) return close;
  const wanted = word.toLowerCase();
  return names.filter((name) => startsWord(name, wanted)).slice(0, MAX_SUGGESTIONS);
}

/** `group command` and `group alias` of every operation. */
function commandNames(catalog: Catalog): string[] {
  return catalog.operations.flatMap((operation) =>
    [operation.name, ...operation.aliases].map((name) => `${operation.group} ${name}`),
  );
}

/** Group names, workflow commands and operationIds: what `operate describe <word>` accepts. */
function singleNames(catalog: Catalog): string[] {
  return [
    ...catalog.groups.map((group) => group.name),
    WORKFLOW_GROUP.group,
    ...WORKFLOW_DOCS.map((doc) => doc.name),
    ...catalog.operations.map((operation) => operation.operationId),
  ];
}

/**
 * Describe targets for unknown arguments (`<group> <command>` or `<operationId>`): close spellings,
 * else the commands the search finds for the last word (within the group, when it exists).
 */
export function describeSuggestions(
  catalog: Catalog,
  first: string,
  second: string | undefined,
): string[] {
  const close =
    second === undefined
      ? closeNames(first, singleNames(catalog))
      : closeNames(`${first} ${second}`, commandNames(catalog));
  const word = second ?? first;
  if (close.length > 0 || word.length < MIN_SEARCH_LENGTH) return close;
  const known = second !== undefined && catalog.groups.some((group) => group.name === first);
  const found = listCommands(catalog, { search: word, ...(known ? { group: first } : {}) });
  return found.slice(0, MAX_SUGGESTIONS).map((summary) => summary.command);
}

/** `Did you mean x? ` or `Did you mean one of x, y? `; empty without suggestions. */
export function didYouMean(suggestions: readonly string[]): string {
  if (suggestions.length === 0) return '';
  const prefix = suggestions.length === 1 ? '' : 'one of ';
  return `Did you mean ${prefix}${suggestions.join(', ')}? `;
}
