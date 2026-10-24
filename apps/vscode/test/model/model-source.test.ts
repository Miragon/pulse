import { BpmnProcessId, ElementId, type ModelFile } from '../../src/contract/index.js';
import { describe, expect, test } from 'vitest';
import { BpmnModelSource } from '../../src/model/index.js';
import paymentXml from './fixtures/payment.bpmn';
import shippingXml from './fixtures/shipping.bpmn';
import { MemoryFiles } from './support/memory-files.js';

const PAYMENT_URI = 'file:///workspace/src/main/resources/bpmn/payment.bpmn';
const SHIPPING_URI = 'file:///workspace/src/main/resources/bpmn/shipping.bpmn';

function source(files: Readonly<Record<string, string>> = {}): BpmnModelSource {
  return new BpmnModelSource(
    new MemoryFiles({ [PAYMENT_URI]: paymentXml, [SHIPPING_URI]: shippingXml, ...files }),
  );
}

async function modelOf(bpmnProcessId: string): Promise<ModelFile> {
  const model = await source().modelOf(BpmnProcessId(bpmnProcessId));
  if (model === undefined) {
    throw new Error(`no model for ${bpmnProcessId}`);
  }
  return model;
}

async function configurationOf(bpmnProcessId: string, elementId: string) {
  const element = await source().elementIn(await modelOf(bpmnProcessId), ElementId(elementId));
  return element?.configuration;
}

describe('the BPMN model source', () => {
  test('finds the local file that declares a process', async () => {
    expect(await modelOf('shipping')).toEqual({
      uri: SHIPPING_URI,
      fileName: 'shipping.bpmn',
      bpmnProcessId: 'shipping',
      xml: shippingXml,
    });
  });

  test('finds nothing for a process no local file declares', async () => {
    expect(await source().modelOf(BpmnProcessId('billing'))).toBeUndefined();
  });

  test('skips files that only mention the id or do not parse', async () => {
    const mentions = `<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"><bpmn:collaboration id="payment" /></bpmn:definitions>`;
    const model = await source({
      'file:///workspace/a/broken.bpmn': '<bpmn:process id="payment"',
      'file:///workspace/a/mentions.bpmn': mentions,
    }).modelOf(BpmnProcessId('payment'));
    expect(model?.uri).toBe(PAYMENT_URI);
  });

  test('locates an element at its line in the file', async () => {
    const model = await modelOf('payment');
    const element = await source().elementIn(model, ElementId('Activity_ChargePayment'));
    const line = paymentXml
      .split('\n')
      .findIndex((text) => text.includes('"Activity_ChargePayment" name'));
    expect(element?.location).toEqual({ uri: PAYMENT_URI, line: line + 1 });
  });

  test('knows no element the file does not have', async () => {
    const model = await modelOf('payment');
    expect(await source().elementIn(model, ElementId('Activity_Missing'))).toBeUndefined();
  });

  test('reads a worker task with its mappings and the errors it may throw', async () => {
    expect(await configurationOf('payment', 'Activity_ChargePayment')).toEqual({
      implementation: { kind: 'workerTask', taskType: 'charge-payment' },
      inputs: [{ target: 'amount', source: '${order.total}' }],
      outputs: [{ target: 'paymentId', source: '${receipt.id}' }],
      errors: [{ code: 'CARD_EXPIRED', name: 'CardExpired' }],
    });
  });

  test('reads a class, a delegate and an expression', async () => {
    const implementations = await Promise.all(
      ['Activity_NotifyCustomer', 'Activity_WriteAuditLog', 'Activity_RateRisk'].map(
        async (elementId) => (await configurationOf('payment', elementId))?.implementation,
      ),
    );
    expect(implementations).toEqual([
      { kind: 'class', className: 'io.miragon.shop.notify.NotifyCustomerDelegate' },
      { kind: 'delegate', expression: '${auditLogger}' },
      { kind: 'expression', expression: '${riskRating.rate(execution)}' },
    ]);
  });

  test('reads a scripted input by its name and an error boundary without error as none', async () => {
    const [audit, notify] = await Promise.all([
      configurationOf('payment', 'Activity_WriteAuditLog'),
      configurationOf('payment', 'Activity_NotifyCustomer'),
    ]);
    expect(audit?.inputs).toEqual([{ target: 'entry' }]);
    expect(notify?.errors).toEqual([]);
  });

  test('reads a job worker with its input and output mapping', async () => {
    expect(await configurationOf('shipping', 'Activity_BookCarrier')).toEqual({
      implementation: { kind: 'workerTask', taskType: 'book-carrier' },
      inputs: [{ target: 'address', source: '=order.address' }],
      outputs: [{ target: 'bookingId', source: '=booking.id' }],
      errors: [],
    });
  });

  test('reads an element without implementation as plain', async () => {
    expect(await configurationOf('payment', 'Event_PaymentRequested')).toEqual({
      inputs: [],
      outputs: [],
      errors: [],
    });
  });
});
