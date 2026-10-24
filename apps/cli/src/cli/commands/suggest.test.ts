import { describe, expect, it } from 'vitest';
import { loadCatalog } from '../../catalog/catalog.js';
import { describeSuggestions, didYouMean, groupSuggestions } from './suggest.js';

const catalog = loadCatalog();

describe('groupSuggestions', () => {
  it('suggests close group names', () => {
    expect(groupSuggestions(catalog, 'tsk')).toEqual(['task']);
    expect(groupSuggestions(catalog, 'proces-instance')).toEqual(['process-instance']);
  });

  it('suggests groups with a word starting like the word when no name is close', () => {
    expect(groupSuggestions(catalog, 'Variable')).toEqual([
      'historic-variable-instance',
      'task-local-variable',
      'task-variable',
      'variable-instance',
    ]);
    expect(groupSuggestions(catalog, 'var')).toEqual(groupSuggestions(catalog, 'variable'));
    expect(groupSuggestions(catalog, 'historic')).toHaveLength(5);
    expect(groupSuggestions(catalog, 'nothing-like-it')).toEqual([]);
  });

  it('never suggests groups for short words or inner substrings', () => {
    // "ab" occurs in "variable", "ari" too, but no word starts with them
    expect(groupSuggestions(catalog, 'ab')).toEqual([]);
    expect(groupSuggestions(catalog, 'ari')).toEqual([]);
  });
});

describe('describeSuggestions', () => {
  it('suggests close commands, aliases and group names or operationIds', () => {
    expect(describeSuggestions(catalog, 'task', 'lsit')).toEqual(['task list']);
    expect(describeSuggestions(catalog, 'tsk', 'list')).toEqual(['task list']);
    expect(describeSuggestions(catalog, 'task', 'get-taks')).toEqual([
      'task get-tasks',
      'task get-task',
    ]);
    expect(describeSuggestions(catalog, 'startProcessInstanceByKy', undefined)).toEqual([
      'startProcessInstanceByKey',
    ]);
    expect(describeSuggestions(catalog, 'tsk', undefined)).toEqual(['task']);
    expect(describeSuggestions(catalog, 'fetchAndLok', undefined)).toEqual(['fetchAndLock']);
  });

  it('falls back to the search for the last word, within a known group', () => {
    expect(describeSuggestions(catalog, 'process-instance', 'variables')).toEqual([
      'process-instance delete-variable',
      'process-instance get-variable',
      'process-instance get-variable-binary',
      'process-instance get-variables',
      'process-instance modify-variables',
    ]);
    expect(describeSuggestions(catalog, 'no-group', 'fetchAndLock')).toEqual([
      'external-task fetch-and-lock',
    ]);
    expect(describeSuggestions(catalog, 'fetch-and', undefined)).toEqual([
      'external-task fetch-and-lock',
    ]);
    expect(describeSuggestions(catalog, 'zzzz', undefined)).toEqual([]);
  });

  it('does not search for words shorter than 3 characters', () => {
    // "al" occurs in "evaluate" and many more
    expect(describeSuggestions(catalog, 'al', undefined)).toEqual([]);
    expect(describeSuggestions(catalog, 'task', 'zz')).toEqual([]);
  });
});

describe('didYouMean', () => {
  it('names one or several suggestions, nothing without', () => {
    expect(didYouMean([])).toBe('');
    expect(didYouMean(['task'])).toBe('Did you mean task? ');
    expect(didYouMean(['task', 'job'])).toBe('Did you mean one of task, job? ');
  });
});
