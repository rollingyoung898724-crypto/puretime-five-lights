import { authenticateRequest } from '../lib/auth.js';
import { createCreditStore } from '../lib/credit-store.js';
import { generateGeminiStory } from '../lib/gemini.js';
import { methodNotAllowed, readJson, safeError, success } from '../lib/responses.js';
import { parsePhotoDataUrl, returnStoryRequestSchema } from '../lib/validation.js';

function completedResponse(existing, balance) {
  return success({
    requestId: existing.request_id,
    story: {
      title: existing.title,
      body: existing.body,
      visualFacts: existing.visual_facts,
      atmosphere: existing.atmosphere,
      photoRelevance: existing.photo_relevance,
      safetyFlags: existing.safety_flags,
      modelName: existing.model_name
    },
    balance,
    idempotent: true
  });
}

export async function handleReturnStory(request, deps = {}) {
  if (request.method !== 'POST') return methodNotAllowed(['POST']);
  let photo;
  let auth;
  let input;
  let reserved = false;
  let generationCreated = false;
  let store;
  try {
    auth = await (deps.authenticate || authenticateRequest)(request);
    input = returnStoryRequestSchema.parse(await readJson(request));
    photo = parsePhotoDataUrl(input.photoDataUrl);
    store = deps.creditStore || createCreditStore();
    await store.ensureAccount(auth.userId);
    const existing = await store.findGeneration(auth.userId, input.requestId);
    if (existing?.status === 'completed') {
      const account = await store.getBalance(auth.userId);
      return completedResponse(existing, account.balance);
    }
    if (existing) {
      const code = existing.status === 'reserved' || existing.status === 'generating' ? 'GENERATION_IN_PROGRESS' : 'GENERATION_ALREADY_FINISHED';
      throw Object.assign(new Error('This request already has a generation state.'), { code, status: 409, expose: true });
    }
    await store.enforceRateLimit(auth.userId);
    const modelName = process.env.GEMINI_MODEL || 'gemini-3.6-flash';
    const created=await store.createGeneration({
      userId: auth.userId,
      requestId: input.requestId,
      prayerName: input.prayerName,
      selectedState: input.selectedState,
      modelName
    });
    if(!created){
      const raced=await store.findGeneration(auth.userId,input.requestId);
      if(raced?.status==='completed'){
        const account=await store.getBalance(auth.userId);
        return completedResponse(raced,account.balance);
      }
      throw Object.assign(new Error('This story request is already being generated.'),{code:'GENERATION_IN_PROGRESS',status:409,expose:true});
    }
    generationCreated=true;
    await store.reserve(auth.userId, input.requestId);
    reserved = true;
    const story = await (deps.generateStory || generateGeminiStory)({
      mimeType: photo.mimeType,
      base64: photo.base64,
      prayerName: input.prayerName,
      selectedState: input.selectedState
    });
    const result = await store.commit(auth.userId, input.requestId, story);
    reserved = false;
    photo = null;
    input.photoDataUrl = '';
    return success({ requestId: input.requestId, story, balance: result.balance, creditReturned: false });
  } catch (error) {
    if ((reserved||generationCreated) && store && auth && input?.requestId) {
      const creditWasReserved=reserved;
      try {
        await store.release(auth.userId, input.requestId, error.code || 'GENERATION_FAILED');
        if(creditWasReserved) error.creditReturned = true;
      } catch {
        if(creditWasReserved) error.creditReturned = false;
      }
    }
    photo = null;
    if (input?.photoDataUrl) input.photoDataUrl = '';
    const response = safeError(error);
    if (error.creditReturned === undefined) return response;
    const body = await response.json();
    return Response.json({ ...body, creditReturned: error.creditReturned }, { status: response.status, headers: { 'Cache-Control': 'no-store' } });
  }
}

export default { fetch: handleReturnStory };
