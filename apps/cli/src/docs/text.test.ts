import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { columns, commandWords, paragraphLines, TEXT_WIDTH, wrap, wrapCommand } from './text.js';

const word = (length: number) => 'w'.repeat(length);

describe('commandWords', () => {
  it('splits at whitespace and keeps single quoted parts in their word', () => {
    expect(commandWords(`operate  task complete t1 --var 'note=a b' --body '{"a": 1}'x`)).toEqual([
      'operate',
      'task',
      'complete',
      't1',
      '--var',
      "'note=a b'",
      '--body',
      `'{"a": 1}'x`,
    ]);
    expect(commandWords("--var note='a  b'")).toEqual(['--var', "note='a  b'"]);
    expect(commandWords('   ')).toEqual([]);
  });
});

describe('wrap', () => {
  it('fills lines up to exactly 100 columns', () => {
    const text = `${word(48)} ${word(49)} ${word(5)}`;
    expect(wrap(text, '  ')).toEqual([`  ${word(48)} ${word(49)}`, `  ${word(5)}`]);
    expect(wrap(text, '  ')[0]).toHaveLength(TEXT_WIDTH);
  });

  it('starts following lines with the hanging indent', () => {
    expect(wrap(`${word(60)} ${word(60)}`, '- ', '    ')).toEqual([
      `- ${word(60)}`,
      `    ${word(60)}`,
    ]);
  });

  it('puts an overlong word on a line of its own', () => {
    expect(wrap(`a ${word(120)} b`, '')).toEqual(['a', word(120), 'b']);
  });

  it('collapses whitespace and drops trailing blanks', () => {
    expect(wrap('  one \n two  ', '  ')).toEqual(['  one two']);
    expect(wrap('', '    ')).toEqual(['']);
  });

  it('never passes the width unless a single word is longer', () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 1, max: 120 }), { maxLength: 30 }), (lengths) => {
        const lines = wrap(lengths.map(word).join(' '), '  ', '    ');
        for (const line of lines) {
          if (line.trim().includes(' ')) expect(line.length).toBeLessThanOrEqual(TEXT_WIDTH);
        }
        expect(lines.join(' ').split(/\s+/).filter(Boolean)).toEqual(lengths.map(word));
      }),
    );
  });
});

describe('wrapCommand', () => {
  it('keeps short commands on one line', () => {
    expect(wrapCommand('operate task list --assignee demo', '  ')).toEqual([
      '  operate task list --assignee demo',
    ]);
  });

  it('wraps between words with shell continuations', () => {
    const body = `'{"a": "${word(40)}"}'`;
    const lines = wrapCommand(`operate x y ${word(50)} --body ${body} --yes`, '  ');
    expect(lines).toEqual([`  operate x y ${word(50)} --body \\`, `      ${body} --yes`]);
  });

  it('reserves room for the continuation marker', () => {
    const lines = wrapCommand(`${word(95)} ${word(2)}`, '  ');
    expect(lines).toEqual([`  ${word(95)} \\`, `      ${word(2)}`]);
    expect(wrapCommand(`${word(94)} ${word(1)}`, '  ')).toEqual([`  ${word(94)} ${word(1)}`]);
  });
});

describe('columns', () => {
  it('aligns the text after the widest left entry', () => {
    expect(
      columns([
        ['--a', 'first'],
        ['--longer', 'second'],
        ['--flag-only', ''],
      ]),
    ).toEqual(['  --a          first', '  --longer     second', '  --flag-only']);
  });

  it('wraps the text below itself', () => {
    const lines = columns([['--x', `${word(50)} ${word(50)}`]]);
    expect(lines).toEqual([`  --x  ${word(50)}`, `       ${word(50)}`]);
  });

  it('caps the column at 32 characters and moves the text of wider entries down', () => {
    const wide = `--${word(40)}`;
    expect(
      columns([
        [wide, 'text'],
        ['--x', 'short'],
      ]),
    ).toEqual([`  ${wide}`, `  ${' '.repeat(32)}  text`, `  --x${' '.repeat(29)}  short`]);
    expect(columns([[`--${word(30)}`, 'fits']])).toEqual([`  --${word(30)}  fits`]);
  });

  it('prints entries without text on a single line, also when they are wide', () => {
    const wide = `--${word(40)}`;
    expect(
      columns([
        [wide, ''],
        ['--x', 'short'],
      ]),
    ).toEqual([`  ${wide}`, `  --x${' '.repeat(29)}  short`]);
  });

  it('accepts an empty list and another indent', () => {
    expect(columns([])).toEqual([]);
    expect(columns([['a', 'b']], '    ')).toEqual(['    a  b']);
  });
});

describe('paragraphLines', () => {
  it('reflows paragraphs, keeps list items apart and reduces markdown', () => {
    const markdown = [
      'Deletes a **running** process',
      'instance, see [the docs](https://example.com).',
      '',
      'Modes:',
      '* `sync` waits',
      '  for the result',
      '- async returns at once',
      '1. numbered',
      '',
      '   ',
      '',
      'Last.',
    ].join('\n');
    expect(paragraphLines(markdown)).toEqual([
      '  Deletes a running process instance, see the docs.',
      '',
      '  Modes:',
      '  * `sync` waits for the result',
      '  - async returns at once',
      '  1. numbered',
      '',
      '  Last.',
    ]);
  });

  it('indents wrapped list items under their text', () => {
    expect(paragraphLines(`* ${word(60)} ${word(60)}`, '')).toEqual([
      `* ${word(60)}`,
      `  ${word(60)}`,
    ]);
    expect(paragraphLines(`${word(60)} ${word(60)}`, ' ')).toEqual([
      ` ${word(60)}`,
      ` ${word(60)}`,
    ]);
  });

  it('separates paragraphs at lines holding only whitespace', () => {
    expect(paragraphLines('First.\n   \nSecond.')).toEqual(['  First.', '', '  Second.']);
  });

  it('recognizes indented and multi-digit list items only at the start of an item', () => {
    expect(paragraphLines('Steps:\n  * nested\n10. tenth', '')).toEqual([
      'Steps:',
      '* nested',
      '10. tenth',
    ]);
    expect(paragraphLines(`10. ${word(60)} ${word(60)}`, '')).toEqual([
      `10. ${word(60)}`,
      `  ${word(60)}`,
    ]);
    for (const text of [`Plain - ${word(60)} ${word(60)}`, `Plain. ${word(60)} ${word(60)}`]) {
      expect(paragraphLines(text, '')[1]).toBe(word(60));
    }
  });

  it('returns nothing for an empty description', () => {
    expect(paragraphLines('')).toEqual([]);
    expect(paragraphLines('\n\n  \n')).toEqual([]);
  });
});
