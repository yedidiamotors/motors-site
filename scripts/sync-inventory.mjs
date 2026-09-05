#!/usr/bin/env node
/**
 * מושך את גיליון המלאי (CSV מ-n8n או מגוגל), מנרמל אותו,
 * מוריד וממיר את תמונות הרכבים, וכותב data/inventory.json —
 * החוזה היחיד שהאתר קורא.
 *
 * כשנחליף מקור ל-Supabase, רק הקובץ הזה משתנה. האתר לא נוגע.
 *
 * הרצה: SHEET_CSV_URL="https://.../webhook/inventory.csv?key=..." node scripts/sync-inventory.mjs
 */

import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { processImages, processSiteImages, imageProxyBase } from './images.mjs';
import { buildSeo } from './seo.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'data/inventory.json');

const SHEET_CSV_URL = process.env.SHEET_CSV_URL;
if (!SHEET_CSV_URL) {
  console.error('חסר SHEET_CSV_URL. הגדר אותו כ-repository variable ב-GitHub.');
  process.exit(1);
}

/* ---------- CSV ---------- */

function parseCSV(text) {
  // מסיר BOM
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"') { quoted = true; continue; }
    if (c === ',') { row.push(field); field = ''; continue; }
    if (c === '\r') continue;
    if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue; }
    field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => r.some(c => c.trim() !== ''));
}

/* ---------- מיפוי כותרות ---------- */

const HEADERS = {
  id:          ['מזהה', 'id', 'vin', 'קוד'],
  make:        ['יצרן', 'make', 'מותג'],
  model:       ['דגם', 'model'],
  year:        ['שנה', 'שנת יצור', 'שנתון', 'year'],
  trim:        ['גימור', 'רמת גימור', 'trim'],
  color:       ['צבע', 'color'],
  km:          ['קילומטראז׳', 'קילומטראז', 'ק"מ', 'קמ', 'km', 'mileage'],
  price:       ['מחיר', 'price'],
  currency:    ['מטבע', 'currency'],
  status:      ['סטטוס', 'status', 'מצב'],
  condition:   ['מצב הרכב', 'חדש/יד שנייה', 'condition'],
  engine:      ['מנוע', 'engine'],
  drivetrain:  ['הנעה', 'drivetrain'],
  features:    ['אביזרים', 'תוספות', 'features'],
  description: ['תיאור', 'description', 'הערות'],
  images:      ['תמונות', 'images', 'קישורי תמונות', 'תמונה'],
  publish:     ['הצג', 'הצג באתר', 'פרסום', 'publish', 'show'],
};

const norm = s => String(s ?? '').trim().toLowerCase().replace(/[\s_]+/g, '');

function buildIndex(headerRow) {
  const idx = {};
  headerRow.forEach((raw, i) => {
    const h = norm(raw);
    for (const [key, aliases] of Object.entries(HEADERS)) {
      if (idx[key] !== undefined) continue;
      if (aliases.some(a => norm(a) === h)) idx[key] = i;
    }
  });
  return idx;
}

/* ---------- נרמול ערכים ---------- */

const clean = v => {
  const s = String(v ?? '').trim();
  return s === '' ? null : s;
};

const toNumber = v => {
  const s = String(v ?? '').replace(/[^\d.\-]/g, '');
  if (s === '' || s === '-') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

const TRUTHY = new Set(['כן', 'yes', 'true', '1', 'v', 'x', '✓', 'כ']);
const isTrue = v => TRUTHY.has(String(v ?? '').trim().toLowerCase());

const STATUS = {
  'זמין': 'available', 'במלאי': 'available', 'available': 'available',
  'בדרך': 'in_transit', 'בהזמנה': 'in_transit', 'בשילוח': 'in_transit', 'intransit': 'in_transit',
  'נמכר': 'sold', 'sold': 'sold',
};
const toStatus = v => STATUS[norm(v)] ?? (clean(v) ? 'available' : 'available');

const splitList = v =>
  String(v ?? '')
    .split(/[,\n;|]+/)
    .map(s => s.trim())
    .filter(Boolean);

/* ---------- תמונות: מזהי קבצים בדרייב ---------- */

function driveId(raw) {
  const s = String(raw).trim();
  const m0 = s.match(/^drive:([a-zA-Z0-9_-]{20,})$/);
  if (m0) return m0[1];
  const patterns = [
    /\/file\/d\/([a-zA-Z0-9_-]{20,})/,
    /[?&]id=([a-zA-Z0-9_-]{20,})/,
    /\/d\/([a-zA-Z0-9_-]{20,})/,
  ];
  for (const p of patterns) {
    const m = s.match(p);
    if (m) return m[1];
  }
  return null;
}

/* ---------- ראשי ---------- */

const res = await fetch(SHEET_CSV_URL, { redirect: 'follow' });
if (!res.ok) {
  console.error(`שגיאה במשיכת הגיליון: ${res.status} ${res.statusText}`);
  process.exit(1);
}
const csvText = await res.text();
// הגנה: אם המקור הוחלף/נפרץ ומחזיר משהו אחר לגמרי — לא נוגעים באתר
if (csvText.length > 5 * 1024 * 1024 || /^\s*<(!doctype|html)/i.test(csvText)) {
  console.error('התשובה מהמקור לא נראית כמו CSV של מלאי (גדולה מדי או HTML). לא נכתב דבר.');
  process.exit(1);
}
const rows = parseCSV(csvText);
if (rows.length < 2) {
  console.error('הגיליון ריק או מכיל שורת כותרות בלבד.');
  process.exit(1);
}

const idx = buildIndex(rows[0]);
const missing = ['make', 'model'].filter(k => idx[k] === undefined);
if (missing.length) {
  console.error(`חסרות עמודות חובה בגיליון: ${missing.join(', ')} (יצרן, דגם)`);
  process.exit(1);
}

const get = (row, key) => (idx[key] === undefined ? null : clean(row[idx[key]]));

const vehicles = [];
const skipped = [];

rows.slice(1).forEach((row, i) => {
  const make = get(row, 'make');
  const model = get(row, 'model');
  const lineNo = i + 2;

  if (!make || !model) { skipped.push({ line: lineNo, reason: 'חסר יצרן או דגם' }); return; }
  if (idx.publish !== undefined && !isTrue(row[idx.publish])) {
    skipped.push({ line: lineNo, reason: 'לא מסומן להצגה' });
    return;
  }

  const imageIds = [...new Set(splitList(get(row, 'images')).map(driveId).filter(Boolean))];
  const year = toNumber(get(row, 'year'));

  // המזהה הופך לשם תיקייה ברפו (assets/vehicles/<id>, stock/<id>) — רק תווים בטוחים
  const safeId = String(get(row, 'id') || `${make}-${model}-${year ?? 'x'}-${lineNo}`)
    .replace(/\s+/g, '-').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 80);
  if (!safeId) { skipped.push({ line: lineNo, reason: 'מזהה לא תקין' }); return; }

  vehicles.push({
    id: safeId,
    make,
    model,
    year: year && year > 1950 && year < 2100 ? year : null,
    trim: get(row, 'trim'),
    color: get(row, 'color'),
    km: toNumber(get(row, 'km')),
    price: toNumber(get(row, 'price')),
    currency: (get(row, 'currency') || 'ILS').toUpperCase(),
    status: toStatus(get(row, 'status')),
    condition: get(row, 'condition'),
    engine: get(row, 'engine'),
    drivetrain: get(row, 'drivetrain'),
    features: splitList(get(row, 'features')),
    description: get(row, 'description'),
    imageIds,
    images: [],
  });
});

/* ---------- המרת התמונות ואחסונן ברפו ---------- */

const prev = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : null;
const prevImages = new Map((prev?.vehicles || []).map(v => [v.id, v.images || []]));

const processed = await processImages({
  root: ROOT,
  vehicles,
  proxyBase: imageProxyBase(SHEET_CSV_URL),
});

// תמונות העיצוב של האתר (מימון, יד שנייה, אולם...) — מתיקיית "תמונות אתר/אתר"
await processSiteImages({ root: ROOT, proxyBase: imageProxyBase(SHEET_CSV_URL) });

for (const v of vehicles) {
  // אם שלב התמונות לא רץ, לא מוחקים את מה שכבר קיים ברפו
  v.images = processed ? (processed[v.id] || []) : (prevImages.get(v.id) || []);
  delete v.imageIds;
}

const payload = {
  updated_at: new Date().toISOString(),
  source: 'google-sheet',
  count: vehicles.length,
  vehicles,
};

mkdirSync(dirname(OUT), { recursive: true });

// אם המלאי לא השתנה, שומרים על חותמת הזמן הקודמת — אחרת כל הרצה
// הייתה מייצרת sitemap ו-llms.txt חדשים ו-commit מיותר כל חצי שעה.
const unchanged = prev && JSON.stringify(prev.vehicles) === JSON.stringify(payload.vehicles);
if (unchanged) payload.updated_at = prev.updated_at;

// עמודי הרכבים, ה-sitemap ו-llms.txt נבנים בכל הרצה, גם כשאין שינוי —
// כך שינוי בתבנית מתפשט לכל העמודים בלי להמתין לשינוי במלאי.
buildSeo({ root: ROOT, payload });

const next = JSON.stringify(payload, null, 2) + '\n';
if (unchanged) {
  console.log(`אין שינוי במלאי (${vehicles.length} רכבים).`);
  process.exit(0);
}

writeFileSync(OUT, next);
console.log(`נכתבו ${vehicles.length} רכבים ל-data/inventory.json`);
if (skipped.length) {
  console.log(`דולגו ${skipped.length} שורות:`);
  skipped.slice(0, 20).forEach(s => console.log(`  שורה ${s.line}: ${s.reason}`));
}
