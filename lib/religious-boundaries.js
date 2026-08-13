export const FORBIDDEN_PHRASES = Object.freeze([
  'allah wanted this',
  'allah sent this photo',
  'allah is telling me',
  'allah has forgiven me',
  'my sadaqah repaired the missed salah',
  'i paid for the prayer i missed',
  'this act replaced my salah',
  'my return was accepted',
  'i earned divine reward',
  "the system knows allah's plan",
  'forgiven',
  'accepted',
  'reward unlocked'
]);

const SENSITIVE_INFERENCES = [
  'is muslim', 'is christian', 'is jewish', 'religious identity', 'looks poor',
  'has a disease', 'is ill', 'their profession', 'is married', 'is homeless'
];

export const RELIGIOUS_BOUNDARY_PROMPT = `
This is a private first-person reflection, not religious guidance or a verdict.
Never speak as Allah, interpret Allah's will, promise forgiveness, acceptance or reward,
or imply that payment, sadaqah, kindness or this story replaces or repairs salah.
Only mention visible image facts. Never infer identity, religion, health, poverty,
relationships, profession, intent, or the identity of a real person.
`.trim();

export function assertReligiousBoundaries(story) {
  const text = [story.title, story.body, ...(story.visualFacts || [])].join(' ').toLowerCase();
  const violation = [...FORBIDDEN_PHRASES, ...SENSITIVE_INFERENCES].find(phrase => text.includes(phrase));
  if (violation) {
    throw Object.assign(new Error('Generated content crossed a protected boundary.'), { code: 'RELIGIOUS_BOUNDARY_VIOLATION' });
  }
  if (!/^\s*(i|my)\b/i.test(story.body)) {
    throw Object.assign(new Error('Generated content must be a first-person reflection.'), { code: 'MODEL_OUTPUT_INVALID' });
  }
  return story;
}
