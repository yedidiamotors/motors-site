/**
 * בונה את שכבת ה-SEO וה-AI מתוך data/inventory.json:
 *   • sitemap.xml
 *   • llms.txt — סיכום קריא של העסק והמלאי, למנועי AI שלא מריצים JS
 *   • /stock/<מזהה>/index.html — עמוד לכל רכב, עם Car schema
 *   • רשימה סטטית בתוך /stock/index.html, כך שסורק בלי JS רואה את המלאי
 *
 * הכל נגזר מהמלאי בלבד — אין כאן טקסט שיווקי שלא מגובה בנתונים.
 */

import { writeFileSync, readFileSync, mkdirSync, existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';

export const SITE = 'https://www.yedidia-motors.com';

export const BIZ = {
  name: 'ידידיה מוטורס',
  nameEn: 'Yedidia Motors',
  street: 'המעפילים 1',
  city: 'קרית אתא',
  country: 'IL',
  phone: '+972-50-899-1090',
  phoneHe: '050-899-1090',
  whatsapp: 'https://wa.me/972508991090',
  facebook: 'https://www.facebook.com/Yedidia.Motors',
  maps: 'https://maps.google.com/?q=' + encodeURIComponent('המעפילים 1 קרית אתא'),
  hours: [
    { days: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Sunday'], opens: '09:00', closes: '18:00' },
    { days: ['Friday'], opens: '09:00', closes: '13:00' },
  ],
  hoursHe: 'א׳–ה׳ 9:00–18:00 · ו׳ 9:00–13:00 · שבת סגור',
  // מותגים שהסוכנות מספקת ביבוא מקביל — לא כולם במלאי בכל רגע נתון
  brands: ['GMC', 'RAM', 'Mercedes-Benz', 'BMW', 'Chevrolet', 'Cadillac', 'Jeep', 'Ford'],
};

const STATUS_HE = { available: 'זמין', in_transit: 'בדרך', sold: 'נמכר' };
const AVAILABILITY = {
  available: 'https://schema.org/InStock',
  in_transit: 'https://schema.org/PreOrder',
  sold: 'https://schema.org/SoldOut',
};

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = n => new Intl.NumberFormat('he-IL').format(n);

export const vehicleUrl = v => `${SITE}/stock/${encodeURIComponent(v.id)}/`;

export function vehicleTitle(v) {
  return [v.make, v.model, v.year].filter(Boolean).join(' ');
}

function vehicleDescription(v) {
  const bits = [
    v.condition,
    v.color,
    v.km != null && v.km > 0 ? num(v.km) + ' ק״מ' : null,
    ...(v.features || []),
    v.description,
  ].filter(Boolean);
  const head = `${vehicleTitle(v)} ${v.status === 'sold' ? 'שנמכר' : 'למכירה'} בידידיה מוטורס, ${BIZ.street}, ${BIZ.city}.`;
  return (head + ' ' + bits.join(' · ')).replace(/\s+/g, ' ').trim().slice(0, 300);
}

/* ---------- JSON-LD ---------- */

export function dealerLd() {
  return {
    '@context': 'https://schema.org',
    '@type': 'AutoDealer',
    '@id': SITE + '/#dealer',
    name: BIZ.name,
    alternateName: BIZ.nameEn,
    url: SITE + '/',
    telephone: BIZ.phone,
    address: {
      '@type': 'PostalAddress',
      streetAddress: BIZ.street,
      addressLocality: BIZ.city,
      addressCountry: BIZ.country,
    },
    openingHoursSpecification: BIZ.hours.map(h => ({
      '@type': 'OpeningHoursSpecification',
      dayOfWeek: h.days,
      opens: h.opens,
      closes: h.closes,
    })),
    sameAs: [BIZ.facebook],
    brand: BIZ.brands.map(b => ({ '@type': 'Brand', name: b })),
    areaServed: { '@type': 'Country', name: 'Israel' },
  };
}

function vehicleLd(v) {
  const ld = {
    '@context': 'https://schema.org',
    '@type': 'Car',
    name: vehicleTitle(v),
    url: vehicleUrl(v),
    brand: { '@type': 'Brand', name: v.make },
    model: v.model,
    itemCondition: v.condition && /יד שני/.test(v.condition)
      ? 'https://schema.org/UsedCondition'
      : 'https://schema.org/NewCondition',
    offers: {
      '@type': 'Offer',
      availability: AVAILABILITY[v.status] || AVAILABILITY.available,
      priceCurrency: v.currency || 'ILS',
      seller: { '@id': SITE + '/#dealer' },
      url: vehicleUrl(v),
    },
  };
  if (v.year) ld.vehicleModelDate = String(v.year);
  if (v.color) ld.color = v.color;
  if (v.km != null) ld.mileageFromOdometer = { '@type': 'QuantitativeValue', value: v.km, unitCode: 'KMT' };
  if (v.description) ld.description = v.description;
  if (v.images && v.images.length) ld.image = v.images.map(p => SITE + p);
  return ld;
}

function breadcrumbLd(v) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'ידידיה מוטורס', item: SITE + '/' },
      { '@type': 'ListItem', position: 2, name: 'המלאי שלנו', item: SITE + '/stock/' },
      { '@type': 'ListItem', position: 3, name: vehicleTitle(v) },
    ],
  };
}

/* ---------- עמוד רכב ---------- */

function vehiclePage(v) {
  const title = `${vehicleTitle(v)}${v.color ? ' · ' + v.color : ''} | ${BIZ.name}`;
  const desc = vehicleDescription(v);
  const url = vehicleUrl(v);
  const specs = [
    ['יצרן', v.make], ['דגם', v.model], ['שנה', v.year], ['גימור', v.trim], ['צבע', v.color],
    ['קילומטראז׳', v.km != null ? num(v.km) + ' ק״מ' : null],
    ['מצב הרכב', v.condition], ['מנוע', v.engine], ['הנעה', v.drivetrain],
    ['סטטוס', STATUS_HE[v.status]], ['מזהה', v.id],
  ].filter(([, val]) => val !== null && val !== undefined && val !== '');

  const gallery = (v.images || []).map((src, i) =>
    `<img src="${esc(src)}" alt="${esc(vehicleTitle(v))} — תמונה ${i + 1}" width="1400" height="1050"${i ? ' loading="lazy"' : ''}>`
  ).join('\n      ');

  return `<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${esc(url)}">
<meta property="og:type" content="product">
<meta property="og:site_name" content="${esc(BIZ.name)}">
<meta property="og:locale" content="he_IL">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${esc(url)}">
${v.images && v.images[0] ? `<meta property="og:image" content="${esc(SITE + v.images[0])}">` : ''}
<meta name="twitter:card" content="${v.images && v.images.length ? 'summary_large_image' : 'summary'}">
<script type="application/ld+json">${JSON.stringify(vehicleLd(v))}</script>
<script type="application/ld+json">${JSON.stringify(breadcrumbLd(v))}</script>
<style>
  :root{--bg:#0b0b0c;--bg-2:#141416;--bg-3:#1b1b1e;--line:#2a2a2e;--fg:#f5f5f3;--muted:#a1a1aa;--gold:#c9a227}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--fg);font-family:"Heebo",system-ui,-apple-system,"Segoe UI",Arial,sans-serif;line-height:1.65}
  a{color:var(--gold)}
  img{max-width:100%;height:auto;display:block;border-radius:10px}
  .wrap{max-width:1000px;margin:0 auto;padding:0 20px}
  header,footer{border-bottom:1px solid var(--line)}
  footer{border-bottom:none;border-top:1px solid var(--line);margin-top:48px;padding:24px 0;color:var(--muted);font-size:14px}
  .bar{display:flex;justify-content:space-between;align-items:center;padding:18px 0;gap:16px;flex-wrap:wrap}
  .brand{text-decoration:none;color:inherit;font-weight:900}
  nav{font-size:14px;color:var(--muted)}
  h1{font-size:clamp(24px,4vw,38px);margin:26px 0 6px;letter-spacing:-.02em}
  .sub{color:var(--muted);margin:0 0 22px}
  .gal{display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));margin-bottom:28px}
  table{border-collapse:collapse;width:100%;max-width:560px}
  th,td{text-align:start;padding:9px 12px;border-bottom:1px solid var(--line);font-weight:400}
  th{color:var(--muted);width:40%;font-weight:400}
  ul{padding-inline-start:20px;color:var(--muted)}
  .cta{display:flex;gap:12px;flex-wrap:wrap;margin:28px 0}
  .cta a{display:inline-block;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:500}
  .p{background:var(--gold);color:#0b0b0c}
  .s{border:1px solid var(--line);color:var(--fg)}
  .none{background:var(--bg-3);border:1px solid var(--line);border-radius:10px;padding:40px;text-align:center;color:var(--muted)}
</style>
</head>
<body>
<header><div class="wrap bar">
  <a class="brand" href="/">${esc(BIZ.name)}</a>
  <nav><a href="/">דף הבית</a> · <a href="/stock/">המלאי שלנו</a></nav>
</div></header>

<main class="wrap">
  <h1>${esc(vehicleTitle(v))}</h1>
  <p class="sub">${esc([v.color, v.condition, STATUS_HE[v.status]].filter(Boolean).join(' · '))}</p>

  ${gallery ? `<div class="gal">\n      ${gallery}\n    </div>` : '<div class="none">אין עדיין תמונות לרכב הזה. צרו קשר ונשלח לכם תמונות עדכניות.</div>'}

  <h2>מפרט</h2>
  <table>${specs.map(([k, val]) => `<tr><th>${esc(k)}</th><td>${esc(val)}</td></tr>`).join('')}</table>

  ${(v.features || []).length ? `<h2>אביזרים</h2>\n  <ul>${v.features.map(f => `<li>${esc(f)}</li>`).join('')}</ul>` : ''}
  ${v.description ? `<h2>תיאור</h2>\n  <p>${esc(v.description)}</p>` : ''}

  <h2>מחיר</h2>
  <p>המחיר נמסר בפנייה ישירה — לפרטים צרו קשר.</p>

  <div class="cta">
    <a class="p" href="/#lead">בקשת הצעת מחיר</a>
    <a class="s" href="${esc(BIZ.whatsapp)}" rel="noopener">וואטסאפ ${esc(BIZ.phoneHe)}</a>
    <a class="s" href="/stock/">חזרה למלאי</a>
  </div>
</main>

<footer><div class="wrap">
  ${esc(BIZ.name)} · ${esc(BIZ.street)}, ${esc(BIZ.city)} · ${esc(BIZ.hoursHe)} · <a href="${esc(BIZ.whatsapp)}" rel="noopener">${esc(BIZ.phoneHe)}</a>
</div></footer>
</body>
</html>
`;
}

/* ---------- רשימה סטטית לעמוד המלאי ---------- */

function staticList(vehicles) {
  const rows = vehicles.map(v => {
    const line = [v.year, v.color, v.condition, STATUS_HE[v.status]].filter(Boolean).join(' · ');
    return `<li><a href="/stock/${encodeURIComponent(v.id)}/">${esc(vehicleTitle(v))}</a> — ${esc(line)}</li>`;
  }).join('\n');
  return `<div class="state" id="ym-static">
<h2>${vehicles.length} רכבים במלאי</h2>
<ul style="text-align:start;display:inline-block">
${rows}
</ul>
</div>`;
}

function itemListLd(vehicles) {
  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: 'המלאי של ' + BIZ.name,
    url: SITE + '/stock/',
    numberOfItems: vehicles.length,
    itemListElement: vehicles.map((v, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      url: vehicleUrl(v),
      name: vehicleTitle(v),
    })),
  };
}

function replaceBetween(html, tag, body) {
  const start = `<!-- ym:${tag}:start -->`;
  const end = `<!-- ym:${tag}:end -->`;
  const i = html.indexOf(start);
  const j = html.indexOf(end);
  if (i < 0 || j < 0 || j < i) return null;
  return html.slice(0, i + start.length) + '\n' + body + '\n' + html.slice(j);
}

function injectStatic(root, vehicles) {
  const file = resolve(root, 'stock/index.html');
  if (!existsSync(file)) return false;
  const html = readFileSync(file, 'utf8');
  let next = replaceBetween(html, 'static', staticList(vehicles));
  if (next === null) return false;
  const withLd = replaceBetween(
    next, 'ld',
    '<script type="application/ld+json">' + JSON.stringify(itemListLd(vehicles)) + '</script>'
  );
  if (withLd !== null) next = withLd;
  if (next !== html) writeFileSync(file, next);
  return true;
}

/* ---------- sitemap ו-llms.txt ---------- */

function sitemap(vehicles, updatedAt) {
  const day = String(updatedAt || new Date().toISOString()).slice(0, 10);
  const urls = [
    { loc: SITE + '/', pri: '1.0', freq: 'weekly' },
    { loc: SITE + '/stock/', pri: '0.9', freq: 'hourly' },
    ...vehicles.map(v => ({ loc: vehicleUrl(v), pri: '0.7', freq: 'weekly' })),
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(u => `  <url>
    <loc>${u.loc}</loc>
    <lastmod>${day}</lastmod>
    <changefreq>${u.freq}</changefreq>
    <priority>${u.pri}</priority>
  </url>`).join('\n')}
</urlset>
`;
}

function llms(vehicles, updatedAt) {
  const avail = vehicles.filter(v => v.status !== 'sold');
  const line = v => {
    const bits = [
      v.year, v.color, v.condition,
      v.km != null && v.km > 0 ? num(v.km) + ' ק״מ' : null,
      STATUS_HE[v.status],
      (v.features || []).join(', ') || null,
      v.description || null,
    ].filter(Boolean).join(' · ');
    return `- [${vehicleTitle(v)}](${vehicleUrl(v)}): ${bits}`;
  };
  const byMake = {};
  vehicles.forEach(v => { (byMake[v.make] = byMake[v.make] || []).push(v); });

  return `# ${BIZ.name} (${BIZ.nameEn})

> סוכנות רכב ביבוא מקביל ב${BIZ.city}. רכבים חדשים, רכבי טרייד-אין ורכבי יד שנייה נבדקים.
> כתובת: ${BIZ.street}, ${BIZ.city}. טלפון/וואטסאפ: ${BIZ.phoneHe}. שעות: ${BIZ.hoursHe}.

מחירים אינם מתפרסמים באתר — כל רכב מוצע "לפרטים, צרו קשר".
מותגים שהסוכנות מספקת: ${BIZ.brands.join(', ')} (לא כולם במלאי בכל רגע; חלקם מובאים בהזמנה).

עודכן: ${updatedAt || new Date().toISOString()} · ${vehicles.length} רכבים בסך הכל, ${avail.length} לא מכורים.

## דפים מרכזיים

- [דף הבית](${SITE}/): על הסוכנות, טרייד-אין, מימון, אולם התצוגה וטופס פנייה.
- [המלאי שלנו](${SITE}/stock/): כל הרכבים, עם סינון לפי יצרן, סטטוס וחדש/יד שנייה.
- [רכבי יד שנייה](${SITE}/stock/?condition=used) · [רכבים חדשים](${SITE}/stock/?condition=new)
- [inventory.json](${SITE}/data/inventory.json): המלאי כקובץ JSON, מתעדכן אוטומטית.

## המלאי לפי יצרן

${Object.keys(byMake).sort().map(make => `### ${make}\n\n${byMake[make].map(line).join('\n')}`).join('\n\n')}

## יצירת קשר

- וואטסאפ: ${BIZ.whatsapp}
- פייסבוק: ${BIZ.facebook}
- ניווט: ${BIZ.maps}
`;
}

/* ---------- ראשי ---------- */

export function buildSeo({ root, payload, log = console.log }) {
  const vehicles = payload.vehicles || [];

  writeFileSync(resolve(root, 'sitemap.xml'), sitemap(vehicles, payload.updated_at));
  writeFileSync(resolve(root, 'llms.txt'), llms(vehicles, payload.updated_at));

  const stockDir = resolve(root, 'stock');
  mkdirSync(stockDir, { recursive: true });
  const live = new Set(vehicles.map(v => v.id));

  for (const v of vehicles) {
    const dir = join(stockDir, v.id);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'index.html'), vehiclePage(v));
  }

  // ניקוי עמודים של רכבים שכבר לא במלאי
  let removed = 0;
  for (const name of readdirSync(stockDir)) {
    const p = join(stockDir, name);
    if (!statSync(p).isDirectory() || live.has(name)) continue;
    rmSync(p, { recursive: true, force: true });
    removed++;
  }

  const injected = injectStatic(root, vehicles);
  log(`SEO: ${vehicles.length} עמודי רכב, ${removed} הוסרו, sitemap ו-llms.txt נכתבו${injected ? ', רשימה סטטית הוזרקה' : ''}.`);
}
