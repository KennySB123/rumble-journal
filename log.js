// Append a checkpoint to content/stats.json.
//
//   npm run log -- <hours> <bp> [tier] [note...]
//   npm run log -- 12.5 340
//   npm run log -- 40 900 gold "first gold placement"
//   npm run log -- --date 2026-09-01 20 500 iron
//
// Dates default to today. Tier is one of the PORC tiers in content/site.json (case doesn't matter).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const STATS = path.join(ROOT, 'content', 'stats.json');
const site = JSON.parse(fs.readFileSync(path.join(ROOT, 'content', 'site.json'), 'utf8'));
const tiers = (site.porc?.tiers ?? []).map((t) => String(t).toLowerCase());

const args = process.argv.slice(2);
let date = new Date().toISOString().slice(0, 10);
const di = args.indexOf('--date');
if (di >= 0) { date = args[di + 1]; args.splice(di, 2); }

const usage = () => { console.error('usage: npm run log -- [--date YYYY-MM-DD] <hours> <bp> [tier] [note...]'); process.exit(1); };
if (args.length < 2 || !/^\d{4}-\d{2}-\d{2}$/.test(date ?? '')) usage();
const hours = Number(args[0]), bp = Number(args[1]);
if (Number.isNaN(hours) || Number.isNaN(bp)) usage();

let porc = null;
let rest = args.slice(2);
if (rest.length && tiers.includes(rest[0].toLowerCase())) { porc = rest[0].toLowerCase(); rest = rest.slice(1); }
else if (rest.length && /^[a-z]+$/i.test(rest[0]) && rest.length === 1 && !tiers.includes(rest[0].toLowerCase())) {
  console.error(`"${rest[0]}" is not a PORC tier. Expected one of: ${tiers.join(', ')}. (Quote multi-word notes.)`);
  process.exit(1);
}
const note = rest.join(' ').trim();

const stats = fs.existsSync(STATS) ? JSON.parse(fs.readFileSync(STATS, 'utf8')) : [];
const entry = { date, hours, bp, porc };
if (note) entry.note = note;
stats.push(entry);
stats.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.hours - b.hours));
fs.writeFileSync(STATS, '[\n' + stats.map((s) => '  ' + JSON.stringify(s)).join(',\n') + '\n]\n');
console.log(`logged ${date}: ${hours} h, ${bp} BP${porc ? ', ' + porc : ''}${note ? ' (' + note + ')' : ''} -> ${stats.length} checkpoints`);
