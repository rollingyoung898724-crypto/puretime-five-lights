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
  console.log('return-story request received', { method: request.method, path: new URL(request.url).pathname });
  if (request.method !== 'POST') return methodNotAllowed(['POST']);
  let photo;
  let auth;
  let input;
  let reserved = false;
  let generationCreated = false;
  let store;
  try {
    auth = await (deps.authenticate || authenticateRequest)(request);
    console.log('return-story auth validated', { authenticated: Boolean(auth?.userId) });
    input = returnStoryRequestSchema.parse(await readJson(request));
    console.log('return-story JSON body parsed', { requestId: input.requestId, prayerName: input.prayerName, selectedState: input.selectedState });
    photo = parsePhotoDataUrl(input.photoDataUrl);
    store = deps.creditStore || createCreditStore();
    console.log('return-story Supabase ensure account started', { requestId: input.requestId });
    await store.ensureAccount(auth.userId);
    console.log('return-story Supabase ensure account completed', { requestId: input.requestId });
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
    console.log('return-story Supabase generation write started', { requestId: input.requestId, modelName });
    const created=await store.createGeneration({
      userId: auth.userId,
      requestId: input.requestId,
      prayerName: input.prayerName,
      selectedState: input.selectedState,
      modelName
    });
    console.log('return-story Supabase generation write completed', { requestId: input.requestId, created });
    if(!created){
      const raced=await store.findGeneration(auth.userId,input.requestId);
      if(raced?.status==='completed'){
        const account=await store.getBalance(auth.userId);
        return completedResponse(raced,account.balance);
      }
      throw Object.assign(new Error('This story request is already being generated.'),{code:'GENERATION_IN_PROGRESS',status:409,expose:true});
    }
    generationCreated=true;
    console.log('return-story Supabase credit reservation started', { requestId: input.requestId });
    await store.reserve(auth.userId, input.requestId);
    console.log('return-story Supabase credit reservation completed', { requestId: input.requestId });
    reserved = true;
    console.log('return-story Gemini API call started', { requestId: input.requestId, modelName });
    const story = await (deps.generateStory || generateGeminiStory)({
      mimeType: photo.mimeType,
      base64: photo.base64,
      prayerName: input.prayerName,
      selectedState: input.selectedState
    });
    console.log('return-story Gemini API returned', { requestId: input.requestId, modelName });
    console.log('return-story Supabase story commit started', { requestId: input.requestId });
    const result = await store.commit(auth.userId, input.requestId, story);
    console.log('return-story Supabase story commit completed', { requestId: input.requestId });
    reserved = false;
    photo = null;
    input.photoDataUrl = '';
    return success({ requestId: input.requestId, story, balance: result.balance, creditReturned: false });
  } catch (error) {
    console.error("return-story error", error);
    if ((reserved||generationCreated) && store && auth && input?.requestId) {
      const creditWasReserved=reserved;
      try {
        console.log('return-story Supabase release started', { requestId: input.requestId, creditWasReserved });
        await store.release(auth.userId, input.requestId, error.code || 'GENERATION_FAILED');
        console.log('return-story Supabase release completed', { requestId: input.requestId, creditWasReserved });
        if(creditWasReserved) error.creditReturned = true;
      } catch (releaseError) {
        console.error('return-story Supabase release failed', { message: releaseError?.message, code: releaseError?.code || 'RELEASE_FAILED' });
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
