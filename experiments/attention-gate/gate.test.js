import test from 'node:test';
import assert from 'node:assert/strict';
import { classify } from './classifier.js';
import { AttentionGate } from './gate.js';
import { signWebhookPayload, verifyWebhookSignature } from './stripe.js';

function makeMailbox() {
  const log = [];
  return {
    log,
    deliver: async (id) => log.push(['deliver', id]),
    archive: async (id) => log.push(['archive', id]),
    sendReply: async (m, body) => log.push(['reply', m.from, body]),
    surface: async (id, opts) => log.push(['surface', id, opts.label]),
    sendEmail: async (to, subject, body) => log.push(['email', to, subject, body]),
    notifyOwner: async (text) => log.push(['notify', text]),
  };
}

const PITCH = {
  id: 'p1',
  from: 'sdr@vendor.example',
  subject: 'Re: quick call?',
  text: 'Following up — 15 minutes? https://calendly.com/x/demo',
};

test('classifier: known contact wins over everything', () => {
  const r = classify({ ...PITCH, from: 'friend@x.example' }, { knownContacts: new Set(['friend@x.example']) });
  assert.equal(r.verdict, 'known');
});

test('classifier: bulk mail detected via headers', () => {
  const r = classify({ from: 'a@b.c', subject: 'Deals!', text: 'Buy', headers: { 'List-Unsubscribe': '<x>' } });
  assert.equal(r.verdict, 'bulk');
});

test('classifier: transactional passes through', () => {
  const r = classify({ from: 'no-reply@shop.example', subject: 'Your order has shipped', text: '' });
  assert.equal(r.verdict, 'transactional');
});

test('classifier: cold pitch detected', () => {
  const r = classify(PITCH);
  assert.equal(r.verdict, 'cold_pitch');
});

test('classifier: plain personal email from a stranger fails open', () => {
  const r = classify({ from: 'stranger@uni.example', subject: 'Loved your talk', text: 'I had a question about slide 12.' });
  assert.equal(r.verdict, 'unknown');
});

test('gate: cold pitch is archived and gets one reply with all tier links', async () => {
  const mailbox = makeMailbox();
  const gate = new AttentionGate({ mailbox });

  const r = await gate.processMessage(PITCH);
  assert.equal(r.action, 'gated');
  assert.deepEqual(Object.keys(r.links), ['surface', 'reply', 'meeting']);
  assert.equal(mailbox.log[0][0], 'archive');
  const reply = mailbox.log.find(([a]) => a === 'reply');
  assert.ok(reply[2].includes(r.links.surface));

  // second pitch from same sender: archived, no second reply
  const r2 = await gate.processMessage({ ...PITCH, id: 'p2' });
  assert.equal(r2.action, 'archived_silently');
  assert.equal(mailbox.log.filter(([a]) => a === 'reply').length, 1);
});

test('gate: bulk mail archived with no reply', async () => {
  const mailbox = makeMailbox();
  const gate = new AttentionGate({ mailbox });
  const r = await gate.processMessage({
    id: 'b1', from: 'blast@x.example', subject: 'Sale', text: 'Buy',
    headers: { Precedence: 'bulk' },
  });
  assert.equal(r.action, 'archived_silently');
  assert.equal(mailbox.log.filter(([a]) => a === 'reply').length, 0);
});

test('gate: payment surfaces the message; meeting tier reveals phone', async () => {
  const mailbox = makeMailbox();
  const gate = new AttentionGate({
    mailbox,
    phoneNumber: '+1 555 0100',
    calendarUrl: 'https://cal.example/me',
  });
  const { token } = await gate.processMessage(PITCH);

  const res = await gate.handlePaymentEvent({
    type: 'checkout.session.completed',
    data: { object: { metadata: { token, tier: 'meeting' } } },
  });
  assert.equal(res.handled, true);
  assert.ok(mailbox.log.some(([a, , label]) => a === 'surface' && label.includes('$250')));
  const email = mailbox.log.find(([a]) => a === 'email');
  assert.ok(email[3].includes('+1 555 0100'));
  assert.ok(email[3].includes('https://cal.example/me'));

  // token is single-use
  const replay = await gate.handlePaymentEvent({
    type: 'checkout.session.completed',
    data: { object: { metadata: { token, tier: 'meeting' } } },
  });
  assert.equal(replay.handled, false);
});

test('gate: surface tier does NOT reveal phone number', async () => {
  const mailbox = makeMailbox();
  const gate = new AttentionGate({ mailbox, phoneNumber: '+1 555 0100' });
  const { token } = await gate.processMessage(PITCH);
  await gate.handlePaymentEvent({
    type: 'checkout.session.completed',
    data: { object: { metadata: { token, tier: 'surface' } } },
  });
  assert.equal(mailbox.log.filter(([a]) => a === 'email').length, 0);
});

test('webhook signatures: round-trip verifies, tampering and stale timestamps fail', () => {
  const body = '{"ok":true}';
  const secret = 'whsec_test';
  const sig = signWebhookPayload(body, secret, { now: 1000 });
  assert.equal(verifyWebhookSignature(body, sig, secret, { now: 1000 }), true);
  assert.equal(verifyWebhookSignature(body + 'x', sig, secret, { now: 1000 }), false);
  assert.equal(verifyWebhookSignature(body, sig, 'whsec_other', { now: 1000 }), false);
  assert.equal(verifyWebhookSignature(body, sig, secret, { now: 2000 }), false);
});
