import { getSupabaseAdmin } from './supabase-admin.js';

function orderError(error, code = 'ORDER_OPERATION_FAILED') {
  return Object.assign(new Error('The order operation could not be completed.'), { code, status: 409, cause: error });
}

export function createOrderStore(admin = getSupabaseAdmin()) {
  return {
    async findByRequest(userId, requestId) {
      const { data, error } = await admin.from('paypal_orders').select('*')
        .eq('user_id', userId).eq('request_id', requestId).maybeSingle();
      if (error) throw orderError(error);
      return data;
    },
    async createPending({ id, userId, requestId, product }) {
      const { data, error } = await admin.from('paypal_orders').insert({
        id,
        user_id: userId,
        request_id: requestId,
        product_id: product.id,
        expected_amount: product.amount,
        expected_currency: product.currency,
        credits: product.credits,
        status: 'created'
      }).select('*').single();
      if (error?.code === '23505') return this.findByRequest(userId, requestId);
      if (error) throw orderError(error);
      return data;
    },
    async attachPayPalOrder(id, paypalOrderId) {
      const { data, error } = await admin.from('paypal_orders')
        .update({ paypal_order_id: paypalOrderId, updated_at: new Date().toISOString() })
        .eq('id', id).select('*').single();
      if (error) throw orderError(error);
      return data;
    },
    async findByPayPalId(paypalOrderId) {
      const { data, error } = await admin.from('paypal_orders').select('*')
        .eq('paypal_order_id', paypalOrderId).maybeSingle();
      if (error) throw orderError(error);
      return data;
    },
    async completeCapture({ userId, orderId, capture }) {
      const { data, error } = await admin.rpc('grant_purchase_credits', {
        p_user_id: userId,
        p_order_id: orderId,
        p_capture_id: capture.captureId,
        p_amount: capture.amount,
        p_currency: capture.currency,
        p_payer_email: capture.payerEmail,
        p_raw_summary: capture.summary
      });
      if (error) throw orderError(error, String(error.message || '').includes('ORDER_MISMATCH') ? 'ORDER_MISMATCH' : 'CAPTURE_FAILED');
      return Array.isArray(data) ? data[0] : data;
    },
    async claimWebhook(eventId, eventType) {
      const { error } = await admin.from('paypal_webhook_events').insert({ event_id: eventId, event_type: eventType });
      if (!error) return true;
      if (error.code === '23505') {
        const { data, error: lookupError } = await admin.from('paypal_webhook_events')
          .select('processed_at').eq('event_id', eventId).maybeSingle();
        if (lookupError) throw orderError(lookupError, 'WEBHOOK_STORE_FAILED');
        if (data?.processed_at) return false;
        throw Object.assign(new Error('Webhook event is already being processed.'), { code: 'WEBHOOK_IN_PROGRESS', status: 409, expose: true });
      }
      throw orderError(error, 'WEBHOOK_STORE_FAILED');
    },
    async releaseWebhookClaim(eventId) {
      const { error } = await admin.from('paypal_webhook_events').delete()
        .eq('event_id', eventId).is('processed_at', null);
      if (error) throw orderError(error, 'WEBHOOK_STORE_FAILED');
    },
    async markWebhookProcessed(eventId, outcome) {
      const { error } = await admin.from('paypal_webhook_events')
        .update({ processed_at: new Date().toISOString(), outcome }).eq('event_id', eventId);
      if (error) throw orderError(error, 'WEBHOOK_STORE_FAILED');
    },
    async processRefund(paypalOrderId, eventId, status) {
      const { data, error } = await admin.rpc('process_refund_adjustment', {
        p_paypal_order_id: paypalOrderId,
        p_event_id: eventId,
        p_new_status: status
      });
      if (error) throw orderError(error, 'REFUND_PROCESSING_FAILED');
      return data;
    },
    async placeAccountHold(paypalOrderId, status) {
      const order = await this.findByPayPalId(paypalOrderId);
      if (!order) return false;
      const { error: accountError } = await admin.from('ai_credit_accounts')
        .update({ account_hold: true, updated_at: new Date().toISOString() }).eq('user_id', order.user_id);
      const { error: orderUpdateError } = await admin.from('paypal_orders')
        .update({ status, updated_at: new Date().toISOString() }).eq('id', order.id);
      if (accountError || orderUpdateError) throw orderError(accountError || orderUpdateError);
      return true;
    }
  };
}
