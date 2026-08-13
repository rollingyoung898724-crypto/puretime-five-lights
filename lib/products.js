export const PRODUCTS = Object.freeze({
  story_credits_10: Object.freeze({
    id: 'story_credits_10',
    name: 'AI Return Story Credits',
    description: 'Payment for a digital storytelling service. Separate from sadaqah.',
    credits: 10,
    currency: 'USD',
    amount: '2.99'
  }),
  story_credits_30: Object.freeze({
    id: 'story_credits_30',
    name: 'AI Return Story Credits',
    description: 'Payment for a digital storytelling service. Separate from sadaqah.',
    credits: 30,
    currency: 'USD',
    amount: '6.99'
  })
});

export function getProduct(productId) {
  return PRODUCTS[productId] || null;
}
