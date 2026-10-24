import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { errorCodeForStatus, httpError, parseEngineError, redirectError } from './errors.js';
import type { HttpResponse } from './types.js';

const REQUEST = { method: 'GET', url: 'http://localhost:8080/engine-rest/task/1' };

function response(
  status: number,
  body: string,
  contentType = 'application/json',
  statusText = '',
): HttpResponse {
  return {
    status,
    statusText,
    contentType,
    headers: { 'content-type': contentType },
    body: new TextEncoder().encode(body),
  };
}

const HINTS = {
  401: 'The engine requires authentication and operate sent no credentials. Use Basic auth: --auth basic --auth-user <name> with the password piped into --auth-password-stdin, OPERATE_USERNAME and OPERATE_PASSWORD, or a profile: `operate config set <profile> --auth basic --auth-user <name> --auth-password-env <VAR>`. OAuth: `operate config set <profile> --auth oauth --oauth-issuer <url> --oauth-client-id <id>`, then `operate auth login --profile <profile>` in a terminal. A token from elsewhere (SSO tooling, a CI secret): --auth bearer with OPERATE_TOKEN or --auth-token-stdin.',
  rejected:
    'The engine rejected the credentials of the Authorization header (from -H, OPERATE_HEADERS or the profile headers; `operate config show` shows which). Check user and password or the token.',
  queryParam:
    'A query parameter has a value the engine cannot read, e.g. a number beyond the int32 range or a malformed date; the engine reports this as 404. Check the option values.',
  403: 'The user is authenticated but lacks the authorization for this operation.',
  endpoint:
    'The endpoint does not exist. Check that the URL points to the REST API root, e.g. http://localhost:8080/engine-rest, and the engine name (--engine).',
  resource: 'Check the id or key. List existing resources with the `list` command of the group.',
  server:
    'The engine could not process the request; the engine message says why. Camunda 7 engines also report rule violations (task already claimed, dependent instances, ...) as 500, so retrying unchanged rarely helps.',
  client:
    'The engine rejected the request. Check parameters and body with `operate describe <group> <command>`.',
};

describe('errorCodeForStatus', () => {
  it.each([
    [399, 'HTTP_CLIENT_ERROR'],
    [400, 'HTTP_CLIENT_ERROR'],
    [401, 'UNAUTHORIZED'],
    [402, 'HTTP_CLIENT_ERROR'],
    [403, 'FORBIDDEN'],
    [404, 'NOT_FOUND'],
    [405, 'HTTP_CLIENT_ERROR'],
    [499, 'HTTP_CLIENT_ERROR'],
    [500, 'HTTP_SERVER_ERROR'],
    [501, 'HTTP_SERVER_ERROR'],
    [503, 'HTTP_SERVER_ERROR'],
  ])('maps %i to %s', (status, code) => {
    expect(errorCodeForStatus(status)).toBe(code);
  });

  it('maps every 5xx status to HTTP_SERVER_ERROR', () => {
    fc.assert(
      fc.property(fc.integer({ min: 500, max: 599 }), (status) => {
        expect(errorCodeForStatus(status)).toBe('HTTP_SERVER_ERROR');
      }),
    );
  });
});

describe('parseEngineError', () => {
  it('reads type, message, code and keeps the remaining properties as data', () => {
    const body = JSON.stringify({
      type: 'AuthorizationException',
      message: 'denied',
      code: 0,
      userId: 'demo',
      missingAuthorizations: [],
    });
    expect(parseEngineError(response(403, body))).toEqual({
      type: 'AuthorizationException',
      message: 'denied',
      code: 0,
      data: { userId: 'demo', missingAuthorizations: [] },
    });
  });

  it('omits data when there are no extra properties', () => {
    const parsed = parseEngineError(response(400, '{"type":"T","message":"m"}'));
    expect(parsed).toEqual({ type: 'T', message: 'm' });
    expect(parsed).not.toHaveProperty('data');
    expect(parsed).not.toHaveProperty('code');
  });

  it('drops properties with unexpected types', () => {
    expect(parseEngineError(response(400, '{"type":1,"message":false,"code":"7"}'))).toEqual({});
  });

  it.each(['application/problem+json; charset=utf-8', 'Application/JSON', 'APPLICATION/JSON'])(
    'accepts the JSON content type %s',
    (contentType) => {
      expect(parseEngineError(response(400, '{"message":"m"}', contentType))).toEqual({
        message: 'm',
      });
    },
  );

  it('reads a plain text body as the message, shortened to 500 characters', () => {
    const jackson =
      'Cannot deserialize value of type `java.lang.String` from Array value (token `JsonToken.START_ARRAY`)';
    expect(parseEngineError(response(400, `${jackson}\n`, 'text/plain; charset=UTF-8'))).toEqual({
      message: jackson,
    });
    const long = parseEngineError(response(400, 'x'.repeat(600), 'text/plain'));
    expect(long?.message).toBe(`${'x'.repeat(500)}…`);
    expect(parseEngineError(response(400, ' \n', 'text/plain'))).toBeUndefined();
  });

  it.each([
    ['an HTML page', '<html><body>Login</body></html>', 'text/html; charset=utf-8'],
    ['a binary content type', '{"message":"m"}', 'application/octet-stream'],
    ['an empty content type', '{"message":"m"}', ''],
    ['invalid JSON', '<html>oops</html>', 'application/json'],
    ['an empty body', '', 'application/json'],
    ['a JSON array', '[{"message":"m"}]', 'application/json'],
    ['JSON null', 'null', 'application/json'],
    ['a JSON string', '"m"', 'application/json'],
    ['a JSON number', '42', 'application/json'],
  ])('returns undefined for %s', (_name, body, contentType) => {
    expect(parseEngineError(response(500, body, contentType))).toBeUndefined();
  });
});

describe('httpError', () => {
  it('builds the message and details from the engine error', () => {
    const body = JSON.stringify({
      type: 'InvalidRequestException',
      message: 'Task with id 1 does not exist',
      code: 7,
      extra: true,
    });
    const error = httpError(response(404, body, 'application/json', 'Not Found'), REQUEST);
    expect(error.code).toBe('NOT_FOUND');
    expect(error.exitCode).toBe(5);
    expect(error.message).toBe('HTTP 404 Not Found: Task with id 1 does not exist');
    expect(error.details).toEqual({
      status: 404,
      request: REQUEST,
      hint: HINTS.resource,
      engineType: 'InvalidRequestException',
      engineMessage: 'Task with id 1 does not exist',
      engineCode: 7,
      data: { extra: true },
    });
  });

  it('falls back to the status line without an engine message', () => {
    const error = httpError(
      response(500, '<p>boom</p>', 'text/html', 'Internal Server Error'),
      REQUEST,
    );
    expect(error.message).toBe('HTTP 500 Internal Server Error');
    expect(error.details).toEqual({ status: 500, request: REQUEST, hint: HINTS.server });
  });

  it('shows the text of a plain text error body', () => {
    const body = 'Cannot deserialize value of type `java.lang.String` from Array value';
    const error = httpError(response(400, body, 'text/plain', 'Bad Request'), REQUEST);
    expect(error.message).toBe(`HTTP 400 Bad Request: ${body}`);
    expect(error.details.engineMessage).toBe(body);
    expect(error.details).not.toHaveProperty('engineType');
  });

  it('says that credentials were rejected when an Authorization header was sent', () => {
    const sent = { ...REQUEST, headers: { authorization: 'Basic ZGVtbzp3cm9uZw==' } };
    const error = httpError(response(401, ''), sent);
    expect(error.code).toBe('UNAUTHORIZED');
    expect(error.details.hint).toBe(HINTS.rejected);
    expect(error.details.request).toEqual(REQUEST);
    const other = { ...REQUEST, headers: { 'X-Tenant': 'a' } };
    expect(httpError(response(401, ''), other).details.hint).toBe(HINTS[401]);
  });

  it('names the user and the source of rejected Basic auth credentials', () => {
    const basic = { ...REQUEST, principal: { user: 'demo', source: 'env' } };
    const error = httpError(response(401, ''), basic);
    expect(error.code).toBe('UNAUTHORIZED');
    expect(error.exitCode).toBe(4);
    expect(error.details.hint).toBe(
      'The engine rejected the credentials of user demo (source: env). Check the username and the password; `operate config show` shows where each comes from. After a failed login the engine refuses the user for a few seconds (and locks it after repeated failures), so wait before retrying.',
    );
    expect(error.details.request).toEqual(REQUEST);
    expect(HINTS[401]).toContain('operate sent no credentials');
    expect(HINTS[401]).not.toContain('issues/1');
  });

  it('says why no credentials were sent when Basic auth is off', () => {
    const off = { ...REQUEST, authOff: 'Basic auth is switched off by OPERATE_AUTH=none' };
    const error = httpError(response(401, ''), off);
    expect(error.details.hint).toBe(
      HINTS[401].replace(
        'operate sent no credentials.',
        'operate sent no credentials: Basic auth is switched off by OPERATE_AUTH=none.',
      ),
    );
    expect(error.details.hint).not.toBe(HINTS[401]);
    // an Authorization header was sent after all: the credentials were rejected
    const sent = { ...off, headers: { Authorization: 'Bearer t' } };
    expect(httpError(response(401, ''), sent).details.hint).toBe(HINTS.rejected);
    expect(httpError(response(403, ''), off).details.hint).toBe(HINTS[403]);
  });

  it("lets the provider's hint win for 401 and 403, not for other statuses", () => {
    const oauth = {
      ...REQUEST,
      rejectedHint: 'OAuth hint',
      principal: { user: 'alice', source: 's' },
    };
    expect(httpError(response(401, ''), oauth).details.hint).toBe('OAuth hint');
    expect(httpError(response(403, ''), oauth).details.hint).toBe('OAuth hint');
    expect(httpError(response(500, ''), oauth).details.hint).toBe(HINTS.server);
    expect(httpError(response(401, ''), { ...REQUEST, rejectedHint: undefined }).details.hint).toBe(
      HINTS[401],
    );
  });

  it("appends the provider's note to the 401 and 403 hints only", () => {
    const note = 'A bearer token is set (from OPERATE_TOKEN) but not used.';
    const basic = { ...REQUEST, principal: { user: 'demo', source: 'flag' }, authNote: note };
    expect(httpError(response(401, ''), basic).details.hint).toMatch(
      /^The engine rejected the credentials of user demo \(source: flag\)\. .* A bearer token is set \(from OPERATE_TOKEN\) but not used\.$/,
    );
    expect(httpError(response(403, ''), basic).details.hint).toBe(`${HINTS[403]} ${note}`);
    const oauth = { ...REQUEST, rejectedHint: 'OAuth hint', authNote: note };
    expect(httpError(response(401, ''), oauth).details.hint).toBe(`OAuth hint ${note}`);
    expect(httpError(response(500, ''), oauth).details.hint).toBe(HINTS.server);
  });

  it('keeps the 403 hint with Basic auth credentials', () => {
    const basic = { ...REQUEST, principal: { user: 'demo', source: 'flag' } };
    expect(httpError(response(403, ''), basic).details.hint).toBe(HINTS[403]);
  });

  it('reports a 404 QueryParamException as a rejected request, not a missing resource', () => {
    const body = '{"type":"QueryParamException","message":"HTTP 404 Not Found"}';
    const error = httpError(response(404, body, 'application/json', 'Not Found'), REQUEST);
    expect(error.code).toBe('HTTP_CLIENT_ERROR');
    expect(error.exitCode).toBe(6);
    expect(error.details.hint).toBe(HINTS.queryParam);
  });

  it('omits an empty status text', () => {
    expect(httpError(response(502, '', 'text/plain'), REQUEST).message).toBe('HTTP 502');
  });

  it('does not repeat an engine message that equals the status line', () => {
    const body = '{"type":"NotFoundException","message":"HTTP 404 Not Found"}';
    const error = httpError(response(404, body, 'application/json', 'Not Found'), REQUEST);
    expect(error.message).toBe('HTTP 404 Not Found');
    expect(error.details.engineMessage).toBe('HTTP 404 Not Found');
  });

  it('keeps an engine message that only starts like the status line', () => {
    const body = '{"type":"T","message":"HTTP 404 Not Found: x"}';
    const error = httpError(response(404, body, 'application/json', 'Not Found'), REQUEST);
    expect(error.message).toBe('HTTP 404 Not Found: HTTP 404 Not Found: x');
  });

  it('ignores an empty engine message in the summary', () => {
    const error = httpError(
      response(400, '{"type":"T","message":""}', 'application/json', 'Bad'),
      REQUEST,
    );
    expect(error.message).toBe('HTTP 400 Bad');
    expect(error.details.engineMessage).toBe('');
  });

  it.each([
    { status: 401, type: 'text/html', body: '', code: 'UNAUTHORIZED', exit: 4, hint: HINTS[401] },
    {
      status: 403,
      type: 'application/json',
      body: '{"message":"no"}',
      code: 'FORBIDDEN',
      exit: 4,
      hint: HINTS[403],
    },
    {
      status: 404,
      type: 'text/html',
      body: '<h1>Not Found</h1>',
      code: 'NOT_FOUND',
      exit: 5,
      hint: HINTS.endpoint,
    },
    {
      status: 404,
      type: 'application/json',
      body: '[]',
      code: 'NOT_FOUND',
      exit: 5,
      hint: HINTS.endpoint,
    },
    {
      status: 404,
      type: 'application/json',
      body: '{"type":"T"}',
      code: 'NOT_FOUND',
      exit: 5,
      hint: HINTS.resource,
    },
    {
      status: 404,
      type: 'application/json',
      body: '{"type":"InvalidRequestException","message":"Task with id 1 does not exist"}',
      code: 'NOT_FOUND',
      exit: 5,
      hint: HINTS.resource,
    },
    {
      status: 404,
      type: 'application/json',
      body: '{"type":"NotFoundException","message":"HTTP 404 Not Found"}',
      code: 'NOT_FOUND',
      exit: 5,
      hint: HINTS.endpoint,
    },
    {
      status: 404,
      type: 'application/json',
      body: '{"timestamp":"2024-05-01T10:00:00.000+00:00","status":404,"error":"Not Found","path":"/x"}',
      code: 'NOT_FOUND',
      exit: 5,
      hint: HINTS.endpoint,
    },
    {
      status: 404,
      type: 'application/json',
      body: '{"message":"gone"}',
      code: 'NOT_FOUND',
      exit: 5,
      hint: HINTS.endpoint,
    },
    {
      status: 400,
      type: 'application/json',
      body: '{"message":"bad"}',
      code: 'HTTP_CLIENT_ERROR',
      exit: 6,
      hint: HINTS.client,
    },
    {
      status: 409,
      type: 'text/plain',
      body: '',
      code: 'HTTP_CLIENT_ERROR',
      exit: 6,
      hint: HINTS.client,
    },
    {
      status: 499,
      type: 'text/plain',
      body: '',
      code: 'HTTP_CLIENT_ERROR',
      exit: 6,
      hint: HINTS.client,
    },
    {
      status: 500,
      type: 'application/json',
      body: '{"message":"x"}',
      code: 'HTTP_SERVER_ERROR',
      exit: 7,
      hint: HINTS.server,
    },
    {
      status: 503,
      type: 'text/plain',
      body: '',
      code: 'HTTP_SERVER_ERROR',
      exit: 7,
      hint: HINTS.server,
    },
  ])(
    'status $status ($type $body) → $code, exit $exit',
    ({ status, type, body, code, exit, hint }) => {
      const error = httpError(response(status, body, type), REQUEST);
      expect(error.code).toBe(code);
      expect(error.exitCode).toBe(exit);
      expect(error.details.hint).toBe(hint);
      expect(error.details.status).toBe(status);
      expect(error.details.request).toEqual(REQUEST);
    },
  );

  describe('with the command that sent the request', () => {
    const LISTED = { command: 'process-instance get', listCommand: 'process-instance list' };
    const UNLISTED = { command: 'message correlate' };
    const missing =
      '{"type":"InvalidRequestException","message":"Process instance x does not exist"}';

    it('names the list command of the group for a missing resource', () => {
      expect(httpError(response(404, missing), REQUEST, LISTED).details.hint).toBe(
        'Check the id or key. List the existing ones with `operate process-instance list`.',
      );
    });

    it('points to describe for a missing resource of a group without list command', () => {
      expect(httpError(response(404, missing), REQUEST, UNLISTED).details.hint).toBe(
        'Check the id or key; `operate describe message correlate` explains the arguments.',
      );
    });

    it.each([
      [400, 'No process engine available'],
      [404, 'Process engine no-such-engine not available'],
    ])('points to ping when the named process engine does not exist (%i)', (status, message) => {
      const body = JSON.stringify({ type: 'InvalidRequestException', message });
      const hint =
        'The process engine named by --engine (or OPERATE_ENGINE, or the profile setting engine) does not exist. Run `operate ping` to list the engines of the REST API.';
      expect(httpError(response(status, body), REQUEST, LISTED).details.hint).toBe(hint);
      expect(httpError(response(status, body), REQUEST).details.hint).toBe(hint);
    });

    it.each([
      [500, 'No process engine available', HINTS.server],
      [400, 'No process engine available.', HINTS.client],
      [404, 'Process engine x is not available', 'Check the id or key.'],
      [404, 'Process instance x not available', 'Check the id or key.'],
      [400, 'Cannot start: No process engine available', HINTS.client],
    ])('keeps the status hint for %i "%s"', (status, message, start) => {
      const body = JSON.stringify({ type: 'InvalidRequestException', message });
      const hint = httpError(response(status, body), REQUEST).details.hint;
      expect(hint?.startsWith(start)).toBe(true);
    });

    it('names the describe command for other client errors', () => {
      expect(httpError(response(400, '{"message":"bad"}'), REQUEST, LISTED).details.hint).toBe(
        'The engine rejected the request. Check parameters and body with `operate describe process-instance get`.',
      );
    });

    it.each([
      [404, '{"type":"NotFoundException","message":"HTTP 404 Not Found"}', HINTS.endpoint],
      [401, '', HINTS[401]],
      [403, '', HINTS[403]],
      [500, '{"message":"x"}', HINTS.server],
    ])('keeps the generic hint for status %i', (status, body, hint) => {
      expect(httpError(response(status, body), REQUEST, LISTED).details.hint).toBe(hint);
    });
  });
});

describe('redirectError', () => {
  const redirect = (status: number, location?: string): HttpResponse => ({
    status,
    statusText: 'Found',
    contentType: 'text/html',
    headers: location === undefined ? {} : { Location: location },
    body: new Uint8Array(),
  });

  it('names the target without query and fragment, as configuration error', () => {
    const error = redirectError(redirect(302, '/login?next=/x&token=SECRET#f'), REQUEST);
    expect(error.code).toBe('HTTP_REDIRECT');
    expect(error.exitCode).toBe(3);
    expect(error.message).toBe('HTTP 302 Found: redirect to http://localhost:8080/login');
    expect(error.details).toMatchObject({ status: 302, request: REQUEST });
    expect(error.details.hint).toContain('operate does not follow redirects');
  });

  it('points to operate auth status for OAuth', () => {
    const oauth = redirectError(redirect(302, '/login'), {
      ...REQUEST,
      loginStatusCommand: 'operate auth status --profile p',
    });
    expect(oauth.details.hint).toMatch(
      /expired\. `operate auth status --profile p` shows whether the OAuth login is usable\.$/,
    );
    expect(redirectError(redirect(302), REQUEST).details.hint).not.toContain('auth status');
  });

  it('works without or with an unusable Location', () => {
    expect(redirectError(redirect(307), REQUEST).message).toBe('HTTP 307 Found: redirect');
    expect(redirectError(redirect(301, 'http://[::1'), REQUEST).message).toBe(
      'HTTP 301 Found: redirect',
    );
    const absolute = redirectError(redirect(308, 'https://other.example/engine-rest/'), REQUEST);
    expect(absolute.message).toBe('HTTP 308 Found: redirect to https://other.example/engine-rest/');
  });
});

describe('job execute hints', () => {
  const EXECUTE = { command: 'job execute', listCommand: 'job list' };
  const body = (message: string) => JSON.stringify({ type: 'InvalidRequestException', message });

  it('explains a 404 of a job that ran and failed, keeping NOT_FOUND', () => {
    const error = httpError(
      response(404, body('Unknown property used in expression'), 'application/json'),
      REQUEST,
      EXECUTE,
    );
    expect(error.code).toBe('NOT_FOUND');
    expect(error.details.hint).toBe(
      'The job ran and failed; the engine reports failures of job execute as 404. See `operate job get-stacktrace <id>` or `operate retry --incident <incident-id> --now`.',
    );
  });

  it('keeps the missing job hint for "No job found with id"', () => {
    const error = httpError(
      response(404, body("ENGINE-14026 No job found with id 'x'"), 'application/json'),
      REQUEST,
      EXECUTE,
    );
    expect(error.details.hint).toBe(
      'Check the id or key. List the existing ones with `operate job list`.',
    );
  });
});

describe('httpError for a BPMN that does not parse', () => {
  const deploy = { method: 'POST', url: 'http://localhost:8080/engine-rest/deployment/create' };

  it('points to the first error, its line and the details in data', () => {
    const body = JSON.stringify({
      type: 'ParseException',
      message: 'ENGINE-09005 Could not parse BPMN process. Errors: ...',
      details: {
        'broken.bpmn': {
          errors: [
            {
              message: "Invalid destination 'missing' of sequence flow 'f1'\nsecond line",
              line: 5,
              column: 72,
            },
            { message: 'other', line: 3, column: 49 },
          ],
          warnings: [],
        },
      },
    });
    const error = httpError(response(400, body, 'application/json', 'Bad Request'), deploy);
    expect(error.code).toBe('HTTP_CLIENT_ERROR');
    expect(error.details.hint).toBe(
      "The engine could not parse broken.bpmn: Invalid destination 'missing' of sequence flow 'f1' (line 5, column 72) and 1 more. Fix the file and deploy again; data.details lists every error with its line per resource.",
    );
  });

  it('stays readable without details, lines or with a long message', () => {
    const plain = JSON.stringify({ type: 'ParseException', message: 'broken' });
    expect(httpError(response(400, plain), deploy).details.hint).toBe(
      'The engine could not parse a resource. Fix the file and deploy again; data.details lists every error with its line per resource.',
    );
    const long = JSON.stringify({
      type: 'ParseException',
      details: { 'a.dmn': { errors: [{ message: 'x'.repeat(300) }, 'odd'] } },
    });
    const hint = httpError(response(400, long), deploy).details.hint ?? '';
    expect(hint).toMatch(/^The engine could not parse a\.dmn: x{199}…\. Fix/);
  });
});
