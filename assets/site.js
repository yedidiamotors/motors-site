/* ידידיה מוטורס — שכבת האתר המשותפת לכל העמודים.
   1. באנר עוגיות + Google Analytics 4 שנטען רק אחרי אישור (Consent Mode v2).
   2. תפריט נגישות (ללא צד שלישי) — ההעדפות נשמרות במכשיר.
   3. קישורים משפטיים בפוטר של דף הבית + טקסט חלופי לתמונות העיצוב.
   דף הבית מחליף את ה-document בזמן הפריסה, לכן כל DOM כאן נבנה מחדש ב-ensure()
   (MutationObserver + interval), והמצב חי בסגירות ולא ב-DOM.  נוסף 10/09/2026. */
(function () {
  'use strict';

  var GA_ID = 'G-WDDVLHQXTF';           // מזהה המדידה של Google Analytics 4 (נכס "www.yedidia-motors.com", זרם 15755697610). ריק = בלי אנליטיקס ובלי באנר.
  var CONSENT_KEY = 'ym_consent';
  var A11Y_KEY = 'ym_a11y';
  var CONSENT_TTL = 365 * 24 * 3600 * 1000;
  var FONT = 'Heebo, system-ui, -apple-system, "Segoe UI", Arial, sans-serif';

  function store(key, val) { try { if (val == null) localStorage.removeItem(key); else localStorage.setItem(key, JSON.stringify(val)); } catch (e) {} }
  function load(key) { try { var v = localStorage.getItem(key); return v ? JSON.parse(v) : null; } catch (e) { return null; } }

  /* ============================================================ 1. הסכמה + GA4 */
  var consent = load(CONSENT_KEY);
  if (consent && (!consent.ts || Date.now() - consent.ts > CONSENT_TTL)) consent = null;
  var gaLoaded = false;

  window.dataLayer = window.dataLayer || [];
  function gtag() { window.dataLayer.push(arguments); }
  window.gtag = window.gtag || gtag;
  // ברירת מחדל: הכל נדחה עד שהמשתמש מאשר. gtag.js לא נטען בכלל לפני אישור.
  gtag('consent', 'default', { analytics_storage: 'denied', ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied', wait_for_update: 500 });

  function loadGA() {
    if (gaLoaded || !GA_ID) return;
    gaLoaded = true;
    gtag('consent', 'update', { analytics_storage: 'granted' });
    gtag('js', new Date());
    gtag('config', GA_ID, { allow_google_signals: false, allow_ad_personalization_signals: false, anonymize_ip: true });
    var s = document.createElement('script');
    s.async = true;
    s.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(GA_ID);
    (document.head || document.documentElement).appendChild(s);
  }

  function dropGA() {
    gtag('consent', 'update', { analytics_storage: 'denied' });
    if (window['ga-disable-' + GA_ID] !== undefined || gaLoaded) window['ga-disable-' + GA_ID] = true;
    // מוחקים את עוגיות _ga שנוצרו — על הדומיין הראשי ועל תת-הדומיין
    try {
      var host = location.hostname, parts = host.split('.');
      var domains = [host, '.' + host];
      if (parts.length > 2) domains.push('.' + parts.slice(-2).join('.'));
      document.cookie.split(';').forEach(function (c) {
        var name = c.split('=')[0].trim();
        if (!/^_ga/.test(name)) return;
        domains.forEach(function (d) { document.cookie = name + '=; Max-Age=0; path=/; domain=' + d; });
        document.cookie = name + '=; Max-Age=0; path=/';
      });
    } catch (e) {}
  }

  function setConsent(analytics) {
    consent = { analytics: !!analytics, ts: Date.now(), v: 1 };
    store(CONSENT_KEY, consent);
    if (analytics) loadGA(); else dropGA();
    closeBanner();
  }

  var bannerOpen = false;
  function bannerEl() { return document.getElementById('ym-consent'); }
  function closeBanner() { bannerOpen = false; var b = bannerEl(); if (b) b.remove(); }
  function openBanner() {
    if (!GA_ID) return;
    bannerOpen = true;
    ensureBanner();
    var b = bannerEl();
    if (b) { var first = b.querySelector('button'); if (first) first.focus(); }
  }
  function ensureBanner() {
    if (!bannerOpen || bannerEl() || !document.body) return;
    var b = document.createElement('div');
    b.id = 'ym-consent';
    b.setAttribute('role', 'dialog');
    b.setAttribute('aria-modal', 'false');
    b.setAttribute('aria-labelledby', 'ym-consent-title');
    b.setAttribute('aria-describedby', 'ym-consent-text');
    b.setAttribute('dir', 'rtl');
    b.setAttribute('lang', 'he');
    b.style.cssText = 'position:fixed;z-index:2147483000;left:12px;right:12px;bottom:12px;max-width:720px;margin:0 auto;' +
      'background:#141416;color:#f5f5f3;border:1px solid #3a3a40;border-radius:14px;padding:18px 20px;' +
      'box-shadow:0 18px 50px rgba(0,0,0,.55);font-family:' + FONT + ';font-size:15px;line-height:1.6;direction:rtl;text-align:right;';
    b.innerHTML =
      '<div id="ym-consent-title" style="font-weight:700;font-size:16px;margin-bottom:4px">עוגיות באתר</div>' +
      '<div id="ym-consent-text" style="color:#c4c4cc">האתר לא שומר שום עוגייה בלי אישורכם. אם תאשרו, נשתמש ב-Google Analytics כדי להבין אילו עמודים מעניינים גולשים ולשפר את האתר — בלי פרסום ובלי זיהוי אישי. ' +
      '<a href="/legal/cookies/" style="color:#ddb838">מדיניות העוגיות</a></div>' +
      '<div style="display:flex;flex-wrap:wrap;gap:10px;margin-top:14px">' +
      '<button type="button" data-ym-consent="yes" style="flex:1 1 160px;min-height:44px;background:#c9a227;color:#0b0b0c;border:0;border-radius:8px;font:600 15px ' + FONT + ';cursor:pointer">מאשר/ת סטטיסטיקה</button>' +
      '<button type="button" data-ym-consent="no" style="flex:1 1 160px;min-height:44px;background:transparent;color:#f5f5f3;border:1px solid #6b6b73;border-radius:8px;font:600 15px ' + FONT + ';cursor:pointer">רק הכרחי</button>' +
      '</div>';
    document.body.appendChild(b);
  }

  /* ============================================================ 2. תפריט נגישות */
  var A11Y = [
    { k: 'font',     t: 'הגדלת טקסט',     type: 'cycle', vals: [0, 1, 2, 3], labels: ['רגיל', '110%', '125%', '150%'] },
    { k: 'contrast', t: 'ניגודיות גבוהה' },
    { k: 'gray',     t: 'גווני אפור' },
    { k: 'links',    t: 'הדגשת קישורים' },
    { k: 'readable', t: 'גופן קריא' },
    { k: 'motion',   t: 'עצירת אנימציות' },
    { k: 'cursor',   t: 'סמן גדול' },
  ];
  var a11y = load(A11Y_KEY) || {};
  var panelOpen = false;

  var A11Y_CSS =
    // zoom על body מרחיב את ה-layout viewport בנייד; width מפצה כך שהרוחב המצויר נשאר 100%
    'html.ym-font-1 body{zoom:1.1;width:calc(100%/1.1)}html.ym-font-2 body{zoom:1.25;width:calc(100%/1.25)}html.ym-font-3 body{zoom:1.5;width:calc(100%/1.5)}' +
    // פילטר על html/body היה הופך position:fixed לגלילה עם הדף — לכן שכבת backdrop-filter קבועה מעל הכל
    'html.ym-contrast::after,html.ym-gray::after{content:"";position:fixed;inset:0;pointer-events:none;z-index:2147483647}' +
    'html.ym-contrast::after{-webkit-backdrop-filter:contrast(1.35);backdrop-filter:contrast(1.35)}' +
    'html.ym-gray::after{-webkit-backdrop-filter:grayscale(1);backdrop-filter:grayscale(1)}' +
    'html.ym-contrast.ym-gray::after{-webkit-backdrop-filter:contrast(1.35) grayscale(1);backdrop-filter:contrast(1.35) grayscale(1)}' +
    'html.ym-links a{text-decoration:underline !important;text-underline-offset:3px;outline:1px dashed currentColor;outline-offset:2px}' +
    'html.ym-readable, html.ym-readable *{font-family:Arial,Helvetica,sans-serif !important;letter-spacing:.01em}' +
    'html.ym-motion *, html.ym-motion *::before, html.ym-motion *::after{animation:none !important;transition:none !important;scroll-behavior:auto !important}' +
    'html.ym-cursor, html.ym-cursor *{cursor:url("data:image/svg+xml;utf8,<svg xmlns=%27http://www.w3.org/2000/svg%27 width=%2748%27 height=%2748%27 viewBox=%270 0 24 24%27><path d=%27M4 2l16 10-7 1.5L16 20l-3 1.5-3-6.5L4 19z%27 fill=%27%23fff%27 stroke=%27%23000%27 stroke-width=%271.2%27/></svg>") 4 2, auto !important}' +
    '#ym-a11y-btn:focus-visible,#ym-a11y-panel button:focus-visible,#ym-consent button:focus-visible,#ym-consent a:focus-visible{outline:3px solid #ddb838 !important;outline-offset:3px}' +
    '#ym-a11y-panel button[aria-pressed="true"]{background:#c9a227 !important;color:#0b0b0c !important;border-color:#c9a227 !important}' +
    '#ym-a11y-panel button[aria-pressed="true"] [data-ym-a11y-val]{color:#3a2e05 !important}#ym-a11y-panel button[data-ym-a11y]{width:100%;gap:12px}' +
    '.ym-skip{position:fixed;top:-60px;right:16px;z-index:2147483001;background:#c9a227;color:#000;padding:10px 16px;border-radius:8px;font:700 15px ' + FONT + ';text-decoration:none}.ym-skip:focus{top:12px}';

  function applyA11y() {
    var h = document.documentElement;
    if (!h) return;
    A11Y.forEach(function (o) {
      if (o.type === 'cycle') {
        o.vals.forEach(function (v) { if (v) h.classList.toggle('ym-' + o.k + '-' + v, a11y[o.k] === v); });
      } else h.classList.toggle('ym-' + o.k, !!a11y[o.k]);
    });
    if (!document.getElementById('ym-a11y-css')) {
      var s = document.createElement('style');
      s.id = 'ym-a11y-css';
      s.textContent = A11Y_CSS;
      (document.head || h).appendChild(s);
    }
  }
  function setA11y(k, v) {
    if (v) a11y[k] = v; else delete a11y[k];
    store(A11Y_KEY, Object.keys(a11y).length ? a11y : null);
    applyA11y();
    renderPanelState();
  }
  function ensureA11yButton() {
    if (!document.body || document.getElementById('ym-a11y-btn')) return;
    var btn = document.createElement('button');
    btn.id = 'ym-a11y-btn';
    btn.type = 'button';
    btn.setAttribute('aria-label', 'תפריט נגישות');
    btn.setAttribute('aria-haspopup', 'dialog');
    btn.setAttribute('aria-expanded', 'false');
    btn.setAttribute('title', 'נגישות');
    btn.style.cssText = 'position:fixed;z-index:2147482999;left:14px;bottom:14px;width:52px;height:52px;border-radius:50%;' +
      'background:#c9a227;color:#0b0b0c;border:2px solid #0b0b0c;box-shadow:0 8px 24px rgba(0,0,0,.45);cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0';
    btn.innerHTML = '<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="4.5" r="2"/><path d="M4 9.5l8 1.5 8-1.5M12 11v5l-3 6M12 16l3 6"/></svg>';
    document.body.appendChild(btn);
    if (!document.querySelector('.ym-skip')) {
      var skip = document.createElement('a');
      skip.className = 'ym-skip';
      skip.href = '#main';
      skip.textContent = 'דילוג לתוכן';
      skip.addEventListener('click', function (e) {
        var t = document.getElementById('main') || document.querySelector('main') || document.querySelector('h1');
        if (t) { e.preventDefault(); if (!t.hasAttribute('tabindex')) t.setAttribute('tabindex', '-1'); t.focus(); t.scrollIntoView(); }
      });
      document.body.insertBefore(skip, document.body.firstChild);
    }
  }
  function panelEl() { return document.getElementById('ym-a11y-panel'); }
  function closePanel() {
    panelOpen = false;
    var p = panelEl(); if (p) p.remove();
    var b = document.getElementById('ym-a11y-btn'); if (b) { b.setAttribute('aria-expanded', 'false'); b.focus(); }
  }
  function ensurePanel() {
    if (!panelOpen || panelEl() || !document.body) return;
    var p = document.createElement('div');
    p.id = 'ym-a11y-panel';
    p.setAttribute('role', 'dialog');
    p.setAttribute('aria-label', 'הגדרות נגישות');
    p.setAttribute('dir', 'rtl');
    p.setAttribute('lang', 'he');
    p.style.cssText = 'position:fixed;z-index:2147483002;left:14px;bottom:76px;width:min(300px,calc(100vw - 28px));background:#141416;color:#f5f5f3;' +
      'border:1px solid #3a3a40;border-radius:14px;padding:14px;box-shadow:0 18px 50px rgba(0,0,0,.55);font-family:' + FONT + ';direction:rtl;text-align:right';
    var html = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">' +
      '<b style="font-size:16px">נגישות</b>' +
      '<button type="button" data-ym-a11y="close" aria-label="סגירת תפריט הנגישות" style="background:none;border:0;color:#a1a1aa;font-size:22px;cursor:pointer;line-height:1;padding:4px 8px">×</button></div>' +
      '<div style="display:grid;gap:8px">';
    A11Y.forEach(function (o) {
      html += '<button type="button" data-ym-a11y="' + o.k + '" aria-pressed="false" style="min-height:42px;text-align:right;background:#1b1b1e;color:#f5f5f3;border:1px solid #3a3a40;border-radius:8px;padding:8px 12px;font:500 15px ' + FONT + ';cursor:pointer;display:flex;justify-content:space-between;align-items:center">' +
        '<span>' + o.t + '</span><span data-ym-a11y-val style="color:#a1a1aa;font-size:13px"></span></button>';
    });
    html += '</div><div style="display:flex;justify-content:space-between;align-items:center;margin-top:12px;font-size:13px;color:#a1a1aa">' +
      '<button type="button" data-ym-a11y="reset" style="background:none;border:0;color:#ddb838;font:600 14px ' + FONT + ';cursor:pointer;padding:0">איפוס</button>' +
      '<a href="/legal/accessibility/" style="color:#a1a1aa">הצהרת נגישות</a></div>';
    p.innerHTML = html;
    document.body.appendChild(p);
    renderPanelState();
    var first = p.querySelector('button[data-ym-a11y]:not([data-ym-a11y="close"])');
    if (first) first.focus();
    var b = document.getElementById('ym-a11y-btn'); if (b) b.setAttribute('aria-expanded', 'true');
  }
  function renderPanelState() {
    var p = panelEl(); if (!p) return;
    A11Y.forEach(function (o) {
      var btn = p.querySelector('button[data-ym-a11y="' + o.k + '"]'); if (!btn) return;
      var on = !!a11y[o.k];
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      var v = btn.querySelector('[data-ym-a11y-val]');
      if (v) v.textContent = o.type === 'cycle' ? o.labels[a11y[o.k] || 0] : (on ? 'פעיל' : '');
    });
  }

  /* ============================================================ 3. דף הבית: פוטר + alt */
  var SLOT_ALT = {
    'hero': 'רכבי ידידיה מוטורס — תמונת נושא',
    'story-finance': 'מימון לרכב בידידיה מוטורס',
    'story-used': 'רכבי יד שנייה נבדקת בידידיה מוטורס',
    'story-tradein': 'טרייד-אין — מוסרים רכב ומקבלים רכב',
    'showroom': 'אולם התצוגה של ידידיה מוטורס בקרית אתא',
    'model-sierra': 'GMC Sierra', 'model-yukon': 'GMC Yukon', 'model-ram1500': 'RAM 1500',
    'model-ram2500': 'RAM 2500', 'model-gle': 'Mercedes-Benz GLE', 'model-x5': 'BMW X5'
  };
  function ensureAlts() {
    var slots = document.querySelectorAll('image-slot');
    for (var i = 0; i < slots.length; i++) {
      var s = slots[i], sr = s.shadowRoot, img = sr && sr.querySelector('img[part="image"], .frame img');
      var alt = SLOT_ALT[s.id] || '';
      if (img && img.getAttribute('alt') !== alt) img.setAttribute('alt', alt);
      if (alt && s.getAttribute('role') !== 'img') { s.setAttribute('role', 'img'); s.setAttribute('aria-label', alt); }
    }
  }
  var LEGAL_LINKS = [
    ['/guides/', 'מדריכים לקונים'], ['/legal/privacy/', 'מדיניות פרטיות'], ['/legal/terms/', 'תנאי שימוש'], ['/legal/cookies/', 'עוגיות'],
    ['/legal/accessibility/', 'הצהרת נגישות'], ['/legal/disclaimer/', 'הצהרת אחריות — מפרטים ומלאי']
  ];
  // ניגודיות: הזהב של העיצוב (#C9A24A) על רקע לבן = 2.4, ואפור #666 על #111 = 3.3 — מתחת ל-AA (4.5).
  // מתקנים רק טקסטים על הרקע הבעייתי; על שחור הזהב תקין (8.7).
  function luminance(rgb) {
    var m = String(rgb).match(/\d+(\.\d+)?/g); if (!m) return null;
    var f = function (v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(+m[0]) + 0.7152 * f(+m[1]) + 0.0722 * f(+m[2]);
  }
  function bgLum(el) {
    var e = el;
    while (e && e !== document.documentElement) {
      var c = getComputedStyle(e).backgroundColor;
      if (c && c !== 'transparent' && !/rgba\(\s*\d+,\s*\d+,\s*\d+,\s*0\)/.test(c)) return luminance(c);
      e = e.parentElement;
    }
    return 0;
  }
  function ensureContrast() {
    var els = document.querySelectorAll('[style*="201, 162, 74"], [style*="102, 102, 102"], [style*="#C9A24A"], [style*="#666"]');
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      if (el.hasAttribute('data-ym-contrast')) continue;
      var c = getComputedStyle(el).color;
      var isGold = /201, 162, 74/.test(c), isGray = /102, 102, 102/.test(c);
      if (!isGold && !isGray) continue;
      var bg = bgLum(el);
      if (isGold && bg > 0.5) { el.style.setProperty('color', '#7a5f18', 'important'); el.setAttribute('data-ym-contrast', ''); }
      if (isGray && bg < 0.2) { el.style.setProperty('color', '#9a9a9a', 'important'); el.setAttribute('data-ym-contrast', ''); }
    }
  }
  function ensureMain() {
    if (document.querySelector('main, [role="main"]')) return;
    var host = document.querySelector('#dc-root > .sc-host');
    if (host) { host.setAttribute('role', 'main'); if (!document.getElementById('main')) host.id = 'main'; }
  }
  function ensureFooterLinks() {
    if (document.getElementById('ym-legal-row')) return;
    // דף הבית: השורה התחתונה של הפוטר מתחילה ב-"© 2026"
    var spans = document.querySelectorAll('span');
    var copy = null;
    for (var i = 0; i < spans.length; i++) { if (/^©\s*2026/.test(spans[i].textContent.trim())) { copy = spans[i]; break; } }
    if (!copy || !copy.parentNode || !copy.parentNode.parentNode) return;
    var row = copy.parentNode;
    var div = document.createElement('nav');
    div.id = 'ym-legal-row';
    div.setAttribute('aria-label', 'מידע משפטי');
    div.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px 20px;font:400 13px/1.6 ' + FONT + ';color:#999;padding-top:6px';
    div.innerHTML = LEGAL_LINKS.map(function (l) { return '<a href="' + l[0] + '" style="color:#999;text-decoration:none">' + l[1] + '</a>'; }).join('') +
      '<button type="button" data-ym-cookie-settings style="background:none;border:0;color:#999;font:400 13px ' + FONT + ';cursor:pointer;padding:0">הגדרות עוגיות</button>';
    row.parentNode.insertBefore(div, row);
  }

  /* ============================================================ חיווט */
  window.addEventListener('click', function (e) {
    var t = e.target && e.target.closest ? e.target : null;
    if (!t) return;
    var c = t.closest('[data-ym-consent]');
    if (c) { e.preventDefault(); setConsent(c.getAttribute('data-ym-consent') === 'yes'); return; }
    if (t.closest('[data-ym-cookie-settings]')) { e.preventDefault(); openBanner(); return; }
    if (t.closest('#ym-a11y-btn')) { e.preventDefault(); if (panelOpen) closePanel(); else { panelOpen = true; ensurePanel(); } return; }
    var a = t.closest('[data-ym-a11y]');
    if (a) {
      e.preventDefault();
      var k = a.getAttribute('data-ym-a11y');
      if (k === 'close') return closePanel();
      if (k === 'reset') { a11y = {}; store(A11Y_KEY, null); applyA11y(); renderPanelState(); return; }
      var opt = A11Y.filter(function (o) { return o.k === k; })[0];
      if (!opt) return;
      if (opt.type === 'cycle') setA11y(k, ((a11y[k] || 0) + 1) % opt.vals.length);
      else setA11y(k, !a11y[k]);
      return;
    }
    if (panelOpen && !t.closest('#ym-a11y-panel')) closePanel();
  }, true);
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && panelOpen) { e.preventDefault(); closePanel(); }
  }, true);

  var pending = false;
  function ensure() {
    if (pending) return;
    pending = true;
    setTimeout(ensureNow, 0);   // לא rAF — בטאב רקע rAF לא נורה והדגל היה נתקע
  }
  function ensureNow() {
    pending = false;
    try { applyA11y(); } catch (e) {}
    try { ensureA11yButton(); } catch (e) {}
    try { ensurePanel(); } catch (e) {}
    try { ensureBanner(); } catch (e) {}
    try { ensureAlts(); } catch (e) {}
    try { ensureFooterLinks(); } catch (e) {}
    try { ensureMain(); } catch (e) {}
    try { ensureContrast(); } catch (e) {}
  }

  // מצב התחלתי
  if (consent && consent.analytics) loadGA();
  else if (!consent && GA_ID) bannerOpen = true;

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ensure); else ensure();
  window.addEventListener('load', ensure);
  try { new MutationObserver(ensure).observe(document, { childList: true, subtree: true }); } catch (e) {}
  var n = 0, t = setInterval(function () { ensure(); if (++n > 120) clearInterval(t); }, 500);

  window.ymSite = { openCookieSettings: openBanner, consent: function () { return consent; } };
})();
