import { describe, expect, test } from 'vitest';
import {
  BpmnProcessId,
  BulkOperationId,
  DefinitionId,
  IncidentId,
  InstanceId,
  RuntimeError,
  FailingRuntime,
  type ProcessRuntime,
} from '../../src/contract/index.js';

type Call = (runtime: ProcessRuntime) => Promise<unknown>;

const EVERY_METHOD: Readonly<Record<keyof ProcessRuntime, Call>> = {
  describeEngine: (runtime) => runtime.describeEngine(),
  listDefinitions: (runtime) => runtime.listDefinitions(),
  listVersions: (runtime) => runtime.listVersions(BpmnProcessId('order')),
  getDiagramXml: (runtime) => runtime.getDiagramXml(DefinitionId('order:1')),
  getElementStatistics: (runtime) => runtime.getElementStatistics(DefinitionId('order:1')),
  getCalledProcesses: (runtime) => runtime.getCalledProcesses(DefinitionId('order:1')),
  searchInstances: (runtime) => runtime.searchInstances({}, { limit: 1 }),
  countInstances: (runtime) => runtime.countInstances({}),
  getInstanceDetail: (runtime) => runtime.getInstanceDetail(InstanceId('instance')),
  searchIncidents: (runtime) => runtime.searchIncidents({}, { limit: 1 }),
  getIncidentDetails: (runtime) => runtime.getIncidentDetails(IncidentId('incident')),
  getBulkOperation: (runtime) => runtime.getBulkOperation(BulkOperationId('bulk')),
  getBulkFailures: (runtime) => runtime.getBulkFailures(BulkOperationId('bulk')),
  proposeMigration: (runtime) =>
    runtime.proposeMigration(DefinitionId('order:1'), DefinitionId('order:2')),
  checkMigration: (runtime) =>
    runtime.checkMigration({
      sourceDefinitionId: DefinitionId('order:1'),
      targetDefinitionId: DefinitionId('order:2'),
      mappings: [],
    }),
};

describe('a failing runtime', () => {
  test.each(Object.entries(EVERY_METHOD))(
    'rejects %s with the given error',
    async (_name, call) => {
      const error = new RuntimeError('misconfigured', 'OAuth2 targets are not supported yet');

      await expect(call(new FailingRuntime(error))).rejects.toBe(error);
    },
  );
});
