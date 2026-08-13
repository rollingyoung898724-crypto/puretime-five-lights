import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html=readFileSync('index.html','utf8');
const serviceWorker=readFileSync('service-worker.js','utf8');

test('existing LocalStorage, First Return, lights, Sadaqah, calendar and Basic Reflection boundaries remain present',()=>{
  for(const marker of [
    "sadaqahBoxStandaloneV2","firstReturnCompleted","returnSystem_missedPrayerStatus_v1",
    'function renderPrayerLights','function renderCalendar','function generateLocalReturnStory',
    'state.records','state.actions','state.prayerStatus','Basic Reflection'
  ]) assert.equal(html.includes(marker),true,`Missing compatibility marker: ${marker}`);
});

test('offline shell remains cached while API responses are network-only',()=>{
  for(const asset of ['/index.html','/manifest.json','/icons/icon-192.png','/icons/icon-512.png']) assert.equal(serviceWorker.includes(asset),true);
  assert.equal(serviceWorker.includes("pathname.startsWith('/api/')"),true);
  assert.equal(serviceWorker.includes('`${CACHE_PREFIX}v7`'),true);
});
