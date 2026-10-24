import { describe, expect, test } from 'vitest';
import {
  BpmnProcessId,
  ElementId,
  FailingRuntime,
  IncidentId,
  IsoTimestamp,
  type Incident,
  type ProcessRuntime,
} from '../../src/contract/index.js';
import {
  CASE,
  ConformanceKit,
  WORLD_ELEMENT,
  type CaseName,
  type ConformanceHarness,
} from '../../src/contract/conformance/index.js';
import { FakeEngine, FakeWorld, PatchedRuntime } from '../../src/contract/fake/index.js';

type Sabotage = (runtime: ProcessRuntime, harness: ConformanceHarness) => Partial<ProcessRuntime>;

function conformingHarness(): ConformanceHarness {
  const { state, world } = FakeWorld.seed();
  return {
    runtime: new FakeEngine(state),
    unreachableRuntime: FailingRuntime.unreachable('http://unreachable.invalid'),
    world,
  };
}

function sabotaged(sabotage: Sabotage): ConformanceHarness {
  const harness = conformingHarness();
  const broken = new PatchedRuntime(harness.runtime, sabotage(harness.runtime, harness));
  return { ...harness, runtime: broken, unreachableRuntime: harness.unreachableRuntime };
}

async function failingCases(harness: ConformanceHarness): Promise<CaseName[]> {
  const failing: CaseName[] = [];
  for (const conformanceCase of ConformanceKit.runtimeLaws()) {
    await conformanceCase.run(harness).catch(() => failing.push(conformanceCase.name as CaseName));
  }
  return failing.sort();
}

const SABOTAGES: readonly (readonly [string, Sabotage, readonly CaseName[]])[] = [
  [
    'statistics addressed by process instead of version',
    (runtime, harness) => ({
      getElementStatistics: (definitionId) =>
        runtime.getElementStatistics(
          definitionId === harness.world.definitionIds['order@1']
            ? harness.world.definitionIds['order@2']
            : definitionId,
        ),
    }),
    [CASE.statisticsPerVersion, CASE.statisticsDisjoint],
  ],
  [
    'incidents are counted as active too',
    (runtime) => ({
      getElementStatistics: async (definitionId) => {
        const statistics = await runtime.getElementStatistics(definitionId);
        return statistics.map((statistic) => ({
          ...statistic,
          active: statistic.active + statistic.incidents,
        }));
      },
    }),
    [CASE.statisticsDisjoint],
  ],
  [
    'every incident reports the latest version of its process',
    (runtime) => {
      const latestOf = async (incident: Incident): Promise<Incident> => {
        const summaries = await runtime.listDefinitions();
        const latest = summaries.find(
          (summary) => summary.latest.bpmnProcessId === incident.definition.bpmnProcessId,
        );
        return latest === undefined ? incident : { ...incident, definition: latest.latest };
      };
      return {
        searchIncidents: async (filter, page) => {
          const result = await runtime.searchIncidents(filter, page);
          return { ...result, items: await Promise.all(result.items.map(latestOf)) };
        },
        getInstanceDetail: async (instanceId) => {
          const detail = await runtime.getInstanceDetail(instanceId);
          return (
            detail && { ...detail, incidents: await Promise.all(detail.incidents.map(latestOf)) }
          );
        },
      };
    },
    [CASE.incidentsNameTheirVersion],
  ],
  [
    'propagated incidents of the parent leak',
    (runtime, harness) => {
      const parentId = harness.world.instanceIds['DSP-3001'];
      const propagated = {
        id: IncidentId('propagated'),
        instanceId: parentId,
        definition: {
          id: harness.world.definitionIds['dispatch@1'],
          bpmnProcessId: BpmnProcessId('pulse-dispatch'),
          version: 1,
        },
        elementId: ElementId('Activity_PrintShippingLabel'),
        type: 'failedTask',
        message: 'propagated',
        createdAt: IsoTimestamp('2026-10-21T08:00:03Z'),
      };
      return {
        searchIncidents: async (filter, page) => {
          const result = await runtime.searchIncidents(filter, page);
          const unfiltered = Object.keys(filter).length === 0;
          return unfiltered ? { ...result, items: [...result.items, propagated] } : result;
        },
        getInstanceDetail: async (instanceId) => {
          const detail = await runtime.getInstanceDetail(instanceId);
          return detail && instanceId === parentId
            ? { ...detail, incidents: [...detail.incidents, propagated] }
            : detail;
        },
      };
    },
    [CASE.incidentsRootOnly, CASE.detailCalledInstance],
  ],
  [
    'a call activity names its process without the version it starts',
    (runtime) => ({
      getCalledProcesses: async (definitionId) => {
        const calls = await runtime.getCalledProcesses(definitionId);
        return calls.map(({ elementId, bpmnProcessId }) => ({ elementId, bpmnProcessId }));
      },
    }),
    [CASE.callsResolveTheCalledVersion],
  ],
  [
    'the page cursor is ignored',
    (runtime) => ({
      searchInstances: (filter, page) => runtime.searchInstances(filter, { limit: page.limit }),
    }),
    [CASE.instancesPaging],
  ],
  [
    'timestamps keep the engine offset',
    (runtime) => ({
      searchInstances: async (filter, page) => {
        const result = await runtime.searchInstances(filter, page);
        const local = result.items.map((item) => ({
          ...item,
          startedAt: (item.startedAt?.replace('Z', '+0000') ?? item.startedAt) as IsoTimestamp,
        }));
        return { ...result, items: local };
      },
    }),
    [CASE.instancesUtcTimestamps],
  ],
  [
    'counts ignore the element and the business key',
    (runtime) => ({
      countInstances: (filter) =>
        runtime.countInstances({
          ...(filter.definitionId === undefined ? {} : { definitionId: filter.definitionId }),
          ...(filter.bpmnProcessId === undefined ? {} : { bpmnProcessId: filter.bpmnProcessId }),
          ...(filter.lifecycle === undefined ? {} : { lifecycle: filter.lifecycle }),
          ...(filter.withIncident === undefined ? {} : { withIncident: filter.withIncident }),
        }),
    }),
    [CASE.instancesCounted, CASE.instancesByIds],
  ],
  [
    'the search ignores the instance ids',
    (runtime) => ({
      searchInstances: (filter, page) =>
        runtime.searchInstances(
          Object.fromEntries(Object.entries(filter).filter(([key]) => key !== 'instanceIds')),
          page,
        ),
    }),
    [CASE.instancesByIds],
  ],
  [
    'counts of instances without an incident include those with one',
    (runtime) => ({
      countInstances: async (filter) =>
        filter.withIncident === false
          ? (await runtime.countInstances({ ...filter, withIncident: false })) +
            (await runtime.countInstances({ ...filter, withIncident: true }))
          : runtime.countInstances(filter),
    }),
    [CASE.instancesCounted],
  ],
  [
    'full incident details come back truncated',
    (runtime) => ({
      getIncidentDetails: async (incidentId) => {
        const details = await runtime.getIncidentDetails(incidentId);
        return details && { ...details, truncated: true };
      },
    }),
    [CASE.incidentDetailsComplete],
  ],
  [
    'an unknown instance throws instead of being undefined',
    (runtime, harness) => ({
      getInstanceDetail: (instanceId) =>
        instanceId === harness.world.unknown.instanceId
          ? Promise.reject(new Error('not found'))
          : runtime.getInstanceDetail(instanceId),
    }),
    [CASE.detailUnknown],
  ],
  [
    'definitions are listed once per version',
    (runtime) => ({
      listDefinitions: async () => {
        const summaries = await runtime.listDefinitions();
        const versions = await runtime.listVersions(BpmnProcessId('pulse-order'));
        const perVersion = versions.map((version) => ({ ...version, latest: version.definition }));
        return [...summaries, ...perVersion];
      },
    }),
    [CASE.definitionsLatestVersion, CASE.definitionsCounts],
  ],
  [
    'variables come without their kind',
    (runtime) => ({
      getInstanceDetail: async (instanceId) => {
        const detail = await runtime.getInstanceDetail(instanceId);
        return (
          detail && {
            ...detail,
            variables: detail.variables.map((variable) => {
              const withoutKind = { ...variable };
              delete withoutKind.kind;
              return withoutKind;
            }),
          }
        );
      },
    }),
    [CASE.detailVariableKinds],
  ],
  [
    'the path forgets that an element ended',
    (runtime) => ({
      getInstanceDetail: async (instanceId) => {
        const detail = await runtime.getInstanceDetail(instanceId);
        return (
          detail && {
            ...detail,
            path: detail.path.map(({ elementId, startedAt, canceled }) => ({
              elementId,
              startedAt,
              canceled,
            })),
          }
        );
      },
    }),
    [CASE.detailPath],
  ],
  [
    'the path also lists the elements of called instances',
    (runtime, harness) => ({
      getInstanceDetail: async (instanceId) => {
        const detail = await runtime.getInstanceDetail(instanceId);
        const other = await runtime.getInstanceDetail(harness.world.instanceIds['ORD-1002']);
        return detail && { ...detail, path: [...detail.path, ...(other?.path ?? [])] };
      },
    }),
    [CASE.detailPath],
  ],
  [
    'every variable is reported at instance scope',
    (runtime) => ({
      getInstanceDetail: async (instanceId) => {
        const detail = await runtime.getInstanceDetail(instanceId);
        return (
          detail && {
            ...detail,
            variables: detail.variables.map((variable) => ({
              ...variable,
              scope: { kind: 'instance' as const },
            })),
          }
        );
      },
    }),
    [CASE.detailElementScope],
  ],
  [
    'the element filter misses tokens that wait before an asynchronous task',
    (runtime) => ({
      searchInstances: async (filter, page) =>
        filter.activeElementId === WORLD_ELEMENT.chargePayment
          ? { items: [] }
          : runtime.searchInstances(filter, page),
    }),
    [CASE.instancesByActiveElement],
  ],
  [
    'the migration check finds nothing',
    () => ({ checkMigration: () => Promise.resolve({ problems: [] }) }),
    [CASE.migrationCheck],
  ],
  [
    'a migration problem does not name its mapping',
    (runtime) => ({
      checkMigration: async (plan) => {
        const check = await runtime.checkMigration(plan);
        return { problems: check.problems.map(({ message }) => ({ message })) };
      },
    }),
    [CASE.migrationCheck],
  ],
  [
    'the migration proposal maps only user tasks',
    (runtime) => ({
      proposeMigration: async (source, target) => {
        const plan = await runtime.proposeMigration(source, target);
        return {
          ...plan,
          mappings: plan.mappings.filter(
            (mapping) => mapping.sourceElementId !== WORLD_ELEMENT.chargePayment,
          ),
        };
      },
    }),
    [CASE.migrationProposal],
  ],
];

describe('the conforming fake runtime', () => {
  new ConformanceKit(test).registerRuntimeLaws(() => Promise.resolve(conformingHarness()));

  test('fails no case', async () => {
    expect(await failingCases(conformingHarness())).toEqual([]);
  });
});

describe('the kit', () => {
  test('pins every case name', () => {
    expect(
      ConformanceKit.runtimeLaws()
        .map((conformanceCase) => conformanceCase.name)
        .sort(),
    ).toEqual(Object.values(CASE).sort());
  });

  test('reports raw errors of an unreachable engine', async () => {
    const harness = conformingHarness();
    const rawErrors = {
      ...harness,
      unreachableRuntime: new PatchedRuntime(harness.unreachableRuntime, {
        listDefinitions: () => Promise.reject(new Error('ECONNREFUSED')),
      }),
    };
    expect(await failingCases(rawErrors)).toEqual([CASE.unreachableEngine]);
  });

  test.each(SABOTAGES)('catches a runtime where %s', async (_flaw, sabotage, expected) => {
    expect(await failingCases(sabotaged(sabotage))).toEqual([...expected].sort());
  });
});
