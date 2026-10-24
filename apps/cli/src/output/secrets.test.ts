import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { MultipartPartPreview, RequestPreview } from '../operation/result.js';
import { curlCommand, maskHeaders, maskUrl, maskUrlsInText, shellQuote } from './secrets.js';

const SCHEMES = [
  'Basic',
  'Bearer',
  'Digest',
  'DPoP',
  'HOBA',
  'Mutual',
  'Negotiate',
  'NTLM',
  'Token',
  'AWS4-HMAC-SHA256',
];

const SECRET_NAMES = [
  'Authorization',
  'authorization',
  'Proxy-Authorization',
  'Cookie',
  'Set-Cookie',
  'X-Auth-Token',
  'TOKEN',
  'X-Client-Secret',
  'X-Password',
  'X-Api-Key',
  'x-apikey',
];

const PLAIN_NAMES = ['Accept', 'Content-Type', 'X-Request-Id', 'X-Auth', 'Api_Key', 'X-Pass'];

/** Splits a command line into words like a POSIX shell: single quotes and backslash escapes. */
function shellWords(line: string): string[] {
  const words: string[] = [];
  let word = '';
  let inWord = false;
  let index = 0;
  while (index < line.length) {
    const char = line[index]!;
    if (char === "'") {
      const end = line.indexOf("'", index + 1);
      if (end < 0) throw new Error(`unterminated quote in ${line}`);
      word += line.slice(index + 1, end);
      inWord = true;
      index = end + 1;
    } else if (char === '\\') {
      word += line[index + 1] ?? '';
      inWord = true;
      index += 2;
    } else if (char === ' ') {
      if (inWord) words.push(word);
      word = '';
      inWord = false;
      index += 1;
    } else {
      word += char;
      inWord = true;
      index += 1;
    }
  }
  if (inWord) words.push(word);
  return words;
}

/** Leading blanks, then a double-quoted word (with \\ and \" escapes) or text up to a stop char. */
function curlWord(input: string, stop: RegExp): { word: string; rest: string } {
  const text = input.replace(/^[\t-\r ]+/, '');
  const quoted = /^"((?:\\[\\"]|[^"])*)"/.exec(text);
  if (quoted !== null) {
    return {
      word: quoted[1]!.replace(/\\([\\"])/g, '$1'),
      rest: text.slice(quoted[0].length),
    };
  }
  const end = text.search(stop) < 0 ? text.length : text.search(stop);
  return { word: text.slice(0, end).replace(/[\t-\r ]+$/, ''), rest: text.slice(end) };
}

type SentPart = { name: string; value: string } | { name: string; path: string; fileName: string };

/** What curl sends for one form option, modelled on curl's tool_formparse.c. */
function curlFormPart(option: string, arg: string): SentPart {
  const name = arg.slice(0, arg.indexOf('='));
  const content = arg.slice(name.length + 1);
  if (option === '--form-string') return { name, value: content };
  if (content.startsWith('<')) throw new Error(`curl reads the value from a file: ${arg}`);
  if (!content.startsWith('@')) {
    const { word, rest } = curlWord(content, /;/);
    if (rest !== '') throw new Error(`curl parses options from the value: ${arg}`);
    return { name, value: word };
  }
  const { word: path, rest } = curlWord(content.slice(1), /[;,]/);
  if (rest === '') return { name, path, fileName: path.slice(path.lastIndexOf('/') + 1) };
  if (!rest.startsWith(';filename=')) throw new Error(`unexpected file options: ${arg}`);
  const { word: fileName, rest: tail } = curlWord(rest.slice(';filename='.length), /[;,]/);
  if (tail !== '') throw new Error(`unexpected data after the file name: ${arg}`);
  return { name, path, fileName };
}

/** The parts curl sends for the form options of a curl command line. */
function sentParts(line: string): SentPart[] {
  const words = shellWords(line);
  const parts: SentPart[] = [];
  for (let index = 0; index < words.length; index += 1) {
    const option = words[index]!;
    if (option === '-F' || option === '--form-string') {
      parts.push(curlFormPart(option, words[index + 1]!));
      index += 1;
    }
  }
  return parts;
}

function request(overrides: Partial<RequestPreview> = {}): RequestPreview {
  return {
    method: 'GET',
    url: 'http://localhost:8080/engine-rest/task',
    headers: {},
    ...overrides,
  };
}

describe('maskHeaders', () => {
  it('masks the values of secret header names in any case', () => {
    for (const name of SECRET_NAMES) {
      expect(maskHeaders({ [name]: 'abc123' }, false)).toEqual({ [name]: '***' });
    }
  });

  it('keeps non-secret headers unchanged', () => {
    for (const name of PLAIN_NAMES) {
      expect(maskHeaders({ [name]: 'Bearer abc' }, false)).toEqual({ [name]: 'Bearer abc' });
    }
  });

  it('keeps well-known auth schemes in front of the masked credential', () => {
    for (const scheme of SCHEMES) {
      expect(maskHeaders({ Authorization: `${scheme} c2VjcmV0` }, false)).toEqual({
        Authorization: `${scheme} ***`,
      });
    }
  });

  it('matches schemes case-insensitively and keeps their spelling', () => {
    expect(maskHeaders({ Authorization: 'bearer abc' }, false)).toEqual({
      Authorization: 'bearer ***',
    });
    expect(maskHeaders({ Authorization: 'BASIC dXNlcjpwdw==' }, false)).toEqual({
      Authorization: 'BASIC ***',
    });
  });

  it('accepts any whitespace between scheme and credential', () => {
    expect(maskHeaders({ Authorization: 'Bearer   abc' }, false).Authorization).toBe('Bearer ***');
    expect(maskHeaders({ Authorization: 'Bearer\tabc' }, false).Authorization).toBe('Bearer ***');
  });

  it('masks everything when there is no credential after the scheme or no known scheme', () => {
    const cases = [
      'Bearer',
      'Bearer   ',
      ' Bearer abc',
      'xBearer abc',
      'Custom abc',
      'a=b; c=d',
      '',
    ];
    for (const value of cases) {
      expect(maskHeaders({ Authorization: value }, false).Authorization).toBe('***');
    }
  });

  it('masks only the secret headers of a mixed set', () => {
    expect(
      maskHeaders(
        { Accept: 'application/json', Authorization: 'Bearer abc', Cookie: 'JSESSIONID=1' },
        false,
      ),
    ).toEqual({ Accept: 'application/json', Authorization: 'Bearer ***', Cookie: '***' });
  });

  it('returns all values unchanged in a new object with show', () => {
    const headers = { Authorization: 'Bearer abc', Accept: 'text/plain' };
    const shown = maskHeaders(headers, true);
    expect(shown).toEqual(headers);
    expect(shown).not.toBe(headers);
  });

  it('never leaks a credential of a secret header (property)', () => {
    const scheme = fc.option(fc.constantFrom(...SCHEMES), { nil: undefined });
    const credential = fc.stringMatching(/^[A-Za-z0-9+/=._~-]{1,40}$/);
    fc.assert(
      fc.property(fc.constantFrom(...SECRET_NAMES), scheme, credential, (name, prefix, secret) => {
        const value = prefix === undefined ? secret : `${prefix} ${secret}`;
        const masked = maskHeaders({ [name]: value }, false)[name];
        expect(masked).toBe(prefix === undefined ? '***' : `${prefix} ***`);
      }),
    );
  });

  it('reduces any secret value to *** or a scheme prefix of it (property)', () => {
    fc.assert(
      fc.property(fc.constantFrom(...SECRET_NAMES), fc.string(), (name, value) => {
        const masked = maskHeaders({ [name]: value }, false)[name]!;
        if (value.length > 0 && !'***'.includes(value)) expect(masked).not.toBe(value);
        if (masked === '***') return;
        const scheme = masked.slice(0, -' ***'.length);
        expect(masked.endsWith(' ***')).toBe(true);
        expect(value.startsWith(scheme)).toBe(true);
        expect(SCHEMES.map((known) => known.toLowerCase())).toContain(scheme.toLowerCase());
      }),
    );
  });

  it('leaves non-secret headers unchanged (property)', () => {
    const name = fc
      .string()
      .filter((text) => !/authorization|cookie|token|secret|password|api-?key/i.test(text));
    fc.assert(
      fc.property(fc.dictionary(name, fc.string()), (headers) => {
        expect(maskHeaders(headers, false)).toEqual(headers);
      }),
    );
  });
});

describe('maskUrl', () => {
  it('masks the userinfo password', () => {
    expect(maskUrl('https://user:pw@host/x', false)).toBe('https://user:***@host/x');
    expect(maskUrl('http://admin:secret@localhost:8080/engine-rest?a=1#f', false)).toBe(
      'http://admin:***@localhost:8080/engine-rest?a=1#f',
    );
    expect(maskUrl('https://user:pw@host', false)).toBe('https://user:***@host');
  });

  it('masks a password that contains @ and : up to the last @ of the authority', () => {
    expect(maskUrl('https://u:p@ss:w@host/', false)).toBe('https://u:***@host/');
  });

  it('masks a password with an empty user name', () => {
    expect(maskUrl('https://:pw@host', false)).toBe('https://:***@host');
  });

  it('splits the userinfo at the first colon and ends it at the last @', () => {
    expect(maskUrl('http://a@b:c@host/x', false)).toBe('http://a@b:***@host/x');
    expect(maskUrl('http://u:p@h:8080@x/y', false)).toBe('http://u:***@x/y');
    expect(maskUrl('http://u:p@host:8080/a@b', false)).toBe('http://u:***@host:8080/a@b');
  });

  it('keeps URLs without a password unchanged', () => {
    const urls = [
      'https://user@host/x',
      'https://user:@host/x',
      'http://localhost:8080/engine-rest',
      'http://host/a:b@c',
      'http://host?x=a:b@c',
      'http://host#a:b@c',
      'http://host\\a:b@c',
      'http://host',
      'not a url',
      'mailto:a:b@c',
      '1http://u:p@h',
      'see http://u:p@h',
      '',
    ];
    for (const url of urls) expect(maskUrl(url, false)).toBe(url);
  });

  it('accepts any scheme letters, digits, +, . and -', () => {
    expect(maskUrl('HTTPS://u:p@h', false)).toBe('HTTPS://u:***@h');
    expect(maskUrl('git+ssh.v2-x://u:p@h', false)).toBe('git+ssh.v2-x://u:***@h');
  });

  it('returns the URL unchanged with show', () => {
    expect(maskUrl('https://user:pw@host/x', true)).toBe('https://user:pw@host/x');
  });

  it('never leaks the userinfo password (property)', () => {
    const user = fc.stringMatching(/^[A-Za-z0-9._~%!$&'()*+,;=-]{0,12}$/);
    const password = fc.stringMatching(/^[^@/?#\\]{1,20}$/);
    const rest = fc.stringMatching(/^(?:[/?#][^@]{0,20})?$/);
    fc.assert(
      fc.property(user, password, rest, (name, secret, tail) => {
        const masked = maskUrl(`https://${name}:${secret}@example.com${tail}`, false);
        expect(masked).toBe(`https://${name}:***@example.com${tail}`);
        expect(masked.slice(0, masked.indexOf('@'))).toBe(`https://${name}:***`);
      }),
    );
  });
});

describe('maskUrlsInText', () => {
  it('masks every URL password in a text, as quoted by fetch and network errors', () => {
    const url = 'http://demo:s3cret@localhost:1/engine-rest/x';
    const text = `Cannot reach ${url} (Request cannot be constructed from a URL that includes credentials: ${url})`;
    const masked = 'http://demo:***@localhost:1/engine-rest/x';
    expect(maskUrlsInText(text, false)).toBe(
      `Cannot reach ${masked} (Request cannot be constructed from a URL that includes credentials: ${masked})`,
    );
  });

  it('ends URLs at whitespace, double quotes and angle brackets', () => {
    expect(maskUrlsInText('"http://u:p@h" <https://a:b@c>', false)).toBe(
      '"http://u:***@h" <https://a:***@c>',
    );
    expect(maskUrlsInText('see http://u:p@h, then x@y', false)).toBe(
      'see http://u:***@h, then x@y',
    );
    const unchanged = [
      'http://u:p q@h',
      'http://u:p\tq@h',
      'http://u:p"q@h',
      'http://u:p<q@h',
      'http://u:p>q@h',
      'http://u q:p@h',
      'http://u"q:p@h',
      'http://u<q:p@h',
      'http://u>q:p@h',
      'http://host:8080 mail me@example.com',
      'http://host/a:b@c',
      'http://host?a:b@c',
      'http://host#a:b@c',
      'http://host\\a:b@c',
      'http://u:@h',
      'mailto:a:b@c',
      'no url here',
      '',
    ];
    for (const text of unchanged) expect(maskUrlsInText(text, false)).toBe(text);
  });

  it('masks up to the last @ of the authority and keeps the user name', () => {
    expect(maskUrlsInText('x http://u:p@ss@host/a@b y', false)).toBe('x http://u:***@host/a@b y');
    expect(maskUrlsInText('http://a@b:c@host', false)).toBe('http://a@b:***@host');
    expect(maskUrlsInText('http://:pw@host', false)).toBe('http://:***@host');
  });

  it('finds URLs right after other characters and with any scheme', () => {
    expect(maskUrlsInText('(1http://u:p@h)', false)).toBe('(1http://u:***@h)');
    expect(maskUrlsInText('url=git+ssh.v2-x://u:p@h', false)).toBe('url=git+ssh.v2-x://u:***@h');
    expect(maskUrlsInText(`${'w'.repeat(40)}http://u:p@h`, false)).toBe(
      `${'w'.repeat(40)}http://u:***@h`,
    );
  });

  it('masks schemes that end with a digit, +, . or - but needs a letter to start one', () => {
    for (const scheme of ['s3', 'x+', 'x.', 'x-', 'a1.+-']) {
      expect(maskUrlsInText(`${scheme}://u:p@h`, false)).toBe(`${scheme}://u:***@h`);
    }
    for (const text of ['3://u:p@h', '+://u:p@h', ' ://u:p@h', '://u:p@h']) {
      expect(maskUrlsInText(text, false)).toBe(text);
    }
  });

  it('returns the text unchanged with show', () => {
    expect(maskUrlsInText('http://u:p@h', true)).toBe('http://u:p@h');
  });

  it('scans long texts in linear time', () => {
    const text = `${'a'.repeat(200_000)} ${'b.'.repeat(100_000)}`;
    const start = performance.now();
    expect(maskUrlsInText(text, false)).toBe(text);
    expect(performance.now() - start).toBeLessThan(1000);
  });

  it('never leaks a URL password in a text (property)', () => {
    const user = fc.stringMatching(/^[^\s"<>:/?#\\]{0,12}$/);
    const password = fc.stringMatching(/^[^\s"<>/?#\\]{1,20}$/);
    const tail = fc
      .stringMatching(/^(?:[/?#][^\s]{0,20})?$/)
      .filter((text) => !text.includes('://'));
    const words = fc.string().filter((text) => !text.includes('://'));
    const parts = fc.record({
      before: words,
      name: user,
      secret: password,
      rest: tail,
      after: words,
    });
    fc.assert(
      fc.property(parts, ({ before, name, secret, rest, after }) => {
        const text = `${before} https://${name}:${secret}@example.com${rest} ${after}`;
        expect(maskUrlsInText(text, false)).toBe(
          `${before} https://${name}:***@example.com${rest} ${after}`,
        );
      }),
    );
  });
});

describe('shellQuote', () => {
  it('wraps text in single quotes and escapes embedded single quotes', () => {
    expect(shellQuote('abc')).toBe("'abc'");
    expect(shellQuote("it's")).toBe("'it'\\''s'");
    expect(shellQuote('')).toBe("''");
    expect(shellQuote("''")).toBe("''\\'''\\'''");
  });

  it('round-trips through a POSIX shell word parser (property)', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'binary' }), (text) => {
        expect(shellWords(shellQuote(text))).toEqual([text]);
      }),
    );
  });
});

describe('curlCommand', () => {
  it('omits -X for GET and quotes URL and headers', () => {
    expect(curlCommand(request({ headers: { Accept: 'application/json' } }))).toBe(
      "curl 'http://localhost:8080/engine-rest/task' -H 'Accept: application/json'",
    );
  });

  it('adds -X and --data-raw with compact JSON for JSON bodies', () => {
    const preview = request({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: { name: "it's", n: 1 },
    });
    expect(curlCommand(preview)).toBe(
      "curl -X POST 'http://localhost:8080/engine-rest/task' -H 'Content-Type: application/json' --data-raw '{\"name\":\"it'\\''s\",\"n\":1}'",
    );
  });

  it('renders requests without headers and body', () => {
    expect(curlCommand(request({ method: 'DELETE' }))).toBe(
      "curl -X DELETE 'http://localhost:8080/engine-rest/task'",
    );
  });

  it('writes headers with blank values as Name; because curl drops Name: with no value', () => {
    const header = (value: string) =>
      curlCommand(request({ headers: { 'X-Empty': value } })).split(' -H ')[1];
    for (const value of ['', ' ', '\t', '\r\n', ' \t ']) expect(header(value)).toBe("'X-Empty;'");
    for (const value of ['a', ' a ', '\u00a0', '\v', '\f']) {
      expect(header(value)).toBe(shellQuote(`X-Empty: ${value}`));
    }
  });

  it('uses --head for HEAD requests, which -X HEAD would make hang', () => {
    expect(curlCommand(request({ method: 'HEAD' }))).toBe(
      "curl --head 'http://localhost:8080/engine-rest/task'",
    );
    expect(curlCommand(request({ method: 'head' }))).toBe(
      "curl -X head 'http://localhost:8080/engine-rest/task'",
    );
  });

  it('quotes methods that are not plain words', () => {
    expect(curlCommand(request({ method: 'M ETHOD' }))).toBe(
      "curl -X 'M ETHOD' 'http://localhost:8080/engine-rest/task'",
    );
    expect(curlCommand(request({ method: 'PATCH_2-x' }))).toBe(
      "curl -X PATCH_2-x 'http://localhost:8080/engine-rest/task'",
    );
    expect(curlCommand(request({ method: 'get' }))).toBe(
      "curl -X get 'http://localhost:8080/engine-rest/task'",
    );
  });

  it('renders JSON scalars and null bodies', () => {
    expect(curlCommand(request({ method: 'PUT', body: null }))).toContain("--data-raw 'null'");
    expect(curlCommand(request({ method: 'PUT', body: 'text' }))).toContain(`--data-raw '"text"'`);
    expect(curlCommand(request({ method: 'PUT', body: false }))).toContain("--data-raw 'false'");
  });

  it('renders multipart previews as -F options', () => {
    const body: MultipartPartPreview[] = [
      { name: 'deployment-name', value: 'my deployment' },
      { name: 'data', fileName: 'order.bpmn', bytes: 1234 },
    ];
    expect(curlCommand(request({ method: 'POST', body }))).toBe(
      "curl -X POST 'http://localhost:8080/engine-rest/task' -F 'deployment-name=my deployment' -F 'data=@order.bpmn'",
    );
  });

  it('uses --form-string for values curl -F would interpret', () => {
    const parts = (value: string) =>
      curlCommand(request({ method: 'POST', body: [{ name: 'n', value }] }));
    expect(parts('@file')).toContain("--form-string 'n=@file'");
    expect(parts('<file')).toContain("--form-string 'n=<file'");
    expect(parts('"quoted"')).toContain(`--form-string 'n="quoted"'`);
    expect(parts('a;type=text/x')).toContain("--form-string 'n=a;type=text/x'");
    expect(parts('a@b<c"d')).toContain(`-F 'n=a@b<c"d'`);
    expect(parts('')).toContain("-F 'n='");
  });

  it('uses --form-string for values with blanks at either end, which curl -F strips', () => {
    const option = (value: string) =>
      curlCommand(request({ method: 'POST', body: [{ name: 'n', value }] })).split(' ')[4];
    for (const value of [' a', 'a ', '\ta', 'a\t', '\na', 'a\n', '\va', '\fa', '\ra', 'a\r']) {
      expect(option(value)).toBe('--form-string');
    }
    for (const value of ['a b', 'a\tb', '\u00a0a', 'a\u00a0', '\u000ea', 'a\u0008']) {
      expect(option(value)).toBe('-F');
    }
  });

  it('double-quotes file names with ; , " or \\ and with blanks at either end', () => {
    const file = (fileName: string) =>
      curlCommand(request({ method: 'POST', body: [{ name: 'data', fileName, bytes: 1 }] }));
    expect(file('a;b.bpmn')).toContain(`-F 'data=@"a;b.bpmn"'`);
    expect(file('a,b.bpmn')).toContain(`-F 'data=@"a,b.bpmn"'`);
    expect(file('a"b.bpmn')).toContain(`-F 'data=@"a\\"b.bpmn"'`);
    expect(file('a\\b.bpmn')).toContain(`-F 'data=@"a\\\\b.bpmn"'`);
    expect(file(' a.bpmn')).toContain(`-F 'data=@" a.bpmn"'`);
    expect(file('a.bpmn\t')).toContain(`-F 'data=@"a.bpmn\t"'`);
    expect(file('a b.bpmn')).toContain("-F 'data=@a b.bpmn'");
  });

  it('adds ;filename= for paths, because curl sends only the base name', () => {
    const file = (fileName: string) =>
      curlCommand(request({ method: 'POST', body: [{ name: 'data', fileName, bytes: 1 }] }));
    expect(file('sub/a b.bpmn')).toContain("-F 'data=@sub/a b.bpmn;filename=sub/a b.bpmn'");
    expect(file('d;x/a.bpmn')).toContain(`-F 'data=@"d;x/a.bpmn";filename="d;x/a.bpmn"'`);
    expect(file('a.bpmn')).toContain("-F 'data=@a.bpmn'");
  });

  it('treats arrays as JSON when the content type is JSON or not every item is a part', () => {
    const parts = [{ name: 'a', value: 'b' }];
    const json = (body: unknown, headers: Record<string, string> = {}) =>
      curlCommand(request({ method: 'POST', body, headers }));
    expect(json(parts, { 'content-type': 'Application/JSON' })).toContain(
      `--data-raw '[{"name":"a","value":"b"}]'`,
    );
    expect(json([])).toContain("--data-raw '[]'");
    expect(json([...parts, 'x'])).toContain('--data-raw');
    expect(json([...parts, null])).toContain('--data-raw');
    expect(json([{ name: 1, value: 'b' }])).toContain('--data-raw');
    expect(json([{ name: 'a', value: 1 }])).toContain('--data-raw');
    expect(json([{ name: 'a', fileName: 'f' }])).toContain('--data-raw');
    expect(json([{ name: 'a', bytes: 1 }])).toContain('--data-raw');
    expect(json({ name: 'a', value: 'b' })).toContain('--data-raw');
  });

  it('treats part lists as multipart unless a content-type header says JSON', () => {
    const body = [{ name: 'a', value: 'b' }];
    const multipart = (headers: Record<string, string>) =>
      curlCommand(request({ method: 'POST', body, headers }));
    expect(multipart({ Accept: 'application/json' })).toContain("-F 'a=b'");
    expect(multipart({ 'Content-Type': 'multipart/form-data' })).toContain("-F 'a=b'");
    expect(multipart({ 'X-Content-Type': 'application/json' })).toContain("-F 'a=b'");
  });

  it('round-trips every argument through a POSIX shell word parser (property)', () => {
    const text = fc.string({ unit: 'binary' });
    fc.assert(
      fc.property(
        fc.oneof(fc.constantFrom('GET', 'HEAD', 'POST', 'DELETE'), text),
        text,
        fc.dictionary(text, text),
        fc.option(fc.jsonValue(), { nil: undefined }),
        (method, url, headers, body) => {
          const allHeaders = { ...headers, 'Content-Type': 'application/json' };
          const preview: RequestPreview =
            body === undefined
              ? { method, url, headers: allHeaders }
              : { method, url, headers: allHeaders, body };
          const expected = [
            'curl',
            ...(method === 'GET' ? [] : method === 'HEAD' ? ['--head'] : ['-X', method]),
            url,
            ...Object.entries(allHeaders).flatMap(([name, value]) => [
              '-H',
              /^[\t\n\r ]*$/.test(value) ? `${name};` : `${name}: ${value}`,
            ]),
            ...(body === undefined ? [] : ['--data-raw', JSON.stringify(body)]),
          ];
          expect(shellWords(curlCommand(preview))).toEqual(expected);
        },
      ),
    );
  });

  it('makes curl send exactly the previewed parts (property)', () => {
    const text = fc.string({ unit: 'binary' });
    const name = text.filter((value) => !value.includes('='));
    const part = fc.oneof(
      fc.record({ name, value: text }),
      fc.record({ name, fileName: text, bytes: fc.nat() }),
    );
    fc.assert(
      fc.property(fc.array(part, { minLength: 1, maxLength: 4 }), (parts) => {
        const line = curlCommand(request({ method: 'POST', body: parts }));
        const expected = parts.map((item) =>
          'fileName' in item
            ? { name: item.name, path: item.fileName, fileName: item.fileName }
            : { name: item.name, value: item.value },
        );
        expect(sentParts(line)).toEqual(expected);
        expect(shellWords(line).slice(0, 4)).toEqual([
          'curl',
          '-X',
          'POST',
          'http://localhost:8080/engine-rest/task',
        ]);
      }),
    );
  });

  it('models curl -F parsing in the test oracle', () => {
    expect(sentParts(`curl -F 'n= a b ' -F 'n="q\\"x"'`)).toEqual([
      { name: 'n', value: 'a b' },
      { name: 'n', value: 'q"x' },
    ]);
    expect(sentParts("curl -F 'f=@sub/a.bpmn' -F 'f=@\"unclosed'")).toEqual([
      { name: 'f', path: 'sub/a.bpmn', fileName: 'a.bpmn' },
      { name: 'f', path: '"unclosed', fileName: '"unclosed' },
    ]);
    expect(() => sentParts("curl -F 'f=@\"un;closed'")).toThrow('unexpected file options');
    expect(() => sentParts("curl -F 'n=a;type=x'")).toThrow('curl parses options');
    expect(() => sentParts("curl -F 'n=<x'")).toThrow('curl reads the value from a file');
  });
});
