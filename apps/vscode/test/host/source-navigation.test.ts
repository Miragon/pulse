import { beforeEach, describe, expect, test, vi } from 'vitest';
import { SourceNavigation } from '../../src/host/panels/source-navigation.js';

const vscode = vi.hoisted(() => {
  return {
    contributed: [] as string[],
    executed: [] as unknown[][],
    shown: [] as unknown[][],
    failFocus: false,
  };
});

vi.mock('vscode', () => ({
  Uri: { parse: (uri: string) => ({ parsed: uri }) },
  ViewColumn: { Active: -1 },
  extensions: {
    get all() {
      return [
        { packageJSON: {} },
        {
          packageJSON: {
            contributes: { commands: vscode.contributed.map((command) => ({ command })) },
          },
        },
      ];
    },
  },
  Position: class {
    constructor(
      readonly line: number,
      readonly character: number,
    ) {}
  },
  Range: class {
    constructor(
      readonly start: unknown,
      readonly end: unknown,
    ) {}
  },
  commands: {
    executeCommand: (...args: unknown[]) => {
      vscode.executed.push(args);
      return vscode.failFocus && args[0] === 'bpmn-modeler.focusLintElement'
        ? Promise.reject(new Error('modeler not ready'))
        : Promise.resolve();
    },
  },
  window: {
    showTextDocument: (...args: unknown[]) => {
      vscode.shown.push(args);
      return Promise.resolve();
    },
  },
}));

const MODEL = { uri: 'file:///shop/order.bpmn', line: 12 };

describe('the source navigation', () => {
  beforeEach(() => {
    vscode.contributed = [];
    vscode.executed = [];
    vscode.shown = [];
    vscode.failFocus = false;
  });

  test('reveals the element in the BPMN modeler over the panel, even before it ran', async () => {
    vscode.contributed = ['bpmn-modeler.focusLintElement'];

    await new SourceNavigation().openModel(MODEL, 'Activity_ChargePayment');

    expect(vscode.executed).toEqual([
      ['vscode.openWith', { parsed: MODEL.uri }, 'bpmn-modeler.bpmn', -1],
      ['bpmn-modeler.focusLintElement', MODEL.uri, 'Activity_ChargePayment'],
    ]);
    expect(vscode.shown).toEqual([]);
  });

  test('opens the file as text at the element without the modeler', async () => {
    await new SourceNavigation().openModel(MODEL, 'Activity_ChargePayment');

    expect(vscode.shown).toEqual([
      [
        { parsed: MODEL.uri },
        {
          preview: true,
          viewColumn: -1,
          selection: { start: { line: 11, character: 0 }, end: { line: 11, character: 0 } },
        },
      ],
    ]);
  });

  test('falls back to text when the modeler refuses', async () => {
    vscode.contributed = ['bpmn-modeler.focusLintElement'];
    vscode.failFocus = true;

    await new SourceNavigation().openModel(MODEL, 'Activity_ChargePayment');

    expect(vscode.shown).toHaveLength(1);
  });

  test('opens the file in its default editor without an element', async () => {
    await new SourceNavigation().openModel({ uri: MODEL.uri, line: 1 });

    expect(vscode.executed).toEqual([['vscode.open', { parsed: MODEL.uri }, -1]]);
  });

  test('opens code at its first line', async () => {
    await new SourceNavigation().openSource({ uri: 'file:///shop/Worker.java', line: 1 });

    expect(vscode.shown[0]?.[1]).toMatchObject({ selection: { start: { line: 0 } } });
  });
});
