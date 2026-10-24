import { describe, expect, it } from 'vitest';
import { findOperation, loadCatalog } from '../catalog/catalog.js';
import type { OperationSpec } from '../catalog/types.js';
import { commandRef } from './command-ref.js';

const catalog = loadCatalog();

function operation(group: string, name: string): OperationSpec {
  const found = findOperation(catalog, group, name);
  if (found === undefined) throw new Error(`no operation ${group} ${name}`);
  return found;
}

describe('commandRef', () => {
  it('names the command and the list command of its group', () => {
    expect(commandRef(operation('process-instance', 'get-variable'), catalog)).toEqual({
      command: 'process-instance get-variable',
      listCommand: 'process-instance list',
    });
  });

  it('uses the command name of presets', () => {
    expect(commandRef(operation('process-instance', 'suspend'), catalog)).toEqual({
      command: 'process-instance suspend',
      listCommand: 'process-instance list',
    });
  });

  it('omits the list command when the group has none', () => {
    expect(commandRef(operation('message', 'correlate'), catalog)).toEqual({
      command: 'message correlate',
    });
  });
});
