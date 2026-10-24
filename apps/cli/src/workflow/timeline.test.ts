import { describe, expect, it } from 'vitest';
import { timelineOf } from './timeline.js';

const T = (second: number) => `2026-01-01T00:00:${String(second).padStart(2, '0')}.000+0000`;

describe('timelineOf', () => {
  it('copies the fields of the historic activity instances, empty strings for missing ones', () => {
    expect(
      timelineOf(
        [
          {
            activityId: 'task',
            activityName: 'Task',
            activityType: 'userTask',
            startTime: T(1),
            endTime: T(2),
            durationInMillis: 1000,
            canceled: true,
            assignee: 'demo',
            calledProcessInstanceId: 'child',
          },
          { canceled: false },
        ],
        [],
      ),
    ).toEqual([
      {
        activityId: 'task',
        activityName: 'Task',
        activityType: 'userTask',
        startTime: T(1),
        endTime: T(2),
        durationMs: 1000,
        canceled: true,
        assignee: 'demo',
        calledProcessInstanceId: 'child',
      },
      { activityId: '', activityType: '', startTime: '' },
    ]);
  });

  it('attaches incidents to the last entry of their activity that started before them', () => {
    const entries = timelineOf(
      [
        { activityId: 'book', activityType: 'serviceTask', startTime: T(1) },
        { activityId: 'other', activityType: 'serviceTask', startTime: T(2) },
        { activityId: 'book', activityType: 'serviceTask', startTime: T(3) },
        { activityId: 'book', activityType: 'serviceTask', startTime: T(9) },
      ],
      [
        { id: 'b', activityId: 'book', incidentType: 'failedJob', createTime: T(3), open: true },
        { id: 'a', activityId: 'book', incidentType: 'x', createTime: T(3), deleted: true },
        { id: 'c', activityId: 'book', incidentType: 'y', createTime: T(2), incidentMessage: 'm' },
        { id: 'd', activityId: 'gone', incidentType: 'z', createTime: T(4) },
      ],
    );
    expect(entries.map((entry) => entry.incidents)).toEqual([
      [{ type: 'y', message: 'm', state: 'resolved' }],
      undefined,
      [
        { type: 'x', state: 'deleted' },
        { type: 'failedJob', state: 'open' },
      ],
      undefined,
    ]);
  });

  it('attaches an incident created before its activity started to the first entry of the activity', () => {
    const entries = timelineOf(
      [
        { activityId: 'start', startTime: T(0) },
        { activityId: 'book', startTime: T(5) },
        { activityId: 'book', startTime: T(8) },
      ],
      [
        { id: 'i', activityId: 'book', incidentType: 'failedJob', createTime: T(1) },
        { id: 'j', activityId: 'book' },
        { id: 'k', activityId: 'start', createTime: T(0) },
      ],
    );
    expect(entries.map((entry) => entry.incidents?.length ?? 0)).toEqual([1, 1, 1]);
    expect(entries[1]?.incidents).toEqual([{ type: 'failedJob', state: 'resolved' }]);
    expect(entries[2]?.incidents).toEqual([{ type: '', state: 'resolved' }]);
  });

  it('treats entries without start time as started at the beginning', () => {
    const entries = timelineOf(
      [{ activityId: 'a' }, { activityId: 'a', startTime: T(30) }],
      [{ id: 'i', activityId: 'a', createTime: T(10), incidentType: 't' }],
    );
    expect(entries.map((entry) => entry.incidents?.length ?? 0)).toEqual([1, 0]);
  });
});

describe('timelineOf ties', () => {
  it('attaches equally old incidents in id order whatever the input order', () => {
    for (const ids of [
      ['a', 'b'],
      ['b', 'a'],
    ]) {
      const [entry] = timelineOf(
        [{ activityId: 'x', startTime: T(0) }],
        ids.map((id) => ({ id, activityId: 'x', incidentType: id, createTime: T(1) })),
      );
      expect(entry?.incidents?.map((incident) => incident.type)).toEqual(['a', 'b']);
    }
  });
});
