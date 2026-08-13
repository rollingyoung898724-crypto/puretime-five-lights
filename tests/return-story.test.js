import test from 'node:test';
import assert from 'node:assert/strict';
import { handleReturnStory } from '../api/return-story.js';
import { assertReligiousBoundaries } from '../lib/religious-boundaries.js';
import { parsePhotoDataUrl } from '../lib/validation.js';
import { auth, makeCreditStore, storyRequest, VALID_STORY, REQUEST_ID } from './helpers.js';

test('generates with credit and commits exactly once', async () => {
  const store = makeCreditStore();
  const response = await handleReturnStory(storyRequest(), { authenticate: auth(), creditStore: store, generateStory: async () => VALID_STORY });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.balance, 2);
  assert.equal(store.calls.filter(([name]) => name === 'reserve').length, 1);
  assert.equal(store.calls.filter(([name]) => name === 'commit').length, 1);
});

test('rejects insufficient credits without calling the model', async () => {
  let generated = false;
  const error = Object.assign(new Error('No credits'), { code: 'INSUFFICIENT_CREDITS', status: 402, expose: true });
  const response = await handleReturnStory(storyRequest(), { authenticate: auth(), creditStore: makeCreditStore({ balance: 0, reserveError: error }), generateStory: async () => { generated = true; } });
  assert.equal(response.status, 402);
  assert.equal(generated, false);
});

test('rejects malformed image format', async () => {
  const response = await handleReturnStory(storyRequest({ photoDataUrl: 'data:image/gif;base64,R0lGODlh' }), { authenticate: auth(), creditStore: makeCreditStore() });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.code, 'INVALID_IMAGE_FORMAT');
});

test('rejects decoded images over 1.5MB', () => {
  const large = `data:image/jpeg;base64,${Buffer.alloc(1_572_865).toString('base64')}`;
  assert.throws(() => parsePhotoDataUrl(large), error => error.code === 'IMAGE_TOO_LARGE');
});

test('releases reserved credit after timeout', async () => {
  const store = makeCreditStore();
  const error = Object.assign(new Error('timeout'), { code: 'GEMINI_TIMEOUT' });
  const response = await handleReturnStory(storyRequest(), { authenticate: auth(), creditStore: store, generateStory: async () => { throw error; } });
  const body = await response.json();
  assert.equal(body.creditReturned, true);
  assert.equal(store.balance, 3);
  assert.equal(store.calls.some(([name]) => name === 'release'), true);
});

test('releases reserved credit after invalid model JSON/output', async () => {
  const store = makeCreditStore();
  const error = Object.assign(new Error('invalid'), { code: 'MODEL_OUTPUT_INVALID' });
  await handleReturnStory(storyRequest(), { authenticate: auth(), creditStore: store, generateStory: async () => { throw error; } });
  assert.equal(store.balance, 3);
});

test('religious boundary content is rejected', () => {
  assert.throws(() => assertReligiousBoundaries({ ...VALID_STORY, body: 'I believe Allah wanted this and my return was accepted without question.' }), error => error.code === 'RELIGIOUS_BOUNDARY_VIOLATION');
});

test('completed requestId returns the existing story without another charge', async () => {
  const existing = {
    request_id: REQUEST_ID, status: 'completed', title: VALID_STORY.title, body: VALID_STORY.body,
    visual_facts: VALID_STORY.visualFacts, atmosphere: VALID_STORY.atmosphere,
    photo_relevance: 'high', safety_flags: [], model_name: 'gemini-3.6-flash'
  };
  const store = makeCreditStore({ balance: 2, existing });
  const response = await handleReturnStory(storyRequest(), { authenticate: auth(), creditStore: store });
  assert.equal((await response.json()).idempotent, true);
  assert.equal(store.calls.some(([name]) => name === 'reserve'), false);
});

test('photo data is not passed into database generation metadata', async () => {
  const store = makeCreditStore();
  await handleReturnStory(storyRequest(), { authenticate: auth(), creditStore: store, generateStory: async () => VALID_STORY });
  const created = store.calls.find(([name]) => name === 'create')[1];
  assert.equal('photoDataUrl' in created, false);
  assert.equal(JSON.stringify(store.calls).includes('base64'), false);
});

test('concurrent duplicate requestId returns in-progress without a second model call', async () => {
  const store=makeCreditStore();
  let finds=0;
  store.findGeneration=async()=>++finds===1?null:{request_id:REQUEST_ID,status:'generating'};
  store.createGeneration=async()=>false;
  let generated=false;
  const response=await handleReturnStory(storyRequest(),{authenticate:auth(),creditStore:store,generateStory:async()=>{generated=true;}});
  assert.equal(response.status,409);
  assert.equal((await response.json()).error.code,'GENERATION_IN_PROGRESS');
  assert.equal(generated,false);
});
