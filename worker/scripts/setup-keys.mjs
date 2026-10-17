#!/usr/bin/env node
// One-time setup, run by the owner from worker/ after `npx wrangler login` and the first `npx wrangler deploy`:
//
//   npm run setup-keys -- https://gym-tracker-push.<your-subdomain>.workers.dev
//
// 1. Makes a VAPID key pair with `npx @pushforge/builder vapid`, capturing its output (nothing is printed).
// 2. Pipes the private key straight into `wrangler secret put VAPID_PRIVATE_JWK`. It never reaches the screen or a file.
// 3. Writes the Worker URL and the public key (not secret) into ../src/push/config.ts, and prints the public key.
//
// Run it again with just a URL to change the URL only. --rotate makes new keys (every phone then has to turn
// notifications on again). --dry-run does everything except storing the secret and writing the file.
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const dry = args.includes('--dry-run'), rotate = args.includes('--rotate');
const url = args.find((a) => !a.startsWith('--'))?.replace(/\/+$/, '');
const configPath = fileURLToPath(new URL('../../src/push/config.ts', import.meta.url));
const fail = (msg) => { console.error(`\n✗ ${msg}`); process.exit(1); };

if (url && !/^https:\/\/[a-z0-9-]+(\.[a-z0-9-]+)*\.workers\.dev$/.test(url) && !/^https:\/\/[a-z0-9.-]+$/.test(url)) fail(`That doesn't look like the Worker's URL: ${url}`);

let config = readFileSync(configPath, 'utf8');
const urlLine = /(export const WORKER_URL: string = __PUSH_TEST_WORKER_URL__ \|\| )'[^']*';/;
const keyLine = /(export const VAPID_PUBLIC_KEY: string = __PUSH_TEST_VAPID_KEY__ \|\| )'([^']*)';/;
if (!urlLine.test(config) || !keyLine.test(config)) fail('src/push/config.ts has changed shape; fill it in by hand (see SETUP.md).');
const hasKey = keyLine.exec(config)[2] !== '';

let publicKey = hasKey ? keyLine.exec(config)[2] : null;
if (!hasKey || rotate) {
  // stdout is captured, never shown: it holds the private key.
  const gen = spawnSync('npx --yes @pushforge/builder@2.0.5 vapid', { shell: true, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
  if (gen.status !== 0) fail('Generating the keys failed (needs Node 20+ and the network for npx).');
  const out = gen.stdout;
  publicKey = /Public Key:\s*\n\s*(B[A-Za-z0-9_-]{86})\s*\n/.exec(out)?.[1];
  const jwkText = /Private Key \(JWK\):\s*\n\s*(\{.*\})\s*\n/.exec(out)?.[1];
  let jwk;
  try { jwk = JSON.parse(jwkText ?? ''); } catch { /* checked below */ }
  if (!publicKey || !jwk || jwk.kty !== 'EC' || jwk.crv !== 'P-256' || !jwk.d) fail("Couldn't read pushforge's output; nothing was stored.");
  const derived = Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x, 'base64url'), Buffer.from(jwk.y, 'base64url')]).toString('base64url');
  if (derived !== publicKey) fail("The public key doesn't match the private key; nothing was stored.");

  if (dry) console.log('Dry run: would store the private key with `wrangler secret put VAPID_PRIVATE_JWK` (not shown).');
  else {
    console.log('Storing the private key as the Worker secret VAPID_PRIVATE_JWK…');
    const put = spawnSync('npx wrangler secret put VAPID_PRIVATE_JWK', { shell: true, input: JSON.stringify(jwk), stdio: ['pipe', 'inherit', 'inherit'] });
    if (put.status !== 0) fail('wrangler secret put failed. Did `npx wrangler login` and `npx wrangler deploy` run first? config.ts is unchanged.');
  }
}

config = config.replace(keyLine, `$1'${publicKey}';`);
if (url) config = config.replace(urlLine, `$1'${url}';`);
if (dry) console.log('Dry run: config.ts not written.');
else writeFileSync(configPath, config);

console.log(`\nPublic key (not secret): ${publicKey}`);
console.log(`Worker URL: ${url ?? '(unchanged)'}`);
console.log(dry ? '' : '\nsrc/push/config.ts now has both. Commit and push it (SETUP.md, last step).');
