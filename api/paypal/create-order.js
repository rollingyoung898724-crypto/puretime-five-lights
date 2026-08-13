import { randomUUID } from 'node:crypto';
import { authenticateRequest } from '../../lib/auth.js';
import { createOrderStore } from '../../lib/order-store.js';
import { createPayPalOrder } from '../../lib/paypal.js';
import { getProduct } from '../../lib/products.js';
import { methodNotAllowed, readJson, safeError, success } from '../../lib/responses.js';
import { createOrderSchema } from '../../lib/validation.js';

export async function handleCreateOrder(request, deps = {}) {
  if (request.method !== 'POST') return methodNotAllowed(['POST']);
  try {
    const auth = await (deps.authenticate || authenticateRequest)(request);
    const input = createOrderSchema.parse(await readJson(request, 20_000));
    const product = getProduct(input.productId);
    const store = deps.orderStore || createOrderStore();
    const existing = await store.findByRequest(auth.userId, input.requestId);
    if (existing?.paypal_order_id) return success({ orderId: existing.paypal_order_id, idempotent: true });
    const localOrder=existing||await store.createPending({id:randomUUID(),userId:auth.userId,requestId:input.requestId,product});
    if(localOrder.paypal_order_id) return success({orderId:localOrder.paypal_order_id,idempotent:true});
    const localId=localOrder.id;
    const paypal = await (deps.createPayPalOrder || createPayPalOrder)(product, localId, input.requestId);
    await store.attachPayPalOrder(localId, paypal.id);
    return success({ orderId: paypal.id }, 201);
  } catch (error) {
    return safeError(error);
  }
}

export default { fetch: handleCreateOrder };
