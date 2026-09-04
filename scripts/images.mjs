/**
 * צינור התמונות: מוריד את המקור מדרייב דרך ה-proxy ב-n8n, ממיר ל-WebP
 * ומטביע לוגו עדין בפינה. התוצאה נשמרת ברפו תחת assets/vehicles/<id>/
 * כדי שהתיקייה בדרייב תישאר פרטית ולגולש לא תהיה תלות בהרשאות גוגל.
 *
 * העיבוד נעשה ב-ImageMagick, שמותקן מראש על ubuntu-latest וקורא גם HEIC.
 */

import { mkdirSync, existsSync, writeFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';

export const ASSET_DIR = 'assets/vehicles';
const WATERMARK_FILE = 'assets/watermark.png';

// "לוגו חתימה במייל.png" בדרייב
const LOGO_FILE_ID = '1KvsmM_-ZwTXFHB7V8UAQUE7-vK2qMsw6';

const MAX_WIDTH = 1400;
const WEBP_QUALITY = 78;
const WM_WIDTH_RATIO = 0.22;   // רוחב הלוגו ביחס לרוחב התמונה
const WM_OPACITY = 0.42;
const WM_MARGIN_RATIO = 0.03;

const IM = process.env.IM_CONVERT || 'convert';
const IDENTIFY = process.env.IM_IDENTIFY || 'identify';

const run = (bin, args) => execFileSync(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();

/** בונה את כתובת ה-proxy מתוך SHEET_CSV_URL — אותו host, אותו מפתח. */
export function imageProxyBase(sheetCsvUrl) {
  try {
    const u = new URL(sheetCsvUrl);
    const key = u.searchParams.get('key');
    if (!key || !/\/webhook\//.test(u.pathname)) return null;
    return `${u.origin}${u.pathname.replace(/[^/]+$/, 'inventory-image')}?key=${encodeURIComponent(key)}&id=`;
  } catch {
    return null;
  }
}

async function fetchToFile(url, dest) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
  return dest;
}

/**
 * הופך את קובץ הלוגו (טקסט על רקע אחיד בהיר) לחותמת לבנה עם שקיפות:
 * האלפא נגזרת מהמרחק מצבע הרקע, כך שהרקע נעלם והאותיות נשארות.
 */
export function buildWatermark(logoPath, outPath) {
  const flat = outPath + '.flat';
  run(IM, [logoPath + '[0]', '-alpha', 'remove', '-alpha', 'off', '-colorspace', 'sRGB', 'miff:' + flat]);
  const bg = run(IDENTIFY, ['-format', '%[pixel:p{0,0}]', 'miff:' + flat]);
  // האלפא = המרחק מצבע הרקע. נקודת השחור מנטרלת גרדיאנט עדין ברקע,
  // כך שנשארות רק האותיות ולא ריבוע אפרפר סביבן.
  run(IM, [
    'miff:' + flat,
    '(', '+clone', '-fill', bg, '-colorize', '100', ')',
    '-compose', 'difference', '-composite',
    '-colorspace', 'gray', '-auto-level', '-level', '14%,60%',
    'miff:' + outPath + '.mask',
  ]);
  rmSync(flat, { force: true });
  const size = run(IDENTIFY, ['-format', '%wx%h', 'miff:' + outPath + '.mask']);
  run(IM, [
    '-size', size, 'xc:white',
    'miff:' + outPath + '.mask',
    '-alpha', 'off', '-compose', 'copy_opacity', '-composite',
    '-trim', '+repage',
    'png:' + outPath,
  ]);
  rmSync(outPath + '.mask', { force: true });
  return outPath;
}

export function convertOne(srcPath, watermarkPath, destPath) {
  const tmp = join(tmpdir(), `ym-${process.pid}-${Math.random().toString(36).slice(2)}.miff`);
  try {
    run(IM, [srcPath + '[0]', '-auto-orient', '-resize', `${MAX_WIDTH}x${MAX_WIDTH}>`, 'miff:' + tmp]);
    const w = Number(run(IDENTIFY, ['-format', '%w', tmp]));
    const wmW = Math.max(120, Math.round(w * WM_WIDTH_RATIO));
    const margin = Math.max(8, Math.round(w * WM_MARGIN_RATIO));
    run(IM, [
      tmp,
      '(', watermarkPath, '-resize', `${wmW}x`, '-alpha', 'set',
      '-channel', 'A', '-evaluate', 'multiply', String(WM_OPACITY), '+channel', ')',
      '-gravity', 'southeast', '-geometry', `+${margin}+${margin}`, '-composite',
      '-strip', '-quality', String(WEBP_QUALITY), 'webp:' + destPath,
    ]);
  } finally {
    rmSync(tmp, { force: true });
  }
  return destPath;
}

async function loadWatermark(root, proxyBase) {
  const cached = resolve(root, WATERMARK_FILE);
  if (existsSync(cached)) return cached;
  mkdirSync(resolve(root, 'assets'), { recursive: true });
  const logo = join(tmpdir(), `ym-logo-${process.pid}.png`);
  await fetchToFile(proxyBase + LOGO_FILE_ID, logo);
  buildWatermark(logo, cached);
  rmSync(logo, { force: true });
  return cached;
}

/**
 * מקבל את רשימת הרכבים (עם imageIds — מזהי קבצים בדרייב) ומחזיר
 * מפה של vehicleId → מערך נתיבים מקומיים. תמונה שכבר הומרה לא מומרת שוב.
 * מחזיר null אם השלב לא יכול לרוץ — ואז הקורא משאיר את מה שכבר קיים ברפו.
 */
export async function processImages({ root, vehicles, proxyBase, log = console.log }) {
  if (!proxyBase) {
    log('אין proxy לתמונות (SHEET_CSV_URL אינו webhook עם key) — מדלג על עיבוד התמונות.');
    return null;
  }
  try {
    run(IM, ['-version']);
  } catch {
    log('ImageMagick לא זמין — מדלג על עיבוד התמונות.');
    return null;
  }

  let watermarkPath;
  try {
    watermarkPath = await loadWatermark(root, proxyBase);
  } catch (e) {
    log(`לא הצלחתי לבנות את חותמת הלוגו (${e.message}) — מדלג על עיבוד התמונות.`);
    return null;
  }

  const result = {};
  let converted = 0, reused = 0, failed = 0;

  for (const v of vehicles) {
    const ids = v.imageIds || [];
    if (!ids.length) continue;
    const dir = resolve(root, ASSET_DIR, v.id);
    mkdirSync(dir, { recursive: true });
    const paths = [];

    for (const id of ids) {
      const file = `${id}.webp`;
      const dest = join(dir, file);
      if (existsSync(dest) && statSync(dest).size > 0) {
        reused++; paths.push(`/${ASSET_DIR}/${v.id}/${file}`); continue;
      }
      const tmp = join(tmpdir(), `ym-src-${process.pid}-${id}`);
      try {
        await fetchToFile(proxyBase + id, tmp);
        convertOne(tmp, watermarkPath, dest);
        converted++;
        paths.push(`/${ASSET_DIR}/${v.id}/${file}`);
      } catch (e) {
        failed++;
        rmSync(dest, { force: true });
        log(`  תמונה ${id} של ${v.id} נכשלה: ${String(e.message).split('\n')[0]}`);
      } finally {
        rmSync(tmp, { force: true });
      }
    }

    if (paths.length) result[v.id] = paths;
  }

  // ניקוי: תיקיות של רכבים שכבר לא במלאי, וקבצים שכבר לא משויכים
  const base = resolve(root, ASSET_DIR);
  if (existsSync(base)) {
    const live = new Set(vehicles.map(v => v.id));
    for (const name of readdirSync(base)) {
      const dir = join(base, name);
      if (!statSync(dir).isDirectory()) continue;
      if (!live.has(name)) { rmSync(dir, { recursive: true, force: true }); continue; }
      const keep = new Set((result[name] || []).map(p => p.split('/').pop()));
      for (const f of readdirSync(dir)) if (!keep.has(f)) rmSync(join(dir, f), { force: true });
      if (!readdirSync(dir).length) rmSync(dir, { recursive: true, force: true });
    }
  }

  log(`תמונות: ${converted} הומרו, ${reused} כבר היו, ${failed} נכשלו.`);
  return result;
}
