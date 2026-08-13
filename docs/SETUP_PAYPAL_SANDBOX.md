# PayPal Sandbox setup

This stage is Sandbox-only. Do not use live credentials.

1. Open PayPal Developer Dashboard and create a Sandbox REST app.
2. Copy its Sandbox client ID to `PAYPAL_CLIENT_ID`.
3. Copy its Sandbox secret to `PAYPAL_CLIENT_SECRET` on Vercel only.
4. Create a webhook pointing to `https://YOUR-VERCEL-DOMAIN/api/paypal/webhook`.
5. Subscribe to:
   - `PAYMENT.CAPTURE.COMPLETED`
   - `PAYMENT.CAPTURE.REFUNDED`
   - `PAYMENT.CAPTURE.REVERSED`
   - `CUSTOMER.DISPUTE.CREATED` (and `CUSTOMER.DISPUTE.UPDATED` if offered)
6. Copy the webhook ID to `PAYPAL_WEBHOOK_ID`.
7. Set `PAYPAL_ENV=sandbox`.

Products are server-owned in `lib/products.js`:

- `story_credits_10`: 10 credits, USD 2.99
- `story_credits_30`: 30 credits, USD 6.99

The browser sends only `productId` and an idempotency request ID. It never sends a trusted amount, currency, or credit count. Credits are granted only after a completed capture is checked against the local order inside a database transaction.

Webhook signatures are verified with PayPal's official verification endpoint using `PAYPAL_WEBHOOK_ID`. Duplicate webhook event IDs are ignored.

Official references:

- https://developer.paypal.com/docs/api/orders/v2/
- https://developer.paypal.com/api/rest/webhooks/rest/
- https://developer.paypal.com/api/rest/webhooks/event-names/
