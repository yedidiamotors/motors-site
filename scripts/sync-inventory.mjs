#!/usr/bin/env node
/**
 * מושך את גיליון המלאי (Google Sheet שפורסם כ-CSV), מנרמל אותו
 * וכותב data/inventory.json — החוזה היחיד שהאתר קורא.
 *
 * כשנחליף מקור ל-Supabase, רק הקובץ הזה משתנה. האתר לא נוגע.
 *
 * הרצה: SHEET_CSV_URL="https://docs.google.com/.../pub?gid=0&single=true&output=csv" node scripts/sync-inventory.mjs
 */

import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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

/* ---------- קישורי Google Drive → כתובת שניתן להטמיע ---------- */

function driveId(url) {
  const patterns = [
    /\/file\/d\/([a-zA-Z0-9_-]{20,})/,
    /[?&]id=([a-zA-Z0-9_-]{20,})/,
    /\/d\/([a-zA-Z0-9_-]{20,})/,
  ];
  for (const p of patterns) {
    const m = url.match(p);
    if (m) return m[1];
  }
  return null;
}

function toImageUrl(raw, width = 1600) {
  const url = String(raw).trim();
  if (!/^https?:\/\//i.test(url)) return null;
  if (/drive\.google\.com|docs\.google\.com/.test(url)) {
    const id = driveId(url);
    // lh3 מגיש את הקובץ ישירות ותומך בהטמעה, בניגוד ל-/file/d/.../view
    return id ? `https://lh3.googleusercontent.com/d/${id}=w${width}` : null;
  }
  return url;
}

/* ---------- ראשי ---------- */

const res = await fetch(SHEET_CSV_URL, { redirect: 'follow' });
if (!res.ok) {
  console.error(`שגיאה במשיכת הגיליון: ${res.status} ${res.statusText}`);
  process.exit(1);
}
const rows = parseCSV(await res.text());
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

  const images = splitList(get(row, 'images')).map(u => toImageUrl(u)).filter(Boolean);
  const year = toNumber(get(row, 'year'));

  vehicles.push({
    id: get(row, 'id') || `${make}-${model}-${year ?? 'x'}-${lineNo}`.replace(/\s+/g, '-'),
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
    images,
  });
});

const payload = {
  updated_at: new Date().toISOString(),
  source: 'google-sheet',
  count: vehicles.length,
  vehicles,
};

mkdirSync(dirname(OUT), { recursive: true });

// כותבים רק אם משהו מהותי השתנה — כדי לא ליצור commit על כל הרצה
const next = JSON.stringify(payload, null, 2) + '\n';
if (existsSync(OUT)) {
  const prev = JSON.parse(readFileSync(OUT, 'utf8'));
  if (JSON.stringify(prev.vehicles) === JSON.stringify(payload.vehicles)) {
    console.log(`אין שינוי במלאי (${vehicles.length} רכבים). לא נכתב קובץ.`);
    process.exit(0);
  }
}

writeFileSync(OUT, next);
console.log(`נכתבו ${vehicles.length} רכבים ל-data/inventory.json`);
if (skipped.length) {
  console.log(`דולגו ${skipped.length} שורות:`);
  skipped.slice(0, 20).forEach(s => console.log(`  שורה ${s.line}: ${s.reason}`));
}
