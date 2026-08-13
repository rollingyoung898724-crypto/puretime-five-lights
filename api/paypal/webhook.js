import { createOrderStore } from '../../lib/order-store.js';
import { verifyPayPalWebhook } from '../../lib/paypal.js';
import { failure, methodNotAllowed, safeError, success } from '../../lib/responses.js';

const REFUND_EVENTS = new Map([
  ['PAYMENT.CAPTURE.REFUNDED', 'refunded'],
  ['PAYMENT.CAPTURE.REVERSED', 'reversed']
]);

function relatedOrderId(event) {
  return event?.resource?.supplementary_data?.related_ids?.order_id || event?.resource?.id || null;
}

export async function handlePayPalWebhook(request, deps = {}) {
  if (request.method !== 'POST') return methodNotAllowed(['POST']);
  let claimedStore;
  let claimedEventId;
  try {
    const declared=Number(request.headers.get('content-length')||0);
    if(declared>1_000_000) return failure('REQUEST_TOO_LARGE','Webhook body is too large.',413);
    const rawBody=await request.text();
    if(new TextEncoder().encode(rawBody).byteLength>1_000_000) return failure('REQUEST_TOO_LARGE','Webhook body is too large.',413);
    let event;
    try{event=JSON.parse(rawBody);}catch{return failure('INVALID_JSON','Webhook body must be valid JSON.',400);}
    const verified = await (deps.verifyWebhook || verifyPayPalWebhook)(request.headers, event, { rawBody });
    if (!verified) return failure('INVALID_WEBHOOK_SIGNATURE', 'Webhook verification failed.', 401);
    if (!event.id || !event.event_type) return failure('INVALID_WEBHOOK_EVENT', 'Webhook event is incomplete.', 400);
    const store = deps.orderStore || createOrderStore();
    const claimed = await store.claimWebhook(event.id, event.event_type);
    if (!claimed) return success({ idempotent: true });
    claimedStore=store;
    claimedEventId=event.id;
    const orderId = relatedOrderId(event);
    let outcome = 'ignored';
    if (event.event_type === 'PAYMENT.CAPTURE.COMPLETED' && orderId) {
      const order = await store.findByPayPalId(orderId);
      const resource = event.resource;
      if (order && resource.status === 'COMPLETED'
        && resource.amount?.value === String(order.expected_amount)
        && resource.amount?.currency_code === order.expected_currency) {
        await store.completeCapture({
          userId: order.user_id,
          orderId: order.id,
          capture: {
            captureId: resource.id,
            amount: resource.amount.value,
            currency: resource.amount.currency_code,
            payerEmail: null,
            summary: { captureId: resource.id, captureStatus: resource.status, amount: resource.amount }
          }
        });
        outcome = 'completed';
      }
    } else if (REFUND_EVENTS.has(event.event_type) && orderId) {
      await store.processRefund(orderId, event.id, REFUND_EVENTS.get(event.event_type));
      outcome = REFUND_EVENTS.get(event.event_type);
    } else if ((event.event_type === 'CUSTOMER.DISPUTE.CREATED' || event.event_type === 'CUSTOMER.DISPUTE.UPDATED') && orderId) {
      await store.placeAccountHold(orderId, 'disputed');
      outcome = 'disputed';
    }
    await store.markWebhookProcessed(event.id, outcome);
    claimedStore=null;
    return success({ outcome });
  } catch (error) {
    if(claimedStore&&claimedEventId){
      try{await claimedStore.releaseWebhookClaim(claimedEventId);}catch{}
    }
    return safeError(error);
  }
}

export default { fetch: handlePayPalWebhook };
