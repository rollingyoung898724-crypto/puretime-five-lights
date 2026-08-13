import test from 'node:test';
import assert from 'node:assert/strict';
import { handleCreateOrder } from '../api/paypal/create-order.js';
import { handleCaptureOrder } from '../api/paypal/capture-order.js';
import { auth, ORDER_REQUEST_ID, USER_ID } from './helpers.js';

const PAYPAL_ORDER_ID = '5O190127TN364715T';
const LOCAL_ORDER = {
  id: '44444444-4444-4444-8444-444444444444', user_id: USER_ID,
  paypal_order_id: PAYPAL_ORDER_ID, status: 'created', product_id: 'story_credits_10',
  expected_amount: '2.99', expected_currency: 'USD', credits: 10
};

function createRequest(body) {
  return new Request('http://localhost/api/paypal/create-order', { method: 'POST', headers: { authorization: 'Bearer test', 'content-type': 'application/json' }, body: JSON.stringify(body) });
}

function captureRequest(orderId = PAYPAL_ORDER_ID) {
  return new Request('http://localhost/api/paypal/capture-order', { method: 'POST', headers: { authorization: 'Bearer test', 'content-type': 'application/json' }, body: JSON.stringify({ orderId }) });
}

function completedPayPal(amount = '2.99', currency = 'USD', captureId = '3C679366HH908993F') {
  return { id: PAYPAL_ORDER_ID, status: 'COMPLETED', payer: { email_address: 'buyer@example.com' }, purchase_units: [{ payments: { captures: [{ id: captureId, status: 'COMPLETED', amount: { value: amount, currency_code: currency } }] } }] };
}

test('server product table controls the PayPal price', async () => {
  let seenProduct;
  const store = { findByRequest: async () => null, createPending: async input => ({ id: input.id }), attachPayPalOrder: async () => {} };
  const response = await handleCreateOrder(createRequest({ productId: 'story_credits_10', requestId: ORDER_REQUEST_ID }), {
    authenticate: auth(), orderStore: store,
    createPayPalOrder: async product => { seenProduct = product; return { id: PAYPAL_ORDER_ID }; }
  });
  assert.equal(response.status, 201);
  assert.equal(seenProduct.amount, '2.99');
  assert.equal(seenProduct.credits, 10);
});

test('forged frontend price fields are rejected', async () => {
  const response = await handleCreateOrder(createRequest({ productId: 'story_credits_10', requestId: ORDER_REQUEST_ID, amount: '0.01', credits: 999 }), { authenticate: auth() });
  assert.equal(response.status, 400);
});

test('create order requestId is idempotent', async () => {
  let created = false;
  const response = await handleCreateOrder(createRequest({ productId: 'story_credits_10', requestId: ORDER_REQUEST_ID }), {
    authenticate: auth(),
    orderStore: { findByRequest: async () => LOCAL_ORDER, createPending: async () => { created = true; } }
  });
  assert.equal((await response.json()).idempotent, true);
  assert.equal(created, false);
});

test('valid completed capture adds server-defined credits', async () => {
  let completed;
  const store = {
    findByPayPalId: async () => LOCAL_ORDER,
    completeCapture: async input => { completed = input; return { credits_added: 10, balance: 13 }; }
  };
  const response = await handleCaptureOrder(captureRequest(), { authenticate: auth(), orderStore: store, capturePayPalOrder: async () => completedPayPal() });
  const body = await response.json();
  assert.equal(body.creditsAdded, 10);
  assert.equal(completed.capture.captureId, '3C679366HH908993F');
});

test('capture amount mismatch never calls credit grant', async () => {
  let granted = false;
  const store = { findByPayPalId: async () => LOCAL_ORDER, completeCapture: async () => { granted = true; } };
  const response = await handleCaptureOrder(captureRequest(), { authenticate: auth(), orderStore: store, capturePayPalOrder: async () => completedPayPal('0.01') });
  assert.equal(response.status, 409);
  assert.equal(granted, false);
});

test('capture currency mismatch never calls credit grant', async () => {
  let granted = false;
  const store = { findByPayPalId: async () => LOCAL_ORDER, completeCapture: async () => { granted = true; } };
  const response = await handleCaptureOrder(captureRequest(), { authenticate: auth(), orderStore: store, capturePayPalOrder: async () => completedPayPal('2.99', 'EUR') });
  assert.equal(response.status, 409);
  assert.equal(granted, false);
});

test('completed order repeated capture is idempotent', async () => {
  const order = { ...LOCAL_ORDER, status: 'completed', balance_after: 13 };
  let captured = false;
  const response = await handleCaptureOrder(captureRequest(), { authenticate: auth(), orderStore: { findByPayPalId: async () => order }, capturePayPalOrder: async () => { captured = true; } });
  const body = await response.json();
  assert.equal(body.idempotent, true);
  assert.equal(captured, false);
});

test('non-owner cannot capture another account order', async () => {
  const response = await handleCaptureOrder(captureRequest(), { authenticate: auth(), orderStore: { findByPayPalId: async () => ({ ...LOCAL_ORDER, user_id: '99999999-9999-4999-8999-999999999999' }) } });
  assert.equal(response.status, 404);
});

test('duplicate capture ID is rejected by transactional store', async () => {
  const duplicate = Object.assign(new Error('Capture used'), { code: 'CAPTURE_FAILED', status: 409, expose: true });
  const store = { findByPayPalId: async () => LOCAL_ORDER, completeCapture: async () => { throw duplicate; } };
  const response = await handleCaptureOrder(captureRequest(), { authenticate: auth(), orderStore: store, capturePayPalOrder: async () => completedPayPal() });
  assert.equal(response.status, 409);
});
