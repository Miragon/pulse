import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { flagName, kebab, pluralize, shortCommandName, splitWords } from './naming.js';

describe('splitWords', () => {
  it.each([
    ['getProcessInstances', ['get', 'process', 'instances']],
    ['Process Instance', ['process', 'instance']],
    ['process-instance', ['process', 'instance']],
    ['getRestAPIVersion', ['get', 'rest', 'api', 'version']],
    ['getProcessDefinitionBpmn20Xml', ['get', 'process', 'definition', 'bpmn20', 'xml']],
    ['DMN', ['dmn']],
    ['XMLHttpRequest', ['xml', 'http', 'request']],
    ['v2API', ['v2', 'api']],
    ['ABc', ['ab', 'c']],
    ['A1B2', ['a1', 'b2']],
    ['123abc', ['123', 'abc']],
    ['snake_case_name', ['snake', 'case', 'name']],
    ['  spaced   out ', ['spaced', 'out']],
    ['', []],
    ['--', []],
  ])('splits %j into %j', (input, words) => {
    expect(splitWords(input)).toEqual(words);
  });
});

describe('kebab', () => {
  it.each([
    ['getProcessInstances', 'get-process-instances'],
    ['Historic Process Instance', 'historic-process-instance'],
    ['noRetriesLeft', 'no-retries-left'],
    ['processInstanceIds', 'process-instance-ids'],
    ['getRestAPIVersion', 'get-rest-api-version'],
    ['already-kebab', 'already-kebab'],
    ['', ''],
  ])('kebab(%j) is %j', (input, output) => {
    expect(kebab(input)).toBe(output);
  });

  const identifiers = fc.oneof(
    fc.string(),
    fc.stringMatching(/^[a-z][A-Za-z0-9]{0,20}$/),
    fc
      .array(
        fc.constantFrom('get', 'Process', 'API', 'XML', 'v2', '20', ' ', '-', '_', 'Id', 's'),
        {
          maxLength: 8,
        },
      )
      .map((parts) => parts.join('')),
  );

  it('is idempotent', () => {
    fc.assert(
      fc.property(identifiers, (text) => {
        expect(kebab(kebab(text))).toBe(kebab(text));
      }),
    );
  });

  it('produces lower-case words joined by single dashes', () => {
    fc.assert(
      fc.property(identifiers, (text) => {
        expect(kebab(text)).toMatch(/^([a-z0-9]+(-[a-z0-9]+)*)?$/);
      }),
    );
  });

  it('keeps the words of its input', () => {
    fc.assert(
      fc.property(identifiers, (text) => {
        expect(splitWords(kebab(text))).toEqual(splitWords(text));
      }),
    );
  });
});

describe('pluralize', () => {
  it.each([
    ['instance', 'instances'],
    ['process', 'processes'],
    ['box', 'boxes'],
    ['buzz', 'buzzes'],
    ['batch', 'batches'],
    ['push', 'pushes'],
    ['policy', 'policies'],
    ['day', 'days'],
    ['key', 'keys'],
    ['guy', 'guys'],
    ['toy', 'toys'],
    ['job', 'jobs'],
    ['byte', 'bytes'],
    ['yearly', 'yearlies'],
  ])('pluralize(%j) is %j', (word, plural) => {
    expect(pluralize(word)).toBe(plural);
  });
});

describe('shortCommandName', () => {
  it.each([
    ['getProcessInstances', 'Process Instance', 'list'],
    ['getProcessInstancesCount', 'Process Instance', 'count'],
    ['getProcessInstance', 'Process Instance', 'get'],
    ['getProcessInstanceVariables', 'Process Instance', 'get-variables'],
    ['deleteProcessInstance', 'Process Instance', 'delete'],
    ['queryProcessInstances', 'Process Instance', 'query'],
    ['queryProcessInstancesCount', 'Process Instance', 'query-count'],
    ['getHistoricProcessInstances', 'Historic Process Instance', 'list'],
    ['getBatches', 'Batch', 'list'],
    ['getBatchesCount', 'Batch', 'count'],
    ['getBatch', 'Batch', 'get'],
    ['getTasks', 'Task', 'list'],
    ['getTasksStatistics', 'Task', 'get-statistics'],
    ['createDeployment', 'Deployment', 'create'],
    ['deliverMessage', 'Message', 'deliver'],
    ['throwSignal', 'Signal', 'throw'],
    ['getDecisionDefinitionDmnXmlByKey', 'Decision Definition', 'get-dmn-xml-by-key'],
  ])('shortens %s (tag %j) to %j', (operationId, tag, name) => {
    expect(shortCommandName(operationId, tag)).toBe(name);
  });

  it.each([
    ['getRestAPIVersion', 'Version'],
    ['getProcessInstances', 'Task'],
    ['processInstance', 'Process Instance'],
    ['get', 'Process Instance'],
    ['getTasks', ''],
    ['getInstanceProcess', 'Process Instance'],
  ])('does not apply to %s with tag %j', (operationId, tag) => {
    expect(shortCommandName(operationId, tag)).toBeUndefined();
  });

  it('only renames get to list or count for plural nouns', () => {
    expect(shortCommandName('getTaskCount', 'Task')).toBe('get-count');
    expect(shortCommandName('getTasksCount', 'Task')).toBe('count');
    expect(shortCommandName('getTasksCountFoo', 'Task')).toBe('get-count-foo');
    expect(shortCommandName('postTasks', 'Task')).toBe('post');
  });
});

describe('flagName', () => {
  it.each([
    ['businessKey', 'business-key'],
    ['processInstanceIds', 'process-instance-ids'],
    ['noRetriesLeft', 'no-retries-left'],
    ['maxResults', 'max-results'],
    ['tenantIdIn', 'tenant-id-in'],
    ['withoutTenantId', 'without-tenant-id'],
  ])('flagName(%j) is %j', (param, flag) => {
    expect(flagName(param)).toBe(flag);
  });
});
