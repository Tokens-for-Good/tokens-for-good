import { randomUUID } from 'node:crypto';
import { classify } from './classifier.js';
import { DEFAULT_TIERS, formatPrice } from './tiers.js';
import { createCheckoutSession } from './stripe.js';

// The attention gate itself. Wire it to a real mailbox by implementing:
//
//   mailbox.deliver(id)                leave the message in the inbox
//   mailbox.archive(id)                remove it from the inbox
//   mailbox.sendReply(message, body)   auto-reply to the sender
//   mailbox.surface(id, { label })     bring it back, visibly flagged
//   mailbox.sendEmail(to, subject, body)  fresh outbound email (tier fulfillment)
//   mailbox.notifyOwner(text)          ping you (push, Slack, whatever)
//
// A sender only ever gets ONE gate reply per address, no matter how many
// times they email — repeat pitches are archived silently. That keeps the
// gate from becoming an auto-responder loop or a nuisance in itself.

export class AttentionGate {
  constructor({
    mailbox,
    tiers = DEFAULT_TIERS,
    knownContacts = new Set(),
    ownerName = 'the recipient',
    phoneNumber = null,
    calendarUrl = null,
    stripeApiKey = process.env.STRIPE_SECRET_KEY,
  }) {
    this.mailbox = mailbox;
    this.tiers = tiers;
    this.knownContacts = knownContacts;
    this.ownerName = ownerName;
    this.phoneNumber = phoneNumber;
    this.calendarUrl = calendarUrl;
    this.stripeApiKey = stripeApiKey;
    this.pending = new Map(); // token -> { message, tiers: {tierKey: url} }
    this.repliedSenders = new Set();
  }

  async processMessage(message) {
    const result = classify(message, { knownContacts: this.knownContacts });

    if (result.verdict === 'bulk') {
      await this.mailbox.archive(message.id);
      return { ...result, action: 'archived_silently' };
    }

    if (result.verdict !== 'cold_pitch') {
      await this.mailbox.deliver(message.id);
      return { ...result, action: 'delivered' };
    }

    await this.mailbox.archive(message.id);

    const sender = (message.from || '').toLowerCase();
    if (this.repliedSenders.has(sender)) {
      return { ...result, action: 'archived_silently', note: 'sender already got the gate reply once' };
    }
    this.repliedSenders.add(sender);

    const token = randomUUID();
    const links = {};
    for (const [tierKey, tier] of Object.entries(this.tiers)) {
      const session = await createCheckoutSession({
        apiKey: this.stripeApiKey,
        tierKey,
        tier,
        token,
        messageId: message.id,
      });
      links[tierKey] = session.url;
    }
    this.pending.set(token, { message, links });

    await this.mailbox.sendReply(message, this.gateReplyBody(links));
    return { ...result, action: 'gated', token, links };
  }

  gateReplyBody(links) {
    const menu = Object.entries(this.tiers)
      .map(([key, t]) => `• ${t.label} — ${t.promise}\n  ${links[key]}`)
      .join('\n\n');
    return (
      `Hi — this is ${this.ownerName}'s email agent.\n\n` +
      `This looked like unsolicited outreach, so it was archived automatically ` +
      `and ${this.ownerName} has not seen it. If you believe it's worth their ` +
      `attention, you can put a price on that:\n\n` +
      `${menu}\n\n` +
      `Payment surfaces your original email immediately. If this was a ` +
      `misclassification (you're not selling anything), just reply to this ` +
      `email and a human will take a look.\n`
    );
  }

  // Feed this verified Stripe events (checkout.session.completed). Signature
  // verification happens at the HTTP layer — see stripe.js.
  async handlePaymentEvent(event) {
    if (event.type !== 'checkout.session.completed') return { handled: false };

    const { token, tier: tierKey } = event.data.object.metadata || {};
    const entry = this.pending.get(token);
    const tier = this.tiers[tierKey];
    if (!entry || !tier) return { handled: false, reason: 'unknown token or tier' };

    const { message } = entry;
    this.pending.delete(token);

    await this.mailbox.surface(message.id, {
      label: `Paid ${formatPrice(tier.price)} · ${tierKey}`,
    });
    await this.mailbox.notifyOwner(
      `${message.from} paid ${formatPrice(tier.price)} (${tierKey}) to surface: "${message.subject}"`,
    );

    if (tierKey === 'meeting') {
      await this.mailbox.sendEmail(
        message.from,
        `Meeting confirmed with ${this.ownerName}`,
        `Payment received — here's the direct line, as promised.\n\n` +
          `Phone: ${this.phoneNumber || '(configure phoneNumber)'}\n` +
          `Book a slot: ${this.calendarUrl || '(configure calendarUrl)'}\n\n` +
          `No questions asked. See you there.\n`,
      );
    }

    return { handled: true, tierKey, messageId: message.id };
  }
}
