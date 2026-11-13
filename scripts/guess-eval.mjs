// How good the held items' learned guesses are on marks placed by hand (src/domain/buddies/guess leaveOneOut): each placed frame
// guessed from all the other marks, against where it was placed. Run on the accessory placer's Copy, pasted into a file:
//
//   node scripts/guess-eval.mjs marks.json          a table: position off in the frame's own pixels, size off, tilt off
//   node scripts/guess-eval.mjs marks.json --json   the whole report, every mark's miss included
//
// The maths is the app's own file, as node runs it (type stripping); every buddy's shape is the placer's copy of the app's
// (guess.test checks it matches), so the numbers are the ones the app and the placer would land on.
import { readFileSync } from 'node:fs';
import { learnFrom, leaveOneOut } from '../src/domain/buddies/guess.ts';

const [file, flag] = process.argv.slice(2);
if (!file) {
  console.error('Usage: node scripts/guess-eval.mjs marks.json [--json]   (marks.json: the accessory placer’s Copy)');
  process.exit(2);
}
const page = readFileSync(new URL('../public/tools/accessory-placer.html', import.meta.url), 'utf8');
const line = page.split('\n').find((l) => l.startsWith('const APP = '));
const { world, buddies } = JSON.parse(line.slice('const APP = '.length, -1));
const marks = learnFrom(JSON.parse(readFileSync(file, 'utf8')), world);
const report = leaveOneOut(marks, world);
if (flag === '--json') {
  console.log(JSON.stringify(report, null, 2));
  process.exit(0);
}

const name = (id) => buddies.find((b) => b.id === id)?.name ?? id;
const row = (label, t) => [label.padEnd(14), String(t.n).padStart(5), t.pos.toFixed(2).padStart(10), `${(t.size * 100).toFixed(1)}%`.padStart(8), `${t.tilt.toFixed(1)}°`.padStart(8), String(t.flips).padStart(8)].join('');
console.log(`${report.n} marks on ${Object.keys(marks).length} buddies, each guessed from all the others.`);
if (!report.n) process.exit(0);
console.log(['how'.padEnd(14), 'marks'.padStart(5), 'pos (px)'.padStart(10), 'size'.padStart(8), 'tilt'.padStart(8), 'mirror'.padStart(8)].join(''));
console.log(row('all', report));
const LABEL = { own: 'same buddy', like: 'shaped like', pack: 'same pack', anchor: 'head anchor' };
for (const [how, t] of Object.entries(report.by)) if (t.n) console.log(row(LABEL[how], t));
console.log('\nFurthest off (position, the frame’s own pixels):');
for (const m of [...report.misses].sort((a, b) => b.pos - a.pos).slice(0, 10)) {
  const from = m.from.length && m.how !== 'own' ? ` (${m.from.map(name).join(', ')})` : '';
  console.log(`  ${name(m.id)} (${m.id}) ${world[m.id].strip === 'poses' ? 'pose' : 'frame'} ${m.f + 1}, ${LABEL[m.how]}${from}: ${m.pos.toFixed(2)} px, size ${(m.size * 100).toFixed(0)}%, tilt ${m.tilt.toFixed(0)}°${m.flip ? ', mirror wrong' : ''}`);
}
