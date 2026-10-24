import type { ElementImplementation } from '../../src/contract/index.js';
import { describe, expect, test } from 'vitest';
import { WorkspaceCodeLocator } from '../../src/model/index.js';
import { MemoryFiles } from './support/memory-files.js';
import {
  AUDIT_SERVICE,
  CARRIER_WORKER,
  CHARGE_PAYMENT_TEST,
  CHARGE_PAYMENT_WORKER,
  TOPICS,
} from './support/sources.js';

const WORKER = 'file:///workspace/src/main/java/io/miragon/shop/payment/ChargePaymentWorker.java';
const WORKER_TEST =
  'file:///workspace/src/test/java/io/miragon/shop/payment/ChargePaymentWorkerTest.java';
const AUDIT = 'file:///workspace/src/main/java/io/miragon/shop/audit/AuditService.java';
const NOTIFY = 'file:///workspace/src/main/kotlin/io/miragon/shop/notify/NotifyCustomerDelegate.kt';
const RISK = 'file:///workspace/src/main/java/io/miragon/shop/risk/RiskRating.java';
const CARRIER = 'file:///workspace/workers/src/carrier-worker.ts';
const CONSTANTS = 'file:///workspace/src/main/java/io/miragon/shop/Topics.java';
const GENERATED = 'file:///workspace/build-src/io/miragon/shop/Generated.java';

const files = new MemoryFiles({
  [WORKER_TEST]: CHARGE_PAYMENT_TEST,
  [WORKER]: CHARGE_PAYMENT_WORKER,
  [AUDIT]: AUDIT_SERVICE,
  [NOTIFY]: [
    'package io.miragon.shop.notify',
    '',
    '// class NotifyCustomerDelegate replaces the mailer',
    'class NotifyCustomerDelegate : JavaDelegate',
  ].join('\n'),
  [RISK]: ['package io.miragon.shop.risk;', '', 'public class RiskRating {', '}'].join('\n'),
  [GENERATED]: 'package io.miragon.shop;',
  [CARRIER]: CARRIER_WORKER,
  [CONSTANTS]: TOPICS,
});

function locate(implementation: ElementImplementation) {
  return new WorkspaceCodeLocator(files).locate(implementation);
}

describe('the workspace code locator', () => {
  test('finds the worker that subscribes to a task type, not its test or a comment', async () => {
    expect(await locate({ kind: 'workerTask', taskType: 'charge-payment' })).toEqual({
      uri: WORKER,
      line: 8,
    });
  });

  test('prefers the subscription over a constant that names the task type', async () => {
    expect((await locate({ kind: 'workerTask', taskType: 'charge-payment' }))?.uri).toBe(WORKER);
  });

  test('falls back to any literal of the task type without a subscription', async () => {
    expect(await locate({ kind: 'workerTask', taskType: 'ship-order' })).toEqual({
      uri: CONSTANTS,
      line: 5,
    });
  });

  test('finds a worker written in TypeScript', async () => {
    expect(await locate({ kind: 'workerTask', taskType: 'book-carrier' })).toEqual({
      uri: CARRIER,
      line: 3,
    });
  });

  test('finds a class by its qualified name, at its declaration', async () => {
    expect(
      await locate({ kind: 'class', className: 'io.miragon.shop.notify.NotifyCustomerDelegate' }),
    ).toEqual({ uri: NOTIFY, line: 4 });
  });

  test('finds the outer class of a nested class', async () => {
    expect(
      await locate({ kind: 'class', className: 'io.miragon.shop.risk.RiskRating$Rule' }),
    ).toEqual({ uri: RISK, line: 3 });
  });

  test('opens the top of a class file without a declaration in it', async () => {
    expect(await locate({ kind: 'class', className: 'io.miragon.shop.Generated' })).toEqual({
      uri: GENERATED,
      line: 1,
    });
  });

  test('finds the bean of an expression by its class name', async () => {
    expect(
      await locate({ kind: 'expression', expression: '${riskRating.rate(execution)}' }),
    ).toEqual({ uri: RISK, line: 3 });
  });

  test('finds a bean by the name its annotation gives it', async () => {
    expect(await locate({ kind: 'delegate', expression: '#{ auditLogger }' })).toEqual({
      uri: AUDIT,
      line: 3,
    });
  });

  test('finds nothing for an unknown task type, bean or class', async () => {
    const found = await Promise.all([
      locate({ kind: 'workerTask', taskType: 'send-invoice' }),
      locate({ kind: 'delegate', expression: '${invoiceSender}' }),
      locate({ kind: 'expression', expression: 'execution.getVariable("x")' }),
      locate({ kind: 'class', className: 'io.miragon.Missing' }),
    ]);
    expect(found).toEqual([undefined, undefined, undefined, undefined]);
  });

  test('takes task types literally', async () => {
    expect(await locate({ kind: 'workerTask', taskType: 'charge.payment' })).toBeUndefined();
  });
});
