import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { terminalSafe } from './terminal.js';

describe('terminalSafe', () => {
  it('replaces escape sequences, BEL, DEL and C1 controls', () => {
    expect(terminalSafe('hello \u001b]0;PWNED\u0007 \u001b[31mred\u001b[0m \u001b[2J')).toBe(
      'hello �]0;PWNED� �[31mred�[0m �[2J',
    );
    expect(terminalSafe('a\u007fb\u009bc\u0085d')).toBe('a�b�c�d');
  });

  it('keeps tabs, line feeds and printable text; CRLF becomes LF, a lone CR is replaced', () => {
    expect(terminalSafe('a\tb\nc\r\nd\re äö €')).toBe('a\tb\nc\nd�e äö €');
  });

  it('leaves no control character but tab and line feed', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'binary' }), (text) => {
        expect(terminalSafe(text)).not.toMatch(/[^\P{Cc}\t\n]/u);
      }),
    );
  });
});
