import test from 'node:test';
import assert from 'node:assert/strict';
import { handlePayPalWebhook } from '../api/paypal/webhook.js';

const ORDER_ID = '5O190127TN364715T';
const EVENT_ID = 'WH-TEST-001';

function eventRequest(event) {
  return new Request('http://localhost/api/paypal/webhook', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(event) });
}

function completedEvent() {
  return { id: EVENT_ID, event_type: 'PAYMENT.CAPTURE.COMPLETED', resource: { id: 'CAPTURE01', status: 'COMPLETED', amount: { value: '2.99', currency_code: 'USD' }, supplementary_data: { related_ids: { order_id: ORDER_ID } } } };
}

test('invalid webhook signature is rejected before storage', async () => {
  let claimed = false;
  const response = await handlePayPalWebhook(eventRequest(completedEvent()), { verifyWebhook: async () => false, orderStore: { claimWebhook: async () => { claimed = true; } } });
  assert.equal(response.status, 401);
  assert.equal(claimed, false);
});

test('duplicate webhook event is acknowledged without duplicate credits', async () => {
  let completed = false;
  const response = await handlePayPalWebhook(eventRequest(completedEvent()), {
    verifyWebhook: async () => true,
    orderStore: { claimWebhook: async () => false, completeCapture: async () => { completed = true; } }
  });
  assert.equal((await response.json()).idempotent, true);
  assert.equal(completed, false);
});

test('completed webhook can recover a missed frontend capture', async () => {
  let grantCount = 0;
  const order = { id: '44444444-4444-4444-8444-444444444444', user_id: '11111111-1111-4111-8111-111111111111', expected_amount: '2.99', expected_currency: 'USD' };
  const store = {
    claimWebhook: async () => true,
    findByPayPalId: async () => order,
    completeCapture: async () => { grantCount += 1; },
    markWebhookProcessed: async () => {}
  };
  const response = await handlePayPalWebhook(eventRequest(completedEvent()), { verifyWebhook: async () => true, orderStore: store });
  assert.equal(response.status, 200);
  assert.equal(grantCount, 1);
});

test('refund and reversal call the safe adjustment transaction', async () => {
  for (const [eventType, status] of [['PAYMENT.CAPTURE.REFUNDED', 'refunded'], ['PAYMENT.CAPTURE.REVERSED', 'reversed']]) {
    let adjusted;
    const event = { id: `${EVENT_ID}-${status}`, event_type: eventType, resource: { supplementary_data: { related_ids: { order_id: ORDER_ID } } } };
    const store = { claimWebhook: async () => true, processRefund: async (...args) => { adjusted = args; }, markWebhookProcessed: async () => {} };
    const response = await handlePayPalWebhook(eventRequest(event), { verifyWebhook: async () => true, orderStore: store });
    assert.equal(response.status, 200);
    assert.equal(adjusted[2], status);
  }
});

test('dispute places the account on hold without deleting stories', async () => {
  let held = false;
  const event = { id: `${EVENT_ID}-DISPUTE`, event_type: 'CUSTOMER.DISPUTE.CREATED', resource: { supplementary_data: { related_ids: { order_id: ORDER_ID } } } };
  const store = { claimWebhook: async () => true, placeAccountHold: async () => { held = true; }, markWebhookProcessed: async () => {} };
  await handlePayPalWebhook(eventRequest(event), { verifyWebhook: async () => true, orderStore: store });
  assert.equal(held, true);
});
