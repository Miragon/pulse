/**
 * Deterministic naming rules that turn OpenAPI tags, operationIds and parameter names into CLI names.
 * Only used at generation time; the runtime reads the precomputed names from the catalog.
 */

/**
 * Words: an acronym before a capitalized word or a digit (`XMLHttp`, `API2`), a capitalized or
 * lower-case word with trailing digits (`Bpmn20`), any other run of capitals, or a number.
 */
const WORD = /[A-Z]{2,}(?=[A-Z][a-z]|\d)|[A-Z]?[a-z]+\d*|[A-Z]+\d*|\d+/g;

/** Splits camelCase, PascalCase, kebab-case and space separated text into lower case words. */
export function splitWords(text: string): string[] {
  return (text.match(WORD) ?? []).map((word) => word.toLowerCase());
}

export function kebab(text: string): string {
  return splitWords(text).join('-');
}

export function pluralize(word: string): string {
  if (/(s|x|z|ch|sh)$/.test(word)) return `${word}es`;
  if (/[^aeiou]y$/.test(word)) return `${word.slice(0, -1)}ies`;
  return `${word}s`;
}

function startsWithAt(words: readonly string[], noun: readonly string[], index: number): boolean {
  return noun.every((word, offset) => words[index + offset] === word);
}

/**
 * Removes the tag noun from an operationId when it directly follows the leading verb.
 * `getProcessInstances` (tag "Process Instance") becomes `list`, `getProcessInstanceVariables`
 * becomes `get-variables`. Returns undefined when the rule does not apply.
 */
export function shortCommandName(operationId: string, tag: string): string | undefined {
  const words = splitWords(operationId);
  const singular = splitWords(tag);
  const last = singular.at(-1);
  // a tag without words has no noun to remove
  if (last === undefined) return undefined;
  const plural = [...singular.slice(0, -1), pluralize(last)];
  for (const [noun, isPlural] of [
    [plural, true],
    [singular, false],
  ] as const) {
    if (!startsWithAt(words, noun, 1)) continue;
    const rest = [words[0] ?? '', ...words.slice(1 + noun.length)];
    return renameListVerbs(rest, isPlural).join('-');
  }
  return undefined;
}

function renameListVerbs(rest: string[], isPlural: boolean): string[] {
  if (!isPlural || rest[0] !== 'get') return rest;
  if (rest.length === 1) return ['list'];
  if (rest.length === 2 && rest[1] === 'count') return ['count'];
  return rest;
}

/**
 * CLI flag for a query parameter or body field. Flags starting with `no-` (noRetriesLeft) are
 * registered by the CLI as single negatable options that mean "true" when present.
 */
export function flagName(paramName: string): string {
  return kebab(paramName);
}
