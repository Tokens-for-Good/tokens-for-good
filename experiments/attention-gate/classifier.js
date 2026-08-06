// Heuristic email triage. Decides which of four buckets an inbound message
// lands in, without any LLM call — cheap enough to run on every message.
//
//   known         sender is in your contacts → deliver normally
//   bulk          mailing-list / marketing blast → archive silently.
//                 Never auto-reply to bulk mail: nobody reads the reply, and
//                 replying to list mail is how you end up in a mail loop.
//   transactional receipts, verification codes, shipping → deliver normally
//   cold_pitch    a human trying to sell you something → gate it (archive +
//                 auto-reply with payment options)
//   unknown       none of the above → deliver normally. The gate fails open:
//                 a stranger writing you a genuine personal email should
//                 never be held hostage.

const PITCH_PHRASES = [
  'quick call',
  'quick chat',
  '15 minutes',
  '15 mins',
  'book a time',
  'book a demo',
  'schedule a demo',
  'circle back',
  'following up',
  'follow up on my',
  'touch base',
  'touching base',
  'bump this',
  'top of your inbox',
  'free trial',
  'pricing',
  'save you time',
  'save you money',
  'increase your revenue',
  'grow your business',
  'our platform',
  'our solution',
  'case study',
  'roi',
  'limited time',
  'act now',
  'exclusive offer',
];

const SCHEDULER_LINKS = /calendly\.com|savvycal\.com|cal\.com\/|hubspot\.com\/meetings|chilipiper\.com/i;

const TRANSACTIONAL_SUBJECT =
  /receipt|invoice|order (confirm|#)|verification code|verify your|password reset|your (order|payment|subscription|delivery)|shipping|has shipped|security alert/i;

const TRANSACTIONAL_SENDER =
  /^(no-?reply|noreply|do-?not-?reply|receipts?|billing|orders?|support|notifications?|alerts?)@/i;

export function classify(message, { knownContacts = new Set() } = {}) {
  const from = (message.from || '').toLowerCase();
  const subject = message.subject || '';
  const text = message.text || '';
  const headers = message.headers || {};
  const body = `${subject}\n${text}`.toLowerCase();

  if (knownContacts.has(from)) {
    return { verdict: 'known', score: 0, reasons: ['sender in contacts'] };
  }

  const headerNames = Object.keys(headers).map((h) => h.toLowerCase());
  const precedence = (headers['Precedence'] || headers['precedence'] || '').toLowerCase();
  if (
    headerNames.includes('list-unsubscribe') ||
    headerNames.includes('list-id') ||
    precedence === 'bulk' ||
    precedence === 'list'
  ) {
    return { verdict: 'bulk', score: 0, reasons: ['bulk/list headers present'] };
  }

  if (TRANSACTIONAL_SENDER.test(from) || TRANSACTIONAL_SUBJECT.test(subject)) {
    return { verdict: 'transactional', score: 0, reasons: ['transactional sender/subject'] };
  }

  let score = 0;
  const reasons = [];

  const hits = PITCH_PHRASES.filter((p) => body.includes(p));
  if (hits.length > 0) {
    score += hits.length;
    reasons.push(`pitch phrases: ${hits.slice(0, 4).join(', ')}`);
  }

  if (SCHEDULER_LINKS.test(text)) {
    score += 2;
    reasons.push('scheduling link');
  }

  if (/^re:/i.test(subject) && !message.inReplyTo) {
    score += 2;
    reasons.push('fake "Re:" with no prior thread');
  }

  const replyTo = (headers['Reply-To'] || headers['reply-to'] || '').toLowerCase();
  const domainOf = (addr) => addr.split('@')[1] || '';
  if (replyTo && domainOf(replyTo) !== domainOf(from)) {
    score += 1;
    reasons.push('reply-to domain differs from sender');
  }

  if (score >= 2) {
    return { verdict: 'cold_pitch', score, reasons };
  }
  return { verdict: 'unknown', score, reasons };
}
