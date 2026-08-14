import test from 'node:test';
import assert from 'node:assert/strict';
import { generateGeminiStory } from '../lib/gemini.js';
import { VALID_STORY } from './helpers.js';

const input={mimeType:'image/jpeg',base64:'/9j/2Q==',prayerName:'Asr',selectedState:'busy'};

test('Gemini adapter sends inline image and strict response schema',async()=>{
  let params;
  const {modelName,...modelStory}=VALID_STORY;
  const client={interactions:{create:async value=>{params=value;return{output_text:JSON.stringify(modelStory)};}}};
  const result=await generateGeminiStory(input,{client,model:'gemini-3.6-flash'});
  assert.equal(params.input[0].type,'image');
  assert.equal(params.response_format.mime_type,'application/json');
  assert.equal(result.title,VALID_STORY.title);
});

test('Gemini adapter retries invalid JSON once then rejects',async()=>{
  let attempts=0;
  const client={interactions:{create:async()=>{attempts+=1;return{output_text:'not-json'};}}};
  await assert.rejects(()=>generateGeminiStory(input,{client}),error=>error.code==='MODEL_OUTPUT_INVALID');
  assert.equal(attempts,2);
});

test('Gemini adapter retries a non-first-person reflection with stronger instructions',async()=>{
  let attempts=0;
  const prompts=[];
  const {modelName,...modelStory}=VALID_STORY;
  const invalidStory={...modelStory,body:modelStory.body.replace(/^I notice/,'The scene shows')};
  const client={interactions:{create:async value=>{
    attempts+=1;
    prompts.push(value.input[1].text);
    return{output_text:JSON.stringify(attempts===1?invalidStory:modelStory)};
  }}};
  const result=await generateGeminiStory(input,{client});
  assert.equal(attempts,2);
  assert.equal(result.body,modelStory.body);
  assert.match(prompts[0],/first word must be "I" or "My"/);
  assert.match(prompts[0],/Do not use "you", "your", "people", "Muslims"/);
  assert.match(prompts[1],/previous response failed the required format or first-person safety check/i);
});

test('Gemini timeout is not shown as model content and is not retried',async()=>{
  let attempts=0;
  const client={interactions:{create:async()=>{attempts+=1;throw new Error('Request timed out');}}};
  await assert.rejects(()=>generateGeminiStory(input,{client}),error=>error.code==='GEMINI_TIMEOUT');
  assert.equal(attempts,1);
});
