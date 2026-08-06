# Attention Gate (experiment)

**"Give me a dollar if you want me to read this email."**

A prototype of paid email filtering: an agent triages every inbound message,
auto-archives cold outreach, and auto-replies with a menu of Stripe payment
links. Paying surfaces the original email; the top tier buys a meeting, no
questions asked.

This lives in `experiments/` because it's unrelated to the TFG research
pipeline — it's a standalone idea being explored in this repo. Nothing here is
published to npm (`experiments/` is not in `package.json` `files`).

## The flow

```
inbound email
     │
     ▼
 classifier ──── known contact / transactional / genuine stranger ──▶ inbox as normal
     │
     ├─── bulk marketing (List-Unsubscribe, Precedence: bulk)
     │        └─▶ archived silently (never auto-reply to bulk mail — mail loops)
     │
     └─── cold pitch (a human SDR)
              └─▶ archived + ONE auto-reply with payment menu:
                    • $1   surface my email        (eyeballs, no reply promised)
                    • $20  guaranteed reply        (within 3 business days)
                    • $250 meeting, no questions   (phone number + booking link
                                                    revealed after payment)
                  │
                  ▼  sender pays (Stripe Checkout)
              webhook (signature-verified) ──▶ email un-archived + labeled
              "Paid $N", owner notified; meeting tier additionally emails the
              payer the phone number and calendar link
```

Design decisions worth keeping if this graduates from prototype:

- **Fails open.** A stranger writing a genuine personal email is classified
  `unknown` and delivered normally. Only sales-pattern email is gated — the
  gate should never hold a real human hostage.
- **One reply per sender, ever.** Repeat pitches are archived silently. The
  gate must not itself become spam.
- **Bulk mail gets no offer.** Blast marketing is archived with no reply:
  nobody reads replies to list mail, and auto-replying to it causes loops.
- **Misclassification escape hatch.** The auto-reply says "if you're not
  selling anything, reply and a human will look."
- **Single-use payment tokens**, and webhook events are HMAC-verified
  (Stripe's `t=…,v1=…` scheme, implemented in `stripe.js`) so nobody can
  surface their own email with a forged webhook.

## Run it

```bash
node experiments/attention-gate/demo.js              # offline walkthrough, no keys needed
node --test experiments/attention-gate/gate.test.js  # tests
```

With `STRIPE_SECRET_KEY` set (use a test-mode key), `createCheckoutSession`
creates real Stripe Checkout Sessions via the REST API — no SDK dependency.
Without it, deterministic mock URLs are returned so everything runs offline.

## Files

| File | What it does |
|---|---|
| `classifier.js` | Heuristic triage: known / bulk / transactional / cold_pitch / unknown |
| `tiers.js` | The price menu ($1 / $20 / $250 defaults) |
| `gate.js` | Orchestration: archive, reply with links, handle payment, fulfill tiers |
| `stripe.js` | Checkout Session creation + webhook signature verify/sign |
| `demo.js` | Console walkthrough of the whole flow |
| `gate.test.js` | `node --test` coverage of classifier, gate, and signatures |

## What a real deployment needs (not built yet)

1. **A mailbox adapter.** `gate.js` talks to an abstract `mailbox` interface
   (`deliver / archive / sendReply / surface / sendEmail / notifyOwner`).
   A Gmail adapter would implement it with the Gmail API: watch via Pub/Sub
   push notifications, archive by removing the `INBOX` label, surface by
   re-adding it plus a `Paid` label.
2. **A tiny webhook server.** One HTTPS endpoint that checks
   `verifyWebhookSignature` and calls `gate.handlePaymentEvent`. Pending
   tokens should live in a small DB, not the in-memory `Map`.
3. **A refund policy.** If you don't honor a $20 "guaranteed reply," refund
   it — the whole thing only works if the promises are real.
4. **Deliverability care.** Auto-replies from your own address to senders on
   spammy infrastructure can hurt your sending reputation; consider sending
   the gate reply from a subdomain (agent@gate.yourdomain.com).
5. **A better classifier.** The heuristics here are a decent floor; an LLM
   call on the ~5% of messages the heuristics are unsure about would make
   misclassification rare. Keep the fail-open rule either way.
