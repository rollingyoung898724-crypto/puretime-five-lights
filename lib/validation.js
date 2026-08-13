import { z } from 'zod';

export const UUID = z.string().uuid();
export const PRAYER_NAMES = ['Fajr', 'Dhuhr', 'Asr', 'Maghrib', 'Isha'];
export const MOMENT_STATES = ['busy', 'tired', 'rhythm', 'distant', 'quiet', 'unknown'];
export const SUPPORTED_IMAGE_MIME = ['image/jpeg', 'image/png', 'image/webp'];

export const returnStoryRequestSchema = z.object({
  requestId: UUID,
  photoDataUrl: z.string().min(20).max(2_100_000),
  prayerName: z.enum(PRAYER_NAMES),
  selectedState: z.enum(MOMENT_STATES),
  language: z.literal('en')
}).strict();

export const geminiStorySchema = z.object({
  visualFacts: z.array(z.string().min(2).max(140)).min(1).max(5),
  atmosphere: z.string().min(2).max(120),
  title: z.string().min(2).max(80),
  body: z.string().min(20).max(700),
  photoRelevance: z.enum(['high', 'medium', 'low']),
  safetyFlags: z.array(z.string().max(100)).max(10)
}).strict();

export const createOrderSchema = z.object({
  productId: z.enum(['story_credits_10', 'story_credits_30']),
  requestId: UUID
}).strict();

export const captureOrderSchema = z.object({
  orderId: z.string().regex(/^[A-Z0-9]{8,36}$/)
}).strict();

export const emailSchema = z.string().email().max(254);
export const otpSchema = z.string().regex(/^\d{6}$/);

export function parsePhotoDataUrl(value) {
  const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match || !SUPPORTED_IMAGE_MIME.includes(match[1])) {
    throw Object.assign(new Error('Choose a JPG, PNG, or WEBP image.'), { code: 'INVALID_IMAGE_FORMAT', status: 400, expose: true });
  }
  const bytes = Buffer.from(match[2], 'base64');
  if (!bytes.length || bytes.toString('base64').replace(/=+$/, '') !== match[2].replace(/=+$/, '')) {
    throw Object.assign(new Error('The image data is malformed.'), { code: 'INVALID_IMAGE_DATA', status: 400, expose: true });
  }
  if (bytes.length > 1_572_864) {
    throw Object.assign(new Error('The prepared image is too large.'), { code: 'IMAGE_TOO_LARGE', status: 413, expose: true });
  }
  const signatures = {
    'image/jpeg': bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff,
    'image/png': bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a])),
    'image/webp': bytes.length >= 12 && bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP'
  };
  if (!signatures[match[1]]) {
    throw Object.assign(new Error('The image content does not match its file type.'), { code: 'INVALID_IMAGE_DATA', status: 400, expose: true });
  }
  return { mimeType: match[1], base64: match[2], byteLength: bytes.length };
}

export function wordCount(value) {
  return String(value).trim().split(/\s+/).filter(Boolean).length;
}

export function validateStoryLengths(story) {
  const titleWords = wordCount(story.title);
  const bodyWords = wordCount(story.body);
  if (titleWords < 2 || titleWords > 5 || bodyWords < 35 || bodyWords > 70) {
    throw Object.assign(new Error('The model response did not meet the required length.'), { code: 'MODEL_OUTPUT_INVALID' });
  }
  return story;
}
