/**
 * תמונת מודעה לכל רכב — assets/vehicles/<id>/share.jpg (1200×630, JPEG ≤ ~250KB).
 *
 * זו התמונה שוואטסאפ, פייסבוק וטלגרם מציגים כשמדביקים את קישור עמוד הרכב (og:image),
 * וגם קובץ מוכן להורדה למי שרוצה לפרסם מודעה ידנית.
 * נבנית ב-ImageMagick: התמונה הראשונה של הרכב (או תמונת ברירת המחדל), הכהיה מלמטה,
 * לוגו, ושלוש שורות טקסט. עברית מצוירת בסדר ויזואלי (bidi ידני) כי ImageMagick
 * ללא pango מצייר לפי סדר לוגי. נוסף 11/09/2026.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';

const W = 1200, H = 630;
const FONT_CANDIDATES = [
  '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
  '/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf',
  'DejaVu-Sans-Bold',
];
const FONT = FONT_CANDIDATES.find(f => !f.startsWith('/') || existsSync(f));
const DEFAULT_BG = 'assets/design/default-showroom.webp';   // רכב בלי תמונות: האולם, מוכהה — לא רכב אחר שיטעה
const LOGO = 'assets/design/logo.webp';

/* ---------- bidi פשוט: לוגי → ויזואלי לפסקה RTL ---------- */
const isHeb = ch => /[\u0590-\u05FF]/.test(ch);
const isLtr = ch => /[A-Za-z0-9]/.test(ch);
export function bidiVisual(text) {
  // מחלקים לריצות: R (עברית), L (לטינית/ספרות), N (ניטרלי)
  const runs = [];
  for (const ch of text) {
    const t = isHeb(ch) ? 'R' : isLtr(ch) ? 'L' : 'N';
    const last = runs[runs.length - 1];
    if (last && last.t === t) last.s += ch; else runs.push({ t, s: ch });
  }
  // ניטרלי בין שתי ריצות L → L; אחרת (פסקה RTL) → R
  for (let i = 0; i < runs.length; i++) {
    if (runs[i].t !== 'N') continue;
    const prev = runs[i - 1], next = runs[i + 1];
    runs[i].t = (prev && prev.t === 'L' && next && next.t === 'L') ? 'L' : 'R';
  }
  // מאחדים ריצות סמוכות מאותו סוג
  const merged = [];
  for (const r of runs) { const last = merged[merged.length - 1]; if (last && last.t === r.t) last.s += r.s; else merged.push({ ...r }); }
  // ויזואלי: סדר הריצות הפוך; ריצת R הפוכה תו-תו, ריצת L נשארת
  return merged.reverse().map(r => r.t === 'R' ? [...r.s].reverse().join('') : r.s).join('');
}

const STATUS_HE = { available: 'זמין במלאי', in_transit: 'בדרך לארץ', sold: 'נמכר' };
const esc = s => String(s == null ? '' : s).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/%/g, '%%').replace(/@/g, '\\@');

function fitPointsize(text, maxWidth, maxPt, charW = 0.7) {
  const n = Math.max(1, String(text).length);
  return Math.max(22, Math.min(maxPt, Math.floor(maxWidth / (charW * n))));
}

export function shareLines(v) {
  const make = String(v.make || '').toUpperCase();
  const model = String(v.model || '').toUpperCase();
  const line1 = [make, v.year].filter(Boolean).join('  ·  ');
  const bits = [v.condition, v.color, (v.features || [])[0]].filter(Boolean);
  const line3 = bits.join(' · ');
  const line4 = 'ידידיה מוטורס · קרית אתא · 04-8419413';
  return { line1, model, line3, line4, status: STATUS_HE[v.status] || '' };
}

export function buildShareImage({ root, vehicle, srcPath, outPath }) {
  const hasPhoto = !!(srcPath && existsSync(srcPath));
  const src = hasPhoto ? srcPath : resolve(root, DEFAULT_BG);
  const logo = resolve(root, LOGO);
  const L = shareLines(vehicle);
  if (!hasPhoto) L.line3 = [L.line3, 'תמונות הרכב בפנייה'].filter(Boolean).join(' · ');
  const modelPt = fitPointsize(L.model, W - 120, 64);
  const tmp = join(tmpdir(), `share-${vehicle.id}-${process.pid}.jpg`);

  const args = [
    src, '-auto-orient', '-resize', `${W}x${H}^`, '-gravity', 'center', '-extent', `${W}x${H}`,
    ...(hasPhoto ? [] : ['-fill', 'black', '-colorize', '45%']),
    // הכהיה: מלמטה ומעט מלמעלה (ללוגו)
    '(', '-size', `${W}x${Math.round(H * 0.62)}`, 'gradient:rgba(0,0,0,0)-rgba(0,0,0,0.9)', ')', '-gravity', 'south', '-composite',
    '(', '-size', `${W}x120`, 'gradient:rgba(0,0,0,0.55)-rgba(0,0,0,0)', ')', '-gravity', 'north', '-composite',
  ];
  if (existsSync(logo)) args.push('(', logo, '-resize', '230x', ')', '-gravity', 'northeast', '-geometry', '+44+34', '-composite');
  args.push(
    '-font', FONT, '-gravity', 'southeast',
    '-fill', '#ddb838', '-pointsize', '30', '-annotate', `+56+${56 + 34 + 28 + modelPt + 30 + 22}`, esc(L.line1),
    '-fill', 'white', '-pointsize', String(modelPt), '-annotate', `+56+${56 + 34 + 28 + 30}`, esc(L.model),
    '-fill', '#f5f5f3', '-pointsize', '32', '-annotate', `+56+${56 + 34 + 8}`, esc(bidiVisual(L.line3)),
    '-fill', '#ddb838', '-pointsize', '26', '-annotate', '+56+56', esc(bidiVisual(L.line4)),
  );
  if (L.status) {
    const s = bidiVisual(L.status);
    args.push('-gravity', 'northwest', '-fill', vehicle.status === 'sold' ? '#B03A2E' : '#c9a227',
      '-draw', `roundrectangle 44,40 ${44 + 24 + s.length * 17},96 10,10`,
      '-fill', vehicle.status === 'sold' ? 'white' : '#0b0b0c', '-pointsize', '28', '-annotate', '+56+52', esc(s));
  }
  args.push('-strip', '-interlace', 'Plane', '-sampling-factor', '4:2:0', '-quality', '80', tmp);
  execFileSync('convert', args, { stdio: ['ignore', 'ignore', 'pipe'] });

  // מחליפים את הקובץ רק אם השתנה — אחרת כל הרצה של ה-Action הייתה יוצרת commit
  const fresh = readFileSync(tmp);
  const same = existsSync(outPath) && Buffer.compare(readFileSync(outPath), fresh) === 0;
  if (!same) { mkdirSync(resolve(outPath, '..'), { recursive: true }); writeFileSync(outPath, fresh); }
  rmSync(tmp, { force: true });
  return { path: outPath, bytes: fresh.length, changed: !same };
}

export function buildShareImages({ root, vehicles, log = console.log }) {
  let built = 0, changed = 0, failed = 0;
  for (const v of vehicles) {
    try {
      const first = (v.images || [])[0];
      const srcPath = first ? resolve(root, '.' + first) : null;
      const out = resolve(root, 'assets/vehicles', v.id, 'share.jpg');
      const r = buildShareImage({ root, vehicle: v, srcPath, outPath: out });
      built++; if (r.changed) changed++;
      v.share_image = `/assets/vehicles/${v.id}/share.jpg`;
    } catch (e) {
      failed++;
      log(`תמונת מודעה נכשלה ל-${v.id}: ${String(e.message || e).slice(0, 200)}`);
    }
  }
  log(`תמונות מודעה: ${built} נבנו, ${changed} השתנו, ${failed} נכשלו.`);
  return { built, changed, failed };
}
