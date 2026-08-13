import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import vm from 'node:vm';

const roots = ['api', 'lib', 'scripts', 'tests'];
const files = [];
function collect(path) {
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const target = join(path, entry.name);
    if (entry.isDirectory()) collect(target);
    else if (/\.(?:js|mjs)$/.test(entry.name)) files.push(target);
  }
}
roots.forEach(collect);
files.push('service-worker.js');

for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`${file}: ${result.stderr}`);
}

const html = readFileSync('index.html', 'utf8');
const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)];
if (scripts.length !== 1) throw new Error('Expected one inline application script.');
new vm.Script(scripts[0][1], { filename: 'index-inline.js' });

const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map(match => match[1]);
const duplicates = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
if (duplicates.length) throw new Error(`Duplicate HTML ids: ${duplicates.join(', ')}`);

const sw = readFileSync('service-worker.js', 'utf8');
if (!sw.includes("pathname.startsWith('/api/')")) throw new Error('Service Worker must keep /api/ network-only.');
console.log(`Checked ${files.length} JavaScript files, inline app JavaScript, HTML ids, and PWA API policy.`);
