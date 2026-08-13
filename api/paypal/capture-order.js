import { authenticateRequest } from '../../lib/auth.js';
import { createOrderStore } from '../../lib/order-store.js';
import { capturePayPalOrder, extractCompletedCapture } from '../../lib/paypal.js';
import { methodNotAllowed, readJson, safeError, success } from '../../lib/responses.js';
import { captureOrderSchema } from '../../lib/validation.js';

export async function handleCaptureOrder(request, deps = {}) {
  if (request.method !== 'POST') return methodNotAllowed(['POST']);
  try {
    const auth = await (deps.authenticate || authenticateRequest)(request);
    const input = captureOrderSchema.parse(await readJson(request, 20_000));
    const store = deps.orderStore || createOrderStore();
    const order = await store.findByPayPalId(input.orderId);
    if (!order || order.user_id !== auth.userId) {
      throw Object.assign(new Error('This order is not available for this account.'), { code: 'ORDER_NOT_FOUND', status: 404, expose: true });
    }
    if (order.status === 'completed') {
      return success({ creditsAdded: 0, balance: order.balance_after, orderId: input.orderId, idempotent: true });
    }
    const paypal = await (deps.capturePayPalOrder || capturePayPalOrder)(input.orderId, `capture-${order.id}`);
    if (paypal.id !== input.orderId) throw Object.assign(new Error('PayPal order mismatch.'), { code: 'ORDER_MISMATCH', status: 409, expose: true });
    const capture = extractCompletedCapture(paypal);
    if (!capture) throw Object.assign(new Error('PayPal did not return a completed capture.'), { code: 'CAPTURE_NOT_COMPLETED', status: 409, expose: true });
    if (capture.amount !== String(order.expected_amount) || capture.currency !== order.expected_currency) {
      throw Object.assign(new Error('Captured amount or currency did not match the order.'), { code: 'CAPTURE_AMOUNT_MISMATCH', status: 409, expose: true });
    }
    const result = await store.completeCapture({ userId: auth.userId, orderId: order.id, capture });
    return success({ creditsAdded: result.credits_added, balance: result.balance, orderId: input.orderId });
  } catch (error) {
    return safeError(error);
  }
}

export default { fetch: handleCaptureOrder };
