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

// מדריכים לקונים (guides/) — נבנים מחוץ ל-Action (scratchpad/guides-build.mjs); כאן רק לרשימות
export const GUIDES = [
  ['parallel-import', 'יבוא מקביל, יבוא אישי ויבואן רשמי — מה ההבדל'],
  ['us-vs-canada-spec', 'תקינה אמריקאית מול תקינה קנדית'],
  ['license-for-pickups', 'איזה רישיון נהיגה צריך לטנדר אמריקאי'],
  ['warranty-and-service', 'אחריות, שירות וחלפים לרכב ביבוא מקביל'],
  ['trade-in', 'טרייד-אין: איך עובד התהליך'],
  ['financing', 'מימון רכב — מה חשוב לבדוק'],
  ['electric-pickups-israel', 'טנדרים חשמליים בישראל: טעינה, מיסוי וטווח'],
  ['buying-used-safely', 'איך קונים רכב יד שנייה בבטחה'],
];

export const BIZ = {
  name: 'ידידיה מוטורס',
  nameEn: 'Yedidia Motors',
  street: 'המעפילים 1',
  city: 'קרית אתא',
  country: 'IL',
  phone: '+972-50-899-1090',
  phoneHe: '050-899-1090',
  landline: '+972-4-841-9413',
  landlineHe: '04-8419413',
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
    v.trim,
    v.color,
    v.km != null && v.km > 0 ? num(v.km) + ' ק״מ' : null,
    v.engine, v.drivetrain, v.body,
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
    telephone: [BIZ.landline, BIZ.phone],
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
  // מפרט שפוענח ממספר השלדה (NHTSA vPIC) — 11/09/2026
  if (v.trim) ld.vehicleConfiguration = v.trim;
  if (v.body) ld.bodyType = v.body;
  if (v.fuel) ld.fuelType = v.fuel;
  if (v.transmission) ld.vehicleTransmission = v.transmission;
  if (v.drivetrain) ld.driveWheelConfiguration = v.drivetrain;
  if (v.doors) ld.numberOfDoors = v.doors;
  if (v.engine) ld.vehicleEngine = { '@type': 'EngineSpecification', name: v.engine, ...(v.fuel ? { fuelType: v.fuel } : {}) };
  if (v.plant) ld.countryOfOrigin = v.plant;
  if (v.seats) ld.vehicleSeatingCapacity = v.seats;
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

/* טקסט מודעה מוכן לוואטסאפ/פייסבוק — אותו טקסט משמש לכפתורי השיתוף ולהעתקה */
export function adText(v) {
  const bits = [v.condition, v.trim, v.color, v.km != null && v.km > 0 ? num(v.km) + ' ק״מ' : null, ...(v.features || [])].filter(Boolean);
  const spec = [v.engine, v.drivetrain, v.transmission, v.body].filter(Boolean);
  const eq = (v.equipment || []).slice(0, 3);
  return [
    `🚘 ${vehicleTitle(v)}`,
    bits.join(' · '),
    spec.join(' · '),
    eq.length ? '✔ ' + eq.join('\n✔ ') : '',
    v.description || '',
    v.status === 'sold' ? 'נמכר — אבל יש עוד במלאי.' : `${STATUS_HE[v.status] === 'בדרך' ? 'בדרך לארץ' : 'במלאי'} בידידיה מוטורס, ${BIZ.city}. לפרטים ותיאום נסיעת מבחן: ${BIZ.landlineHe}`,
    vehicleUrl(v),
  ].filter(Boolean).join('\n');
}

function vehiclePage(v) {
  const title = `${vehicleTitle(v)}${v.color ? ' · ' + v.color : ''} | ${BIZ.name}`;
  const desc = vehicleDescription(v);
  const url = vehicleUrl(v);
  const perf = v.perf || {};
  const specs = [
    ['יצרן', v.make], ['דגם', v.model], ['שנת דגם', v.year], ['גימור', v.trim], ['סדרה', v.series && v.series !== v.trim ? v.series : null],
    ['צבע', v.color],
    ['קילומטראז׳', v.km != null ? num(v.km) + ' ק״מ' : null],
    ['מצב הרכב', v.condition], ['מרכב', v.body], ['מנוע', v.engine], ['דלק', v.fuel], ['הנעה', v.drivetrain],
    ['תיבת הילוכים', v.transmission], ['דלתות', v.doors], ['מושבים', v.seats],
    ['חישוקים', v.wheels_in ? v.wheels_in + ' אינץ׳' : null],
    ['הספק', perf.hp && !/כ״ס/.test(v.engine || '') ? num(perf.hp) + ' כ״ס' : null],
    ['טווח נסיעה', perf.range_km ? 'עד כ־' + num(perf.range_km) + ' ק״מ (הערכת יצרן)' : null],
    ['טעינה מהירה', perf.dc_kw ? 'עד ' + perf.dc_kw + ' קילוואט DC' : null],
    ['0–100 קמ״ש', perf.accel_0_100 ? perf.accel_0_100 + ' שניות' : null],
    ['כושר גרירה', perf.towing_kg ? 'עד כ־' + num(perf.towing_kg) + ' ק״ג' : null],
    ['משקל כולל מותר', v.gvwr], ['ארץ ייצור', v.plant],
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
<link rel="stylesheet" href="/assets/fonts/fonts.css">
<script src="/assets/site.js" defer></script>
<meta property="og:type" content="product">
<meta property="og:site_name" content="${esc(BIZ.name)}">
<meta property="og:locale" content="he_IL">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${esc(url)}">
${v.share_image ? `<meta property="og:image" content="${esc(SITE + v.share_image)}">
<meta property="og:image:secure_url" content="${esc(SITE + v.share_image)}">
<meta property="og:image:type" content="image/jpeg">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="${esc(vehicleTitle(v))} — ידידיה מוטורס">` : (v.images && v.images[0] ? `<meta property="og:image" content="${esc(SITE + v.images[0])}">` : '')}
<meta name="twitter:card" content="${(v.share_image || (v.images && v.images.length)) ? 'summary_large_image' : 'summary'}">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(desc)}">${v.share_image ? `\n<meta name="twitter:image" content="${esc(SITE + v.share_image)}">` : ''}
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
  a:focus-visible,button:focus-visible{outline:3px solid #ddb838;outline-offset:2px}
  .legal-links{display:flex;flex-wrap:wrap;gap:8px 18px;font-size:13px;margin-top:10px}
  .legal-links a{color:var(--muted);text-decoration:none}
  .legal-links a:hover{color:var(--fg)}
  .legal-links button.link{background:none;border:0;color:var(--muted);font:inherit;cursor:pointer;padding:0}
  h1{font-size:clamp(24px,4vw,38px);margin:26px 0 6px;letter-spacing:-.02em}
  .sub{color:var(--muted);margin:0 0 22px}
  .lead{font-size:18px;line-height:1.7;margin:-8px 0 26px;max-width:720px}
  .gal{display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));margin-bottom:28px}
  table{border-collapse:collapse;width:100%;max-width:560px}
  th,td{text-align:start;padding:9px 12px;border-bottom:1px solid var(--line);font-weight:400}
  th{color:var(--muted);width:40%;font-weight:400}
  ul{padding-inline-start:20px;color:var(--muted)}
  .cta{display:flex;gap:12px;flex-wrap:wrap;margin:28px 0}
  .cta a{display:inline-block;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:500}
  .share{display:flex;gap:10px;align-items:center;margin:-12px 0 28px}
  .share a{display:inline-flex;align-items:center;justify-content:center;width:44px;height:44px;border-radius:50%;border:1px solid var(--line);color:var(--muted);background:var(--bg-2)}
  .share a:hover,.share a:focus-visible{color:var(--fg);border-color:var(--gold)}
  .share svg{width:22px;height:22px;fill:currentColor}
  .chips{display:flex;flex-wrap:wrap;gap:8px;padding:0;margin:0 0 8px;list-style:none}
  .chips li{background:var(--bg-2);border:1px solid var(--line);border-radius:999px;padding:6px 12px;font-size:14px;color:var(--fg)}
  ul.eq{color:var(--fg);line-height:1.7}
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

<main class="wrap" id="main" tabindex="-1">
  <h1>${esc(vehicleTitle(v))}</h1>
  <p class="sub">${esc([v.color, v.condition, STATUS_HE[v.status]].filter(Boolean).join(' · '))}</p>
  ${v.description && v.description.length > 60 ? `<p class="lead">${esc(v.description)}</p>` : ''}

  ${gallery ? `<div class="gal">\n      ${gallery}\n    </div>` : '<div class="none">אין עדיין תמונות לרכב הזה. צרו קשר ונשלח לכם תמונות עדכניות.</div>'}

  <h2>מפרט</h2>
  <table>${specs.map(([k, val]) => `<tr><th>${esc(k)}</th><td>${esc(val)}</td></tr>`).join('')}</table>

  ${(v.equipment || []).length ? `<h2>אבזור</h2>\n  <ul class="eq">${v.equipment.map(f => `<li>${esc(f)}</li>`).join('')}</ul>` : ''}
  ${(v.safety || []).length ? `<h2>בטיחות ועזרי נהיגה</h2>\n  <ul class="chips">${v.safety.map(f => `<li>${esc(f)}</li>`).join('')}</ul>` : ''}
  ${((v.features || []).length || (v.description && v.description.length <= 60)) ? `<h2>ברכב זה</h2>\n  <ul class="eq">${[...(v.features || []), ...(v.description && v.description.length <= 60 ? [v.description] : [])].map(f => `<li>${esc(f)}</li>`).join('')}</ul>` : ''}

  <h2>מחיר</h2>
  <p>המחיר נמסר בפנייה ישירה — לפרטים צרו קשר.</p>

  <div class="cta">
    <a class="p" href="/?car=${encodeURIComponent(vehicleTitle(v) + ' (' + v.id + ')')}#lead">בקשת הצעת מחיר</a>
    <a class="s" href="${esc(BIZ.whatsapp)}?text=${encodeURIComponent('שלום, אני מתעניין ב-' + vehicleTitle(v) + ' שראיתי באתר (מזהה ' + v.id + '). אשמח לפרטים.')}" rel="noopener">וואטסאפ ${esc(BIZ.phoneHe)}</a>
    <a class="s" href="/stock/">חזרה למלאי</a>
  </div>

  <div class="share" aria-label="שיתוף">
    <a href="https://wa.me/?text=${encodeURIComponent(adText(v))}" target="_blank" rel="noopener" aria-label="שיתוף בוואטסאפ" title="שיתוף בוואטסאפ"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M17.5 14.4c-.3-.1-1.8-.9-2-1-.3-.1-.5-.1-.7.1-.2.3-.8 1-1 1.2-.2.2-.3.2-.6.1-.3-.1-1.3-.5-2.4-1.5-.9-.8-1.5-1.8-1.7-2.1-.2-.3 0-.5.1-.6l.5-.5c.1-.2.2-.3.3-.5.1-.2 0-.4 0-.5l-.9-2.2c-.2-.6-.5-.5-.7-.5h-.6c-.2 0-.5.1-.8.4-.3.3-1 1-1 2.5s1.1 2.9 1.2 3.1c.1.2 2.1 3.2 5.1 4.5.7.3 1.3.5 1.7.6.7.2 1.4.2 1.9.1.6-.1 1.8-.7 2-1.4.2-.7.2-1.3.2-1.4-.1-.2-.3-.3-.6-.4zM12 2C6.5 2 2 6.5 2 12c0 1.8.5 3.5 1.3 5L2 22l5.2-1.4c1.4.8 3.1 1.2 4.8 1.2 5.5 0 10-4.5 10-10S17.5 2 12 2zm0 18.2c-1.5 0-3-.4-4.2-1.2l-.3-.2-3.1.8.8-3-.2-.3C4.2 15 3.8 13.5 3.8 12c0-4.5 3.7-8.2 8.2-8.2s8.2 3.7 8.2 8.2-3.7 8.2-8.2 8.2z"/></svg></a>
    <a href="https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}" target="_blank" rel="noopener" aria-label="שיתוף בפייסבוק" title="שיתוף בפייסבוק"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13.5 22v-8h2.7l.4-3.2h-3.1V8.8c0-.9.3-1.6 1.6-1.6h1.7V4.4c-.3 0-1.3-.1-2.5-.1-2.5 0-4.1 1.5-4.1 4.2v2.3H7.4V14h2.8v8h3.3z"/></svg></a>
  </div>
</main>

<footer><div class="wrap">
  ${esc(BIZ.name)} · ${esc(BIZ.street)}, ${esc(BIZ.city)} · ${esc(BIZ.hoursHe)} · טלפון <a href="tel:${esc(BIZ.landline)}">${esc(BIZ.landlineHe)}</a> · וואטסאפ <a href="${esc(BIZ.whatsapp)}" rel="noopener">${esc(BIZ.phoneHe)}</a>
  <nav class="legal-links" aria-label="מידע משפטי">
    <a href="/legal/privacy/">מדיניות פרטיות</a>
    <a href="/legal/terms/">תנאי שימוש</a>
    <a href="/legal/cookies/">עוגיות</a>
    <a href="/legal/accessibility/">הצהרת נגישות</a>
    <a href="/legal/disclaimer/">הצהרת אחריות — מפרטים ומלאי</a>
    <button class="link" type="button" data-ym-cookie-settings>הגדרות עוגיות</button>
  </nav>
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
    { loc: SITE + '/guides/', pri: '0.8', freq: 'monthly' },
    ...GUIDES.map(([slug]) => ({ loc: SITE + '/guides/' + slug + '/', pri: '0.7', freq: 'monthly' })),
    ...['privacy', 'terms', 'cookies', 'accessibility', 'disclaimer'].map(s => ({ loc: SITE + '/legal/' + s + '/', pri: '0.2', freq: 'yearly' })),
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
> כתובת: ${BIZ.street}, ${BIZ.city}. טלפון אולם התצוגה: ${BIZ.landlineHe}. וואטסאפ: ${BIZ.phoneHe}. שעות: ${BIZ.hoursHe}.

מחירים אינם מתפרסמים באתר — כל רכב מוצע "לפרטים, צרו קשר".
מותגים שהסוכנות מספקת: ${BIZ.brands.join(', ')} (לא כולם במלאי בכל רגע; חלקם מובאים בהזמנה).

עודכן: ${updatedAt || new Date().toISOString()} · ${vehicles.length} רכבים בסך הכל, ${avail.length} לא מכורים.

## דפים מרכזיים

- [דף הבית](${SITE}/): על הסוכנות, טרייד-אין, מימון, אולם התצוגה וטופס פנייה.
- [המלאי שלנו](${SITE}/stock/): כל הרכבים, עם סינון לפי יצרן, סטטוס וחדש/יד שנייה.
- [רכבי יד שנייה](${SITE}/stock/?condition=used) · [רכבים חדשים](${SITE}/stock/?condition=new)
- [inventory.json](${SITE}/data/inventory.json): המלאי כקובץ JSON, מתעדכן אוטומטית.

## מדריכים לקונים

${GUIDES.map(([slug, t]) => `- [${t}](${SITE}/guides/${slug}/)`).join('\n')}

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
    // רכבים זהים שאוחדו לכרטיס הזה — קישור ישן שלהם מפנה לכרטיס המאוחד
    for (const mid of (v.merged_ids || [])) {
      live.add(mid);
      const mdir = join(stockDir, mid);
      mkdirSync(mdir, { recursive: true });
      writeFileSync(join(mdir, 'index.html'), `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><title>${esc(vehicleTitle(v))}</title><link rel="canonical" href="${esc(vehicleUrl(v))}"><meta http-equiv="refresh" content="0;url=/stock/${encodeURIComponent(v.id)}/"><meta name="robots" content="noindex"></head><body><a href="/stock/${encodeURIComponent(v.id)}/">${esc(vehicleTitle(v))}</a></body></html>\n`);
    }
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
