import { createHmac, timingSafeEqual } from 'node:crypto';

// Thin Stripe client. With STRIPE_SECRET_KEY set it creates a real Checkout
// Session over the REST API (no SDK dependency — form-encoded POST). Without
// a key it returns a deterministic mock URL so the demo and tests run offline.

const STRIPE_API = 'https://api.stripe.com/v1/checkout/sessions';

export async function createCheckoutSession({
  apiKey = process.env.STRIPE_SECRET_KEY,
  tierKey,
  tier,
  token,
  messageId,
  successUrl = 'https://example.com/paid',
}) {
  if (!apiKey) {
    return {
      mock: true,
      url: `https://checkout.stripe.example/pay/${token}?tier=${tierKey}`,
    };
  }

  const params = new URLSearchParams({
    mode: 'payment',
    success_url: successUrl,
    'line_items[0][quantity]': '1',
    'line_items[0][price_data][currency]': 'usd',
    'line_items[0][price_data][unit_amount]': String(tier.price),
    'line_items[0][price_data][product_data][name]': tier.label,
    'metadata[token]': token,
    'metadata[tier]': tierKey,
    'metadata[message_id]': messageId,
  });

  const res = await fetch(STRIPE_API, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params,
  });
  if (!res.ok) {
    throw new Error(`Stripe checkout create failed: ${res.status} ${await res.text()}`);
  }
  const session = await res.json();
  return { mock: false, url: session.url, id: session.id };
}

// Stripe webhook signature scheme: header is `t=<ts>,v1=<hmac>` where the hmac
// is HMAC-SHA256(secret, `${ts}.${rawBody}`). Verify before trusting any event.
export function verifyWebhookSignature(rawBody, signatureHeader, secret, {
  toleranceSeconds = 300,
  now = Math.floor(Date.now() / 1000),
} = {}) {
  const parts = Object.fromEntries(
    (signatureHeader || '').split(',').map((kv) => kv.split('=').map((s) => s.trim())),
  );
  const ts = Number(parts.t);
  const given = parts.v1;
  if (!ts || !given) return false;
  if (Math.abs(now - ts) > toleranceSeconds) return false;

  const expected = createHmac('sha256', secret)
    .update(`${ts}.${rawBody}`)
    .digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function signWebhookPayload(rawBody, secret, {
  now = Math.floor(Date.now() / 1000),
} = {}) {
  const hmac = createHmac('sha256', secret).update(`${now}.${rawBody}`).digest('hex');
  return `t=${now},v1=${hmac}`;
}
