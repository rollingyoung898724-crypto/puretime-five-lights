import { GoogleGenAI } from '@google/genai';
import { geminiStorySchema, validateStoryLengths } from './validation.js';
import { assertReligiousBoundaries, RELIGIOUS_BOUNDARY_PROMPT } from './religious-boundaries.js';

export const GEMINI_RESPONSE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    visualFacts: {
      type: 'array', minItems: 1, maxItems: 5, items: { type: 'string' },
      description: 'Only directly visible, non-sensitive facts from the image.'
    },
    atmosphere: { type: 'string', description: 'A restrained description grounded in visible light, color and composition.' },
    title: { type: 'string', description: 'Two to five English words.' },
    body: { type: 'string', description: 'A 35 to 70 word first-person reflection grounded in visible facts and selected context.' },
    photoRelevance: { type: 'string', enum: ['high', 'medium', 'low'] },
    safetyFlags: { type: 'array', items: { type: 'string' }, maxItems: 10 }
  },
  required: ['visualFacts', 'atmosphere', 'title', 'body', 'photoRelevance', 'safetyFlags']
};

function buildPrompt({ prayerName, selectedState }) {
  return `${RELIGIOUS_BOUNDARY_PROMPT}

Create one private Return System reflection after ${prayerName}. The user selected the context "${selectedState}".
Describe only what is visibly supported by the photo. If the photo is dark, unclear, or irrelevant, set photoRelevance to low, keep visualFacts minimal, and write a restrained general reflection without inventing details.
The body must be 35 to 70 English words, first person, gentle but honest, and not a social-media caption.`;
}

function modelError(code, cause) {
  return Object.assign(new Error(code), { code, cause });
}

export async function generateGeminiStory(input, options = {}) {
  const apiKey = options.apiKey || process.env.GEMINI_API_KEY;
  const model = options.model || process.env.GEMINI_MODEL || 'gemini-3.6-flash';
  if (!apiKey && !options.client) throw Object.assign(new Error('Gemini is not configured.'), { code: 'SERVER_NOT_CONFIGURED', status: 503 });
  const client = options.client || new GoogleGenAI({ apiKey });
  const timeoutMs = options.timeoutMs || 25_000;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const interaction = await client.interactions.create({
        model,
        input: [
          { type: 'image', mime_type: input.mimeType, data: input.base64 },
          { type: 'text', text: buildPrompt(input) }
        ],
        response_format: {
          type: 'text',
          mime_type: 'application/json',
          schema: GEMINI_RESPONSE_SCHEMA
        }
      }, { timeout: timeoutMs, maxRetries: 0 });
      const parsed = JSON.parse(interaction.output_text);
      const story = geminiStorySchema.parse(parsed);
      validateStoryLengths(story);
      assertReligiousBoundaries(story);
      return { ...story, modelName: model };
    } catch (error) {
      const timedOut = error?.name === 'AbortError' || error?.code === 'ETIMEDOUT' || /timed?\s*out/i.test(String(error?.message || ''));
      if (timedOut) throw modelError('GEMINI_TIMEOUT', error);
      if (attempt === 1) {
        if (error?.code === 'RELIGIOUS_BOUNDARY_VIOLATION') throw error;
        throw modelError('MODEL_OUTPUT_INVALID', error);
      }
    }
  }
  throw modelError('MODEL_OUTPUT_INVALID');
}
