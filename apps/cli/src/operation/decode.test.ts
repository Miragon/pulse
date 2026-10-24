import { describe, expect, it } from 'vitest';
import type { HttpResponse } from '../http/types.js';
import { decodeResponse } from './decode.js';

const request = { method: 'GET', url: 'http://h/x', headers: {} };
const encoder = new TextEncoder();

function response(status: number, contentType: string, body: string | Uint8Array): HttpResponse {
  return {
    status,
    statusText: status === 204 ? 'No Content' : 'OK',
    contentType,
    headers: { 'content-type': contentType },
    body: typeof body === 'string' ? encoder.encode(body) : body,
  };
}

describe('decodeResponse', () => {
  it('returns none for 204', () => {
    expect(decodeResponse(response(204, 'application/json', '{"a":1}'), request)).toEqual({
      kind: 'none',
      status: 204,
      statusText: 'No Content',
      request,
    });
  });

  it('returns none for an empty body', () => {
    expect(decodeResponse(response(200, 'application/json', ''), request)).toEqual({
      kind: 'none',
      status: 200,
      statusText: 'OK',
      request,
    });
  });

  it('parses JSON content types', () => {
    expect(decodeResponse(response(200, 'application/json', '[1,"a"]'), request)).toEqual({
      kind: 'json',
      status: 200,
      value: [1, 'a'],
      text: '[1,"a"]',
      request,
    });
    expect(
      decodeResponse(response(201, 'application/hal+json;charset=UTF-8', '{"a":1}'), request),
    ).toEqual({ kind: 'json', status: 201, value: { a: 1 }, text: '{"a":1}', request });
    expect(decodeResponse(response(200, 'APPLICATION/JSON', 'null'), request)).toEqual({
      kind: 'json',
      status: 200,
      value: null,
      text: 'null',
      request,
    });
  });

  it('keeps Long values beyond 2^53 exactly', () => {
    const body = '{"type":"Long","value":9223372036854775807,"valueInfo":{}}';
    const result = decodeResponse(response(200, 'application/json', body), request);
    expect(result).toMatchObject({
      kind: 'json',
      value: { type: 'Long', value: 9223372036854775807n },
      text: body,
    });
  });

  it('falls back to text when JSON does not parse', () => {
    expect(decodeResponse(response(200, 'application/json', 'oops'), request)).toEqual({
      kind: 'text',
      status: 200,
      text: 'oops',
      contentType: 'application/json',
      request,
    });
  });

  it.each([
    'text/plain',
    'text/plain;charset=UTF-8',
    'TEXT/HTML',
    'application/xml',
    'application/bpmn+xml',
    'text/csv',
    'application/csv',
    'application/javascript',
    'application/x-javascript',
    'image/svg+xml',
    'Application/XML; charset=UTF-8',
    'application/xml ;charset=utf-8',
  ])('returns text for %s', (contentType) => {
    expect(decodeResponse(response(200, contentType, 'héllo'), request)).toEqual({
      kind: 'text',
      status: 200,
      text: 'héllo',
      contentType,
      request,
    });
  });

  it.each([
    'application/octet-stream',
    'image/png',
    '',
    'application/pdf',
    'video/text',
    'application/octet-stream; profile=text/plain',
    'application/octet-stream; type=application/xml',
    'application/octet-stream; profile=json',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/xmlx',
  ])('returns binary for %j', (contentType) => {
    const data = new Uint8Array([0, 255, 1]);
    expect(decodeResponse(response(200, contentType, data), request)).toEqual({
      kind: 'binary',
      status: 200,
      data,
      contentType,
      request,
    });
  });

  describe('charset', () => {
    // "café" in ISO-8859-1: é is the single byte 0xE9 (invalid as UTF-8)
    const latin1 = new Uint8Array([0x63, 0x61, 0x66, 0xe9]);

    it.each([
      'text/plain; charset=ISO-8859-1',
      'text/plain;charset=iso-8859-1',
      'text/plain; Charset="ISO-8859-1"',
      'text/plain; charset=ISO-8859-1; format=flowed',
      'text/plain; format=flowed; charset=ISO-8859-1',
    ])('decodes text with the charset of %j', (contentType) => {
      expect(decodeResponse(response(200, contentType, latin1), request)).toMatchObject({
        kind: 'text',
        text: 'café',
      });
    });

    it('decodes JSON with the declared charset', () => {
      const json = new Uint8Array([0x22, 0x63, 0x61, 0x66, 0xe9, 0x22]);
      expect(
        decodeResponse(response(200, 'application/json; charset=ISO-8859-1', json), request),
      ).toMatchObject({ kind: 'json', value: 'café' });
    });

    it('falls back to UTF-8 without or with an unknown charset', () => {
      for (const contentType of ['text/plain', 'text/plain; charset=x-unknown']) {
        expect(decodeResponse(response(200, contentType, 'héllo'), request)).toMatchObject({
          kind: 'text',
          text: 'héllo',
        });
      }
      expect(decodeResponse(response(200, 'text/plain', latin1), request)).toMatchObject({
        text: 'caf\uFFFD',
      });
    });
  });
});
