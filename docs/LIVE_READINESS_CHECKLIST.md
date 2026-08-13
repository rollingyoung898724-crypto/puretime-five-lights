# Live readiness checklist

Live payments are not enabled by this implementation. `PAYPAL_ENV=live` is deliberately rejected by the payment paths.

Before a future live release:

- Complete business identity and PayPal merchant verification.
- Review PayPal's digital-goods, refund, dispute, tax, and regional requirements.
- Replace Sandbox app credentials with separately managed live credentials.
- Create and verify a live webhook; never reuse a Sandbox webhook ID.
- Add an explicit, reviewed code change that allows live mode and test it in a staging environment.
- Complete end-to-end reconciliation tests for capture, duplicate capture, delayed webhook, refund, reversal, and dispute.
- Add customer-facing terms, privacy notice, refund policy, support contact, and account/credit recovery process.
- Review Google Gemini API data terms and production logging/data-retention settings.
- Configure production SMTP, abuse prevention, monitoring, alerts, database backups, key rotation, and incident response.
- Load-test credit reservation concurrency and verify RPC behavior against the actual Supabase project.
- Complete accessibility and iPhone standalone testing on the deployed HTTPS build.
- Obtain any legal, tax, privacy, religious-advisory, and consumer-protection review required for launch markets.
