import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { OperationResult, RequestPreview } from '../operation/result.js';
import { project } from './fields.js';
import { fieldWarnings, type RenderOptions, renderResult, renderValue } from './render.js';

const URL_ROOT = 'http://localhost:8080/engine-rest';

const JSON_OPTIONS: RenderOptions = {
  format: 'json',
  pretty: false,
  maxWidth: 80,
  showSecrets: false,
};
const TABLE_OPTIONS: RenderOptions = { ...JSON_OPTIONS, format: 'table' };

function request(overrides: Partial<RequestPreview> = {}): RequestPreview {
  return { method: 'GET', url: `${URL_ROOT}/process-definition`, headers: {}, ...overrides };
}

function jsonResult(value: unknown): OperationResult {
  return { kind: 'json', status: 200, value, request: request() };
}

describe('renderValue', () => {
  it('renders compact JSON with one trailing newline', () => {
    expect(renderValue({ a: 1, b: [1, 'x'] }, JSON_OPTIONS)).toBe('{"a":1,"b":[1,"x"]}\n');
    expect(renderValue('line\nbreak', JSON_OPTIONS)).toBe('"line\\nbreak"\n');
  });

  it('indents JSON with two spaces when pretty', () => {
    expect(renderValue({ a: 1, b: [true] }, { ...JSON_OPTIONS, pretty: true })).toBe(
      '{\n  "a": 1,\n  "b": [\n    true\n  ]\n}\n',
    );
  });

  it('renders null and undefined as null', () => {
    expect(renderValue(null, JSON_OPTIONS)).toBe('null\n');
    expect(renderValue(undefined, JSON_OPTIONS)).toBe('null\n');
  });

  it('applies the --fields projection to JSON', () => {
    expect(
      renderValue([{ id: '1', name: 'a', x: 1 }], { ...JSON_OPTIONS, fields: ['id', 'name'] }),
    ).toBe('[{"id":"1","name":"a"}]\n');
  });

  it('renders tables with a trailing newline', () => {
    expect(renderValue([{ id: '1', name: 'a' }], TABLE_OPTIONS)).toBe('id  name\n1   a\n');
    expect(renderValue([], TABLE_OPTIONS)).toBe('No results.\n');
    expect(renderValue({ id: 'x' }, TABLE_OPTIONS)).toBe('FIELD  VALUE\nid     x\n');
  });

  it('uses --fields as table columns', () => {
    expect(
      renderValue([{ id: '1', a: { b: 2 }, c: 3 }], { ...TABLE_OPTIONS, fields: ['a.b', 'id'] }),
    ).toBe('a.b  id\n2    1\n');
  });

  it('passes maxWidth to the table', () => {
    expect(renderValue([{ id: 'x'.repeat(30) }], { ...TABLE_OPTIONS, maxWidth: 20 })).toBe(
      `id\n${'x'.repeat(19)}…\n`,
    );
  });

  it('prints a bare count for { count: n } tables', () => {
    expect(renderValue({ count: 42 }, TABLE_OPTIONS)).toBe('42\n');
    expect(renderValue({ count: 0 }, TABLE_OPTIONS)).toBe('0\n');
    expect(renderValue({ count: 3, other: 1 }, { ...TABLE_OPTIONS, fields: ['count'] })).toBe(
      '3\n',
    );
  });

  it('renders other count-like values as tables', () => {
    expect(renderValue({ count: '42' }, TABLE_OPTIONS)).toBe('FIELD  VALUE\ncount  42\n');
    expect(renderValue({ count: 1, other: 2 }, TABLE_OPTIONS)).toBe(
      'FIELD  VALUE\ncount  1\nother  2\n',
    );
    expect(renderValue({ total: 1 }, TABLE_OPTIONS)).toBe('FIELD  VALUE\ntotal  1\n');
    expect(renderValue([3], TABLE_OPTIONS)).toBe('3\n');
    expect(renderValue(null, TABLE_OPTIONS)).toBe('\n');
    expect(renderValue({}, TABLE_OPTIONS)).toBe('FIELD  VALUE\n');
  });

  it('keeps { count: n } as JSON in JSON output', () => {
    expect(renderValue({ count: 42 }, JSON_OPTIONS)).toBe('{"count":42}\n');
  });

  it('JSON output parses back to the projected value (property)', () => {
    const field = fc
      .array(fc.constantFrom('a', 'b', 'id', '__proto__', 'x'), { minLength: 1, maxLength: 3 })
      .map((parts) => parts.join('.'));
    const fields = fc.option(fc.array(field, { minLength: 1, maxLength: 4 }), { nil: undefined });
    fc.assert(
      fc.property(fc.jsonValue(), fields, fc.boolean(), (value, picked, pretty) => {
        const options =
          picked === undefined
            ? { ...JSON_OPTIONS, pretty }
            : { ...JSON_OPTIONS, pretty, fields: picked };
        const output = renderValue(value, options);
        expect(output.endsWith('\n')).toBe(true);
        expect(output.endsWith('\n\n')).toBe(false);
        if (!pretty) expect(output.indexOf('\n')).toBe(output.length - 1);
        expect(JSON.stringify(JSON.parse(output))).toBe(JSON.stringify(project(value, picked)));
      }),
    );
  });
});

describe('fieldWarnings', () => {
  it('warns once per missing field, listing at most 30 existing fields', () => {
    const wide = Object.fromEntries(Array.from({ length: 31 }, (_, index) => [`f${index}`, index]));
    const listed = Array.from({ length: 30 }, (_, index) => `f${index}`).join(', ');
    expect(fieldWarnings([wide], ['f0', 'x', 'y'])).toBe(
      [
        `Warning: field "x" not found in the response (fields: ${listed}, ...)`,
        `Warning: field "y" not found in the response (fields: ${listed}, ...)`,
        '',
      ].join('\n'),
    );
    const thirty = Object.fromEntries(Array.from({ length: 30 }, (_, index) => [`f${index}`, 1]));
    expect(fieldWarnings(thirty, ['x'])).toBe(
      `Warning: field "x" not found in the response (fields: ${listed})\n`,
    );
    expect(fieldWarnings(thirty, undefined)).toBe('');
  });
});

describe('renderResult', () => {
  const secretRequest = request({
    method: 'POST',
    url: 'http://demo:pw@localhost:8080/engine-rest/process-definition/key/order/start',
    headers: { Authorization: 'Bearer abc', 'Content-Type': 'application/json' },
    body: { businessKey: 'b-1' },
  });

  it('renders dry-run previews as JSON with masked secrets and a curl command', () => {
    const rendered = renderResult({ kind: 'dry-run', request: secretRequest }, JSON_OPTIONS);
    const expected = {
      method: 'POST',
      url: 'http://demo:***@localhost:8080/engine-rest/process-definition/key/order/start',
      headers: { Authorization: 'Bearer ***', 'Content-Type': 'application/json' },
      body: { businessKey: 'b-1' },
      curl: `curl -X POST 'http://demo:***@localhost:8080/engine-rest/process-definition/key/order/start' -H 'Authorization: Bearer ***' -H 'Content-Type: application/json' --data-raw '{"businessKey":"b-1"}'`,
    };
    expect(rendered).toEqual({ stdout: `${JSON.stringify(expected)}\n` });
  });

  it('writes the note of a dry-run to stderr', () => {
    const rendered = renderResult(
      { kind: 'dry-run', request: secretRequest, note: 'Not logged in with OAuth' },
      JSON_OPTIONS,
    );
    expect(rendered.stderr).toBe('Note: Not logged in with OAuth\n');
    expect(rendered.stdout).toContain('"method":"POST"');
  });

  it('shows secrets in dry-run previews with showSecrets', () => {
    const rendered = renderResult(
      { kind: 'dry-run', request: secretRequest },
      { ...JSON_OPTIONS, showSecrets: true },
    );
    const parsed = JSON.parse(rendered.stdout as string) as Record<string, unknown>;
    expect(parsed.url).toBe(secretRequest.url);
    expect(parsed.headers).toEqual(secretRequest.headers);
    expect(parsed.curl).toContain(`-H 'Authorization: Bearer abc'`);
    expect(parsed.curl).toContain(`'${secretRequest.url}'`);
  });

  it('pretty prints dry-run JSON, omits a missing body and ignores --fields', () => {
    const rendered = renderResult(
      { kind: 'dry-run', request: request() },
      { ...JSON_OPTIONS, pretty: true, fields: ['method'] },
    );
    expect(rendered.stdout).toBe(
      `${JSON.stringify(
        {
          method: 'GET',
          url: `${URL_ROOT}/process-definition`,
          headers: {},
          curl: `curl '${URL_ROOT}/process-definition'`,
        },
        null,
        2,
      )}\n`,
    );
  });

  it('renders dry-run previews as the masked curl line for tables', () => {
    expect(renderResult({ kind: 'dry-run', request: secretRequest }, TABLE_OPTIONS)).toEqual({
      stdout: `curl -X POST 'http://demo:***@localhost:8080/engine-rest/process-definition/key/order/start' -H 'Authorization: Bearer ***' -H 'Content-Type: application/json' --data-raw '{"businessKey":"b-1"}'\n`,
    });
  });

  it('renders JSON responses like renderValue', () => {
    const value = [{ id: '1', key: 'order' }];
    expect(renderResult(jsonResult(value), JSON_OPTIONS)).toEqual({
      stdout: '[{"id":"1","key":"order"}]\n',
    });
    expect(renderResult(jsonResult(value), { ...TABLE_OPTIONS, fields: ['key'] })).toEqual({
      stdout: 'key\norder\n',
    });
    expect(renderResult(jsonResult({ count: 7 }), TABLE_OPTIONS)).toEqual({ stdout: '7\n' });
  });

  it('prints the unwrapped XML raw when unwrap is set', () => {
    const value = { id: 'def:1', bpmn20Xml: '<definitions/>' };
    expect(renderResult(jsonResult(value), { ...JSON_OPTIONS, unwrap: 'bpmn20Xml' })).toEqual({
      stdout: '<definitions/>\n',
    });
    expect(
      renderResult(jsonResult({ dmnXml: '<x/>\n' }), { ...TABLE_OPTIONS, unwrap: 'dmnXml' }),
    ).toEqual({ stdout: '<x/>\n' });
    expect(renderResult(jsonResult({ dmnXml: '' }), { ...JSON_OPTIONS, unwrap: 'dmnXml' })).toEqual(
      { stdout: '' },
    );
  });

  it('renders the JSON value when unwrap is not set or does not apply', () => {
    const value = { id: 'def:1', bpmn20Xml: '<definitions/>' };
    expect(renderResult(jsonResult(value), JSON_OPTIONS).stdout).toBe(
      '{"id":"def:1","bpmn20Xml":"<definitions/>"}\n',
    );
    expect(renderResult(jsonResult({ undefined: '<x/>' }), JSON_OPTIONS).stdout).toBe(
      '{"undefined":"<x/>"}\n',
    );
    const unwrap = { ...JSON_OPTIONS, unwrap: 'bpmn20Xml' };
    expect(renderResult(jsonResult({ id: 'x' }), unwrap).stdout).toBe('{"id":"x"}\n');
    expect(renderResult(jsonResult({ bpmn20Xml: null }), unwrap).stdout).toBe(
      '{"bpmn20Xml":null}\n',
    );
    expect(renderResult(jsonResult(null), unwrap).stdout).toBe('null\n');
    expect(renderResult(jsonResult('<xml/>'), unwrap).stdout).toBe('"<xml/>"\n');
    const inherited = Object.create({ bpmn20Xml: '<definitions/>' }) as object;
    expect(renderResult(jsonResult(inherited), unwrap).stdout).toBe('{}\n');
  });

  it('prints text responses raw with a trailing newline', () => {
    const text = (body: string): OperationResult => ({
      kind: 'text',
      status: 200,
      text: body,
      contentType: 'text/plain',
      request: request(),
    });
    expect(renderResult(text('a,b\n1,2'), JSON_OPTIONS)).toEqual({ stdout: 'a,b\n1,2\n' });
    expect(renderResult(text('done\n'), TABLE_OPTIONS)).toEqual({ stdout: 'done\n' });
    expect(renderResult(text(''), JSON_OPTIONS)).toEqual({ stdout: '' });
  });

  it('passes binary responses through unchanged', () => {
    const data = new Uint8Array([0, 1, 255]);
    const rendered = renderResult(
      {
        kind: 'binary',
        status: 200,
        data,
        contentType: 'application/octet-stream',
        request: request(),
      },
      JSON_OPTIONS,
    );
    expect(rendered).toEqual({ stdout: data });
    expect(rendered.stdout).toBe(data);
  });

  it('reports empty responses on stderr with method, path, query and status', () => {
    const none: OperationResult = {
      kind: 'none',
      status: 204,
      statusText: 'No Content',
      request: request({
        method: 'DELETE',
        url: `http://u:pw@localhost:8080/engine-rest/process-instance/abc?skipCustomListeners=true#x`,
      }),
    };
    expect(renderResult(none, JSON_OPTIONS)).toEqual({
      stderr:
        'Done: DELETE /engine-rest/process-instance/abc?skipCustomListeners=true → 204 No Content\n',
    });
  });

  it('shows the path relative to the REST root, like operate api takes it', () => {
    const done = (url: string, baseUrl: string) =>
      renderResult(
        { kind: 'none', status: 204, statusText: 'No Content', request: request({ url }) },
        { ...JSON_OPTIONS, baseUrl },
      ).stderr;
    expect(done(`${URL_ROOT}/task/t1/complete?x=1`, URL_ROOT)).toBe(
      'Done: GET /task/t1/complete?x=1 → 204 No Content\n',
    );
    expect(done(`${URL_ROOT}/engine/e1/task/t1/complete`, `${URL_ROOT}//`)).toBe(
      'Done: GET /engine/e1/task/t1/complete → 204 No Content\n',
    );
    // a root without path, a request outside the root and an unparseable root keep the path
    expect(done('http://h:8080/task/t1', 'http://h:8080/')).toBe(
      'Done: GET /task/t1 → 204 No Content\n',
    );
    expect(done('http://h/engine-restless/task', 'http://h/engine-rest')).toBe(
      'Done: GET /engine-restless/task → 204 No Content\n',
    );
    expect(done('http://h/engine-rest/task', 'not a url')).toBe(
      'Done: GET /engine-rest/task → 204 No Content\n',
    );
  });

  it('omits an empty status text and keeps unparseable URLs', () => {
    const none: OperationResult = {
      kind: 'none',
      status: 204,
      statusText: '',
      request: request({ method: 'PUT', url: 'not a url' }),
    };
    expect(renderResult(none, TABLE_OPTIONS)).toEqual({ stderr: 'Done: PUT not a url → 204\n' });
  });

  it('masks the password of an unparseable URL in the Done line', () => {
    const none: OperationResult = {
      kind: 'none',
      status: 204,
      statusText: 'No Content',
      request: request({ method: 'PUT', url: 'http://u:pw@host:99999/x' }),
    };
    expect(renderResult(none, { ...TABLE_OPTIONS, showSecrets: true })).toEqual({
      stderr: 'Done: PUT http://u:***@host:99999/x → 204 No Content\n',
    });
  });
});
