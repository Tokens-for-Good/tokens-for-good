// Pricing tiers for the attention gate. Prices are in cents (Stripe convention).
// Everything here is meant to be overridden per-user; these are demo defaults.

export const DEFAULT_TIERS = {
  surface: {
    price: 100,
    label: 'Surface this email ($1)',
    promise:
      'Your email comes out of the archive and is flagged for me to read. ' +
      'No reply guaranteed — you are paying for eyeballs, not an answer.',
  },
  reply: {
    price: 2000,
    label: 'Guaranteed reply ($20)',
    promise:
      'I will read your email and send a real reply within 3 business days, ' +
      'even if the reply is "no thanks."',
  },
  meeting: {
    price: 25000,
    label: 'Meeting, no questions asked ($250)',
    promise:
      'You get my direct phone number and a booking link for a 30-minute call. ' +
      'I will show up. No pre-qualification, no gatekeeping.',
  },
};

export function formatPrice(cents) {
  return cents % 100 === 0
    ? `$${cents / 100}`
    : `$${(cents / 100).toFixed(2)}`;
}
