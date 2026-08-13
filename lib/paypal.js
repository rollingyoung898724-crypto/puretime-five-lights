const BASE_URLS = {
  sandbox: 'https://api-m.sandbox.paypal.com',
  live: 'https://api-m.paypal.com'
};

export function getPayPalEnvironment() {
  const environment = process.env.PAYPAL_ENV || 'sandbox';
  if (!Object.hasOwn(BASE_URLS, environment)) {
    throw Object.assign(new Error('PAYPAL_ENV must be sandbox or live.'), { code: 'INVALID_PAYPAL_ENV', status: 503 });
  }
  return environment;
}

export function assertSandboxMode() {
  if (getPayPalEnvironment() !== 'sandbox') {
    throw Object.assign(new Error('This build is restricted to PayPal Sandbox.'), { code: 'PAYPAL_SANDBOX_REQUIRED', status: 503 });
  }
}

export function getPayPalBaseUrl() {
  return BASE_URLS[getPayPalEnvironment()];
}

function requireSecret(name) {
  const value = process.env[name];
  if (!value) throw Object.assign(new Error(`Missing server configuration: ${name}`), { code: 'SERVER_NOT_CONFIGURED', status: 503 });
  return value;
}

export async function getPayPalAccessToken({ fetchImpl = fetch } = {}) {
  assertSandboxMode();
  const credentials = Buffer.from(`${requireSecret('PAYPAL_CLIENT_ID')}:${requireSecret('PAYPAL_CLIENT_SECRET')}`).toString('base64');
  const response = await fetchImpl(`${getPayPalBaseUrl()}/v1/oauth2/token`, {
    method: 'POST',
    headers: { Authorization: `Basic ${credentials}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials'
  });
  if (!response.ok) throw Object.assign(new Error('PayPal authentication failed.'), { code: 'PAYPAL_UNAVAILABLE', status: 502 });
  return (await response.json()).access_token;
}

async function paypalRequest(path, { method = 'GET', body, requestId, fetchImpl = fetch } = {}) {
  const token = await getPayPalAccessToken({ fetchImpl });
  const response = await fetchImpl(`${getPayPalBaseUrl()}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Prefer: 'return=representation',
      ...(requestId ? { 'PayPal-Request-Id': requestId } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error('PayPal request failed.'), { code: 'PAYPAL_REQUEST_FAILED', status: 502, paypalStatus: response.status });
  return data;
}

export function createPayPalOrder(product, localOrderId, requestId, options = {}) {
  assertSandboxMode();
  return paypalRequest('/v2/checkout/orders', {
    ...options,
    method: 'POST',
    requestId,
    body: {
      intent: 'CAPTURE',
      purchase_units: [{
        custom_id: localOrderId,
        invoice_id: localOrderId,
        description: product.description,
        amount: { currency_code: product.currency, value: product.amount }
      }]
    }
  });
}

export function capturePayPalOrder(orderId, requestId, options = {}) {
  assertSandboxMode();
  return paypalRequest(`/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, { ...options, method: 'POST', requestId });
}

export async function verifyPayPalWebhook(headers, event, options = {}) {
  assertSandboxMode();
  const required = {
    transmission_id: headers.get('paypal-transmission-id'),
    transmission_time: headers.get('paypal-transmission-time'),
    cert_url: headers.get('paypal-cert-url'),
    auth_algo: headers.get('paypal-auth-algo'),
    transmission_sig: headers.get('paypal-transmission-sig'),
    webhook_id: process.env.PAYPAL_WEBHOOK_ID,
    webhook_event: event
  };
  if (Object.values(required).some(value => !value)) return false;
  const result = await paypalRequest('/v1/notifications/verify-webhook-signature', {
    ...options,
    method: 'POST',
    body: required
  });
  return result.verification_status === 'SUCCESS';
}

export function extractCompletedCapture(payload) {
  const capture = payload?.purchase_units?.[0]?.payments?.captures?.[0];
  if (payload?.status !== 'COMPLETED' || capture?.status !== 'COMPLETED') return null;
  return {
    captureId: capture.id,
    amount: capture.amount?.value,
    currency: capture.amount?.currency_code,
    payerEmail: payload?.payer?.email_address || null,
    summary: {
      orderStatus: payload.status,
      captureStatus: capture.status,
      captureId: capture.id,
      amount: capture.amount
    }
  };
}
