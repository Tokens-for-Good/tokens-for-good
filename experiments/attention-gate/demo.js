import { AttentionGate } from './gate.js';
import { signWebhookPayload, verifyWebhookSignature } from './stripe.js';

// Offline walkthrough of the whole flow: four inbound emails, one payment.
// Run with: node experiments/attention-gate/demo.js

class ConsoleMailbox {
  async deliver(id) {
    console.log(`  📥 inbox: ${id}`);
  }
  async archive(id) {
    console.log(`  🗄  archived: ${id}`);
  }
  async sendReply(message, body) {
    console.log(`  ↩️  auto-reply to ${message.from}:`);
    console.log(body.replace(/^/gm, '     │ '));
  }
  async surface(id, { label }) {
    console.log(`  ⭐ surfaced ${id} with label "${label}"`);
  }
  async sendEmail(to, subject, body) {
    console.log(`  📤 email to ${to} — "${subject}"`);
    console.log(body.replace(/^/gm, '     │ '));
  }
  async notifyOwner(text) {
    console.log(`  🔔 owner notified: ${text}`);
  }
}

const gate = new AttentionGate({
  mailbox: new ConsoleMailbox(),
  knownContacts: new Set(['mom@family.example']),
  ownerName: 'Taylor',
  phoneNumber: '+1 (555) 010-0199',
  calendarUrl: 'https://cal.com/taylor/paid-30min',
});

const messages = [
  {
    id: 'msg-1',
    from: 'mom@family.example',
    subject: 'Sunday dinner?',
    text: 'Are you coming this weekend?',
  },
  {
    id: 'msg-2',
    from: 'receipts@rideshare.example',
    subject: 'Your Tuesday trip receipt',
    text: 'Total: $18.20',
  },
  {
    id: 'msg-3',
    from: 'blast@growthco.example',
    subject: '🚀 10x your pipeline',
    text: 'Limited time offer! Unsubscribe below.',
    headers: { 'List-Unsubscribe': '<https://growthco.example/u>' },
  },
  {
    id: 'msg-4',
    from: 'sdr@saleslord.example',
    subject: 'Re: quick call this week?',
    text:
      'Hey Taylor, following up on my last note — our platform can save you time. ' +
      'Do you have 15 minutes? Grab a slot: https://calendly.com/saleslord/demo',
  },
];

let gatedToken;
for (const msg of messages) {
  console.log(`\n▶ ${msg.from} — "${msg.subject}"`);
  const result = await gate.processMessage(msg);
  console.log(`  verdict: ${result.verdict} → ${result.action}` +
    (result.reasons.length ? `  (${result.reasons.join('; ')})` : ''));
  if (result.token) gatedToken = result.token;
}

console.log('\n▶ SDR pays $250 for the meeting tier…');
const rawEvent = JSON.stringify({
  type: 'checkout.session.completed',
  data: { object: { metadata: { token: gatedToken, tier: 'meeting' } } },
});
const secret = 'whsec_demo';
const sig = signWebhookPayload(rawEvent, secret);
console.log(`  webhook signature valid: ${verifyWebhookSignature(rawEvent, sig, secret)}`);
await gate.handlePaymentEvent(JSON.parse(rawEvent));
