import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { OperateError } from '../errors.js';
import { DATE_TIME_HINT, normalizeDateTime } from './dates.js';
import { parseVariable, parseVariables, typeValue, VARIABLE_TYPES } from './variables.js';

const INT32_MIN = -(2 ** 31);
const INT32_MAX = 2 ** 31 - 1;

function caught(action: () => unknown): OperateError {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(OperateError);
    return error as OperateError;
  }
  throw new Error('expected an error');
}

describe('typeValue (auto typing)', () => {
  it.each([
    ['true', true, 'Boolean'],
    ['false', false, 'Boolean'],
    ['null', null, 'Null'],
    ['0', 0, 'Integer'],
    // JSON has no negative zero: -0 and 0 serialize alike
    ['-0', 0, 'Integer'],
    ['42', 42, 'Integer'],
    ['-17', -17, 'Integer'],
    [String(INT32_MAX), INT32_MAX, 'Integer'],
    [String(INT32_MIN), INT32_MIN, 'Integer'],
    [String(INT32_MAX + 1), INT32_MAX + 1, 'Long'],
    [String(INT32_MIN - 1), INT32_MIN - 1, 'Long'],
    [String(Number.MAX_SAFE_INTEGER), Number.MAX_SAFE_INTEGER, 'Long'],
    [String(Number.MIN_SAFE_INTEGER), Number.MIN_SAFE_INTEGER, 'Long'],
    ['9007199254740992', 9007199254740992n, 'Long'],
    ['9223372036854775808', '9223372036854775808', 'String'],
    ['1.5', 1.5, 'Double'],
    ['-0.25', -0.25, 'Double'],
    ['0.0', 0, 'Double'],
    ['01234', '01234', 'String'],
    ['1.', '1.', 'String'],
    ['.5', '.5', 'String'],
    ['1e3', '1e3', 'String'],
    ['x1.5', 'x1.5', 'String'],
    ['1.5x', '1.5x', 'String'],
    ['x15', 'x15', 'String'],
    ['15x', '15x', 'String'],
    ['TRUE', 'TRUE', 'String'],
    ['', '', 'String'],
    ['hello world', 'hello world', 'String'],
  ])('types %j', (raw, value, type) => {
    expect(typeValue(raw)).toEqual({ value, type });
  });

  it('classifies int32 integers as Integer', () => {
    fc.assert(
      fc.property(fc.integer({ min: INT32_MIN, max: INT32_MAX }), (n) => {
        expect(typeValue(String(n))).toEqual({ value: n, type: 'Integer' });
      }),
    );
  });

  it('classifies safe integers beyond int32 as Long', () => {
    const beyond = fc.oneof(
      fc.integer({ min: INT32_MAX + 1, max: Number.MAX_SAFE_INTEGER }),
      fc.integer({ min: Number.MIN_SAFE_INTEGER, max: INT32_MIN - 1 }),
    );
    fc.assert(
      fc.property(beyond, (n) => {
        expect(typeValue(String(n))).toEqual({ value: n, type: 'Long' });
      }),
    );
  });

  it('classifies plain decimals as Double', () => {
    fc.assert(
      fc.property(fc.integer(), fc.stringMatching(/^\d{1,6}$/), (whole, fraction) => {
        const raw = `${whole}.${fraction}`;
        expect(typeValue(raw)).toEqual({ value: Number(raw), type: 'Double' });
      }),
    );
  });

  it('keeps everything else as String', () => {
    const other = fc
      .string()
      .filter(
        (raw) =>
          !['true', 'false', 'null'].includes(raw) &&
          !/^-?(0|[1-9]\d*)$/.test(raw) &&
          !/^-?(0|[1-9]\d*)\.\d+$/.test(raw),
      );
    fc.assert(
      fc.property(other, (raw) => {
        expect(typeValue(raw)).toEqual({ value: raw, type: 'String' });
      }),
    );
  });
});

describe('typeValue (explicit type)', () => {
  it.each([
    ['01234', 'String', '01234', 'String'],
    ['1', 'string', '1', 'String'],
    ['42', 'Integer', 42, 'Integer'],
    ['-42', 'integer', -42, 'Integer'],
    ['32767', 'Short', 32767, 'Short'],
    ['-32768', 'short', -32768, 'Short'],
    ['9007199254740991', 'Long', 9007199254740991, 'Long'],
    ['1e3', 'Double', 1000, 'Double'],
    ['-2.5', 'double', -2.5, 'Double'],
    ['TRUE', 'Boolean', true, 'Boolean'],
    ['False', 'boolean', false, 'Boolean'],
    ['2024-05-01T10:00:00.000+0200', 'Date', '2024-05-01T10:00:00.000+0200', 'Date'],
    ['2024-05-01', 'date', '2024-05-01T00:00:00.000+0000', 'Date'],
    ['2024-05-01T10:00:00.5+02:00', 'Date', '2024-05-01T10:00:00.500+0200', 'Date'],
    ['{"id":1}', 'Json', '{"id":1}', 'Json'],
    ['[1,2]', 'JSON', '[1,2]', 'Json'],
    ['<a/>', 'Xml', '<a/>', 'Xml'],
    ['anything', 'Null', null, 'Null'],
  ])('converts %j as %s', (raw, type, value, canonical) => {
    expect(typeValue(raw, type)).toEqual({ value, type: canonical });
  });

  const INT32 = 'an integer between -2147483648 and 2147483647';
  it.each([
    ['1.5', 'Integer', `--value expects an integer, got "1.5"`],
    ['abc', 'Integer', `--value expects an integer, got "abc"`],
    ['', 'Integer', `--value expects an integer, got ""`],
    ['2147483648', 'Integer', `--value expects ${INT32}, got "2147483648"`],
    ['-2147483649', 'Integer', `--value expects ${INT32}, got "-2147483649"`],
    ['32768', 'Short', '--value expects an integer between -32768 and 32767, got "32768"'],
    ['-32769', 'Short', '--value expects an integer between -32768 and 32767, got "-32769"'],
    [
      '9223372036854775808',
      'Long',
      '--value expects an integer between -9223372036854775808 and 9223372036854775807, got "9223372036854775808"',
    ],
    ['abc', 'Double', '--value expects a number, got "abc"'],
    ['', 'Double', '--value expects a number, got ""'],
    ['  ', 'Double', '--value expects a number, got "  "'],
    ['Infinity', 'Double', '--value expects a number, got "Infinity"'],
    ['yes', 'Boolean', '--value expects true or false, got "yes"'],
    ['{', 'Json', '--value expects JSON text'],
    ['tomorrow', 'Date', '--value expects a date-time, got "tomorrow"'],
    ['2023-02-29', 'Date', '--value expects a date-time, got "2023-02-29"'],
  ])('rejects %j as %s', (raw, type, message) => {
    const error = caught(() => typeValue(raw, type));
    expect(error.code).toBe('USAGE');
    expect(error.message).toBe(message);
  });

  it('gives an example for the type of --value', () => {
    expect(caught(() => typeValue('abc', 'Integer')).details.hint).toBe(
      'Example: --value 250 --type Integer',
    );
    expect(caught(() => typeValue('{', 'json')).details.hint).toBe(
      `Example: --value '{"id":42}' --type Json`,
    );
  });

  it('explains the accepted date-time forms', () => {
    const error = caught(() => parseVariable('due:Date=01.05.2024'));
    expect(error.message).toBe('--var due expects a date-time, got "01.05.2024"');
    expect(error.details.hint).toBe(DATE_TIME_HINT);
  });

  it('keeps Long values beyond 2^53 exactly', () => {
    expect(typeValue('9223372036854775807', 'Long')).toEqual({
      value: 9223372036854775807n,
      type: 'Long',
    });
    expect(typeValue('-9007199254740993')).toEqual({ value: -9007199254740993n, type: 'Long' });
    expect(typeValue('9223372036854775808')).toEqual({
      value: '9223372036854775808',
      type: 'String',
    });
  });

  it('normalizes Date values like date-time options', () => {
    fc.assert(
      fc.property(
        fc.date({
          min: new Date('0001-01-01T00:00:00Z'),
          max: new Date('9999-12-31T00:00:00Z'),
          noInvalidDate: true,
        }),
        (date) => {
          const iso = date.toISOString();
          expect(typeValue(iso, 'Date')).toEqual({ value: normalizeDateTime(iso), type: 'Date' });
        },
      ),
    );
  });

  it.each(['Object', 'File', 'Bytes', 'constructor', 'toString', '__proto__', ''])(
    'rejects the unsupported type %j',
    (type) => {
      const error = caught(() => typeValue('1', type));
      expect(error.message).toBe(`Unknown variable type "${type}"`);
      expect(error.details.hint).toBe(
        'Supported types: String, Integer, Short, Long, Double, Boolean, Date, Json, Xml, Null. Use --body for Object, File or Bytes variables.',
      );
    },
  );

  it('round trips integers', () => {
    fc.assert(
      fc.property(fc.integer({ min: INT32_MIN, max: INT32_MAX }), (n) => {
        expect(typeValue(String(n), 'Integer')).toEqual({ value: n, type: 'Integer' });
      }),
    );
    fc.assert(
      fc.property(fc.integer({ min: -32768, max: 32767 }), (n) => {
        expect(typeValue(String(n), 'Short')).toEqual({ value: n, type: 'Short' });
      }),
    );
    fc.assert(
      fc.property(fc.maxSafeInteger(), (n) => {
        expect(typeValue(String(n), 'Long')).toEqual({ value: n, type: 'Long' });
      }),
    );
  });

  it('round trips doubles, booleans, strings and JSON', () => {
    fc.assert(
      fc.property(fc.double({ noNaN: true, noDefaultInfinity: true }), (x) => {
        expect(typeValue(String(x), 'Double').value).toBe(x === 0 ? Number(String(x)) : x);
      }),
    );
    fc.assert(
      fc.property(fc.boolean(), (b) => {
        expect(typeValue(String(b), 'Boolean')).toEqual({ value: b, type: 'Boolean' });
      }),
    );
    fc.assert(
      fc.property(fc.string(), (text) => {
        expect(typeValue(text, 'String')).toEqual({ value: text, type: 'String' });
      }),
    );
    fc.assert(
      fc.property(fc.jsonValue(), (json) => {
        const raw = JSON.stringify(json);
        expect(typeValue(raw, 'Json')).toEqual({ value: raw, type: 'Json' });
      }),
    );
  });

  it('accepts every documented type case-insensitively', () => {
    expect(VARIABLE_TYPES).toEqual([
      'String',
      'Integer',
      'Short',
      'Long',
      'Double',
      'Boolean',
      'Date',
      'Json',
      'Xml',
      'Null',
    ]);
    const samples: Readonly<Record<string, string>> = { Boolean: 'true', Date: '2024-05-01' };
    const sample = (type: string) => samples[type] ?? '1';
    fc.assert(
      fc.property(fc.constantFrom(...VARIABLE_TYPES), fc.boolean(), (type, upper) => {
        const spelled = upper ? type.toUpperCase() : type.toLowerCase();
        expect(typeValue(sample(type), spelled).type).toBe(type);
      }),
    );
  });
});

describe('parseVariable', () => {
  it('auto types name=value', () => {
    expect(parseVariable('amount=100')).toEqual(['amount', { value: 100, type: 'Integer' }]);
    expect(parseVariable('approved=true')).toEqual(['approved', { value: true, type: 'Boolean' }]);
  });

  it('splits at the first = so values may contain =', () => {
    expect(parseVariable('query=a=b')).toEqual(['query', { value: 'a=b', type: 'String' }]);
  });

  it('accepts an empty value', () => {
    expect(parseVariable('note=')).toEqual(['note', { value: '', type: 'String' }]);
  });

  it('uses the explicit type after the last colon', () => {
    expect(parseVariable('zip:String=01234')).toEqual(['zip', { value: '01234', type: 'String' }]);
    expect(parseVariable('a:b:Integer=5')).toEqual(['a:b', { value: 5, type: 'Integer' }]);
    expect(parseVariable('order:json={"id":1}')).toEqual([
      'order',
      { value: '{"id":1}', type: 'Json' },
    ]);
  });

  it('treats a leading colon as part of the name', () => {
    expect(parseVariable(':x=1')).toEqual([':x', { value: 1, type: 'Integer' }]);
  });

  it('names the flag and the variable in conversion errors, with an example', () => {
    const error = caught(() => parseVariable('count:Integer=many'));
    expect(error.message).toBe('--var count expects an integer, got "many"');
    expect(error.details.hint).toBe('Example: --var count:Integer=250');
    expect(caught(() => parseVariable('k:Long=x', 'correlation-key')).details.hint).toBe(
      'Example: --correlation-key k:Long=9223372036854775807',
    );
  });

  it.each(['amount', '=100', ''])('rejects %j without a name', (argument) => {
    const error = caught(() => parseVariable(argument));
    expect(error.code).toBe('USAGE');
    expect(error.message).toBe(
      `Invalid --var "${argument}": expected name=value or name:Type=value`,
    );
    expect(error.details.hint).toBe(
      'Example: --var amount=100 --var approved=true --var zip:String=01234',
    );
  });

  it('names the given flag in errors', () => {
    const error = caught(() => parseVariable('oops', 'local-var'));
    expect(error.message).toBe(
      'Invalid --local-var "oops": expected name=value or name:Type=value',
    );
    expect(error.details.hint).toBe(
      'Example: --local-var amount=100 --local-var approved=true --local-var zip:String=01234',
    );
  });

  it('parses names and values for any input', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1 }).filter((name) => !name.includes('=') && !name.includes(':')),
        fc.string(),
        (name, value) => {
          const [parsedName, typed] = parseVariable(`${name}=${value}`);
          expect(parsedName).toBe(name);
          expect(typed).toEqual(typeValue(value));
        },
      ),
    );
  });
});

describe('parseVariables', () => {
  it('builds a map; later entries win', () => {
    expect(parseVariables(['a=1', 'b=x', 'a=2'])).toEqual({
      a: { value: 2, type: 'Integer' },
      b: { value: 'x', type: 'String' },
    });
  });

  it('names --var in errors by default', () => {
    expect(caught(() => parseVariables(['bad'])).message).toBe(
      'Invalid --var "bad": expected name=value or name:Type=value',
    );
  });

  it('passes the flag to the parser', () => {
    expect(caught(() => parseVariables(['bad'], 'correlation-key')).message).toBe(
      'Invalid --correlation-key "bad": expected name=value or name:Type=value',
    );
  });

  it('keeps __proto__ as a plain variable name', () => {
    const map = parseVariables(['__proto__=1']);
    expect(Object.keys(map)).toEqual(['__proto__']);
    expect(Object.getPrototypeOf(map)).toBe(Object.prototype);
  });
});
