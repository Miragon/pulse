/**
 * Plain text layout for the human readable docs: word wrapping, command line wrapping, two column
 * lists and markdown paragraphs. Pure.
 */

import { summarize } from './options.js';

/** Width of the human readable docs output. */
export const TEXT_WIDTH = 100;

/**
 * Words of a shell command line. Single quoted parts stay part of their word and keep their quotes,
 * so `--var 'comment=Looks good'` is two words.
 */
export function commandWords(line: string): string[] {
  return line.match(/(?:[^\s']|'[^']*')+/g) ?? [];
}

/**
 * Greedy fill: words separated by single spaces, a new line (starting with `hanging`) whenever the
 * next word plus `suffix` would pass `TEXT_WIDTH`. The suffix ends every line but the last.
 */
function fill(words: readonly string[], first: string, hanging: string, suffix: string): string[] {
  const lines: string[] = [];
  let line = first;
  let empty = true;
  for (const word of words) {
    if (!empty && line.length + 1 + word.length + suffix.length > TEXT_WIDTH) {
      lines.push(`${line}${suffix}`);
      line = hanging;
      empty = true;
    }
    line += empty ? word : ` ${word}`;
    empty = false;
  }
  lines.push(line);
  return lines;
}

/**
 * Word wrap at `TEXT_WIDTH`. The first line starts with `indent`, the following lines with
 * `hanging`; a word longer than the available width gets a line of its own.
 */
export function wrap(text: string, indent: string, hanging = indent): string[] {
  return fill(text.match(/\S+/g) ?? [], indent, hanging, '').map((line) => line.trimEnd());
}

/**
 * Wraps a command line between words with ` \` continuations, so the wrapped text still pastes
 * into a shell. Continuation lines are indented by four more spaces than the first line.
 */
export function wrapCommand(command: string, indent: string): string[] {
  return fill(commandWords(command), indent, `${indent}    `, ' \\');
}

/** Widest left column of `columns`; longer entries put their text on the next line. */
const MAX_LEFT = 32;

/**
 * Two column list (`  left  text`), the text wrapped below itself. Entries wider than the column
 * get the text on the following lines.
 */
export function columns(rows: readonly (readonly [string, string])[], indent = '  '): string[] {
  const width = Math.min(MAX_LEFT, Math.max(0, ...rows.map(([left]) => left.length)));
  const hanging = `${indent}${' '.repeat(width)}  `;
  return rows.flatMap(([left, text]) => {
    if (text === '') return [`${indent}${left}`];
    if (left.length > width) return [`${indent}${left}`, ...wrap(text, hanging)];
    return wrap(text, `${indent}${left.padEnd(width)}  `, hanging);
  });
}

const LIST_ITEM = /^(?:[*-]|\d+\.)\s/;

/**
 * Markdown description as wrapped plain text: paragraphs separated by an empty line, list items
 * with a hanging indent, links and emphasis reduced to their text.
 */
export function paragraphLines(markdown: string, indent = '  '): string[] {
  const paragraphs = markdown
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.split(/\n(?=\s*(?:[*-]|\d+\.)\s)/).map(summarize))
    .map((items) => items.filter((item) => item !== ''))
    .filter((items) => items.length > 0);
  return paragraphs.flatMap((items, index) => [
    ...(index > 0 ? [''] : []),
    ...items.flatMap((item) => wrap(item, indent, LIST_ITEM.test(item) ? `${indent}  ` : indent)),
  ]);
}
