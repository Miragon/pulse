import { describe, expect, it } from 'vitest';
import { argumentName } from './names.js';

describe('argumentName', () => {
  it.each([
    ['id', 'id'],
    ['varName', 'var-name'],
    ['metrics-name', 'metrics-name'],
    ['tenant-id', 'tenant-id'],
    ['processDefinitionKey', 'process-definition-key'],
    ['user2Id', 'user2-id'],
    ['resource1Id', 'resource1-id'],
  ])('%s → %s', (name, expected) => {
    expect(argumentName(name)).toBe(expected);
  });
});
