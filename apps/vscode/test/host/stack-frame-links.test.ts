import type { ElementImplementation } from '../../src/contract/index.js';
import { describe, expect, test, vi } from 'vitest';
import { StackFrameLinks } from '../../src/host/panels/stack-frame-links.js';

vi.mock('vscode', () => {
  class Uri {
    constructor(
      readonly path: string,
      readonly fragment = '',
    ) {}
    static parse(path: string) {
      return new Uri(path);
    }
    with({ fragment }: { fragment: string }) {
      return new Uri(this.path, fragment);
    }
  }
  return {
    Uri,
    Range: class {
      constructor(
        readonly line: number,
        readonly start: number,
        readonly endLine: number,
        readonly end: number,
      ) {}
    },
    DocumentLink: class {
      tooltip = '';
      constructor(
        readonly range: unknown,
        readonly target: unknown,
      ) {}
    },
    workspace: {
      findFiles: () => Promise.resolve([Uri.parse('file:///shop/ChargePaymentWorker.java')]),
      asRelativePath: (uri: { path: string }) => uri.path.replace('file:///shop/', ''),
    },
  };
});

const TRACE = [
  'io.miragon.shop.payment.PaymentFailedException: Payment failed',
  '\tat io.miragon.shop.payment.ChargePaymentWorker.charge(ChargePaymentWorker.java:34)',
  'Caused by: io.miragon.shop.payment.Missing: gone',
].join('\n');

function documentOf(text: string, scheme = 'pulse-incident') {
  return { uri: { scheme }, getText: () => text } as never;
}

const code = {
  locate: vi.fn((implementation: ElementImplementation) =>
    Promise.resolve(
      implementation.kind === 'class' && !implementation.className.endsWith('Missing')
        ? { uri: `file:///shop/${implementation.className.split('.').at(-1)}.java`, line: 9 }
        : undefined,
    ),
  ),
};

describe('the links of a stack trace document', () => {
  test('lead from a frame to its line and from a class to its declaration', async () => {
    const links = await new StackFrameLinks(code).provideDocumentLinks(documentOf(TRACE));

    expect(
      links.map((link) => ({
        range: link.range,
        target: link.target,
        tooltip: link.tooltip,
      })),
    ).toEqual([
      {
        range: { line: 1, start: 55, endLine: 1, end: 82 },
        target: { path: 'file:///shop/ChargePaymentWorker.java', fragment: 'L34' },
        tooltip: 'Open ChargePaymentWorker.java at line 34',
      },
      {
        range: { line: 0, start: 0, endLine: 0, end: 46 },
        target: { path: 'file:///shop/PaymentFailedException.java', fragment: 'L9' },
        tooltip: 'Open the class io.miragon.shop.payment.PaymentFailedException',
      },
      {
        range: { line: 1, start: 4, endLine: 1, end: 47 },
        target: { path: 'file:///shop/ChargePaymentWorker.java', fragment: 'L9' },
        tooltip: 'Open the class io.miragon.shop.payment.ChargePaymentWorker',
      },
    ]);
  });

  test('look a class up once and survive a failing lookup', async () => {
    const failing = { locate: vi.fn(() => Promise.reject(new Error('disk is gone'))) };
    const links = new StackFrameLinks(failing);

    await links.provideDocumentLinks(documentOf(`${TRACE}\n${TRACE}`));
    const again = await links.provideDocumentLinks(documentOf(TRACE));

    expect(failing.locate).toHaveBeenCalledTimes(3);
    expect(again).toHaveLength(1);
  });

  test('link nothing in other documents', async () => {
    expect(await new StackFrameLinks(code).provideDocumentLinks(documentOf(TRACE, 'file'))).toEqual(
      [],
    );
  });
});
