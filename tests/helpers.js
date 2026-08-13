export const USER_ID = '11111111-1111-4111-8111-111111111111';
export const REQUEST_ID = '22222222-2222-4222-8222-222222222222';
export const ORDER_REQUEST_ID = '33333333-3333-4333-8333-333333333333';

export function auth() {
  return async () => ({ userId: USER_ID, email: 'person@example.com', token: 'test-token' });
}

export function jpegDataUrl(size = 4) {
  const bytes = size <= 4 ? Buffer.from([0xff, 0xd8, 0xff, 0xd9]) : Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(size - 3)]);
  return `data:image/jpeg;base64,${bytes.toString('base64')}`;
}

export function storyRequest(overrides = {}) {
  return new Request('http://localhost/api/return-story', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer test-token' },
    body: JSON.stringify({
      requestId: REQUEST_ID,
      photoDataUrl: jpegDataUrl(),
      prayerName: 'Asr',
      selectedState: 'busy',
      language: 'en',
      ...overrides
    })
  });
}

export const VALID_STORY = {
  visualFacts: ['an open notebook on a wooden table', 'soft light across the page'],
  atmosphere: 'quiet and reflective',
  title: 'ROOM TO RETURN',
  body: 'I notice the open notebook and the soft light resting across the page. My day moved quickly, and I lost the pause I wanted for Asr. I can hold that honestly without turning it into shame. This quiet detail gives me one grounded place to prepare for the next salah.',
  photoRelevance: 'high',
  safetyFlags: [],
  modelName: 'gemini-3.6-flash'
};

export function makeCreditStore({ balance = 3, existing = null, reserveError = null } = {}) {
  const calls = [];
  return {
    calls,
    balance,
    reserved:false,
    async ensureAccount() { calls.push(['ensure']); return { balance: this.balance, account_hold: false, free_credits_granted: 3 }; },
    async getBalance() { calls.push(['balance']); return { balance: this.balance, account_hold: false }; },
    async findGeneration() { calls.push(['find']); return existing; },
    async enforceRateLimit() { calls.push(['rate']); },
    async createGeneration(input) { calls.push(['create', input]); return true; },
    async reserve() { calls.push(['reserve']); if (reserveError) throw reserveError; this.balance -= 1; this.reserved=true; return { balance: this.balance }; },
    async commit(_user, _request, story) { calls.push(['commit', story]); return { balance: this.balance }; },
    async release(_user, _request, code) { calls.push(['release', code]); if(this.reserved){this.balance += 1;this.reserved=false;} return { balance: this.balance }; }
  };
}
