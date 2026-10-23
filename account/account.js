/* ============================================================
   ידידיה מוטורס — האיזור האישי ללקוח (www.yedidia-motors.com/account/)
   כל ההרשאות והנתונים בשרת (n8n → Supabase). הדף רק מציג, מעלה קבצים ומצייר חתימה.
   ============================================================ */
(function () {
  'use strict';

  var API = 'https://yedidiamotors.duckdns.org/webhook';
  var KEY = 'ym_portal_session';
  var MAX_FILE = 15 * 1024 * 1024;
  var session = null, data = null, currentAgreement = null, inventory = null;

  /* ---------- כלים ---------- */
  function $(id) { return document.getElementById(id); }
  function E(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function nis(n) {
    if (n === null || n === undefined || isNaN(n)) return '—';
    return '₪' + Number(n).toLocaleString('he-IL', { maximumFractionDigits: 0 });
  }
  function pad(n) { return String(n).padStart(2, '0'); }
  function fmtDate(iso) { if (!iso) return '—'; var d = new Date(iso); return pad(d.getDate()) + '.' + pad(d.getMonth() + 1) + '.' + d.getFullYear(); }
  function fmtDT(iso) { if (!iso) return '—'; var d = new Date(iso); return fmtDate(iso) + ' · ' + pad(d.getHours()) + ':' + pad(d.getMinutes()); }
  function relDay(iso) {
    var d = new Date(iso), now = new Date();
    var days = Math.floor((new Date(now.getFullYear(), now.getMonth(), now.getDate()) - new Date(d.getFullYear(), d.getMonth(), d.getDate())) / 864e5);
    var t = pad(d.getHours()) + ':' + pad(d.getMinutes());
    if (days === 0) return 'היום · ' + t;
    if (days === 1) return 'אתמול · ' + t;
    return fmtDT(iso);
  }
  function looksLikePhone(v) { var d = String(v || '').replace(/\D/g, ''); return d.length >= 9 && d.length <= 15; }
  function show(el, text, kind) { el.textContent = text; el.className = 'msg ' + (kind || 'err'); el.hidden = false; }
  function hide(el) { el.hidden = true; }

  function api(path, body) {
    body = body || {};
    if (session && session.token) body.token = session.token;
    return fetch(API + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { j.__status = r.status; return j; }); })
      .catch(function () { throw new Error('אין תקשורת עם השרת. בדקו את החיבור לאינטרנט ונסו שוב.'); });
  }

  /* ---------- סשן ---------- */
  function saveSession(res) {
    session = { token: res.session_token, expires_at: res.expires_at || null };
    try { localStorage.setItem(KEY, JSON.stringify(session)); } catch (e) {}
  }
  function loadSession() {
    var s; try { s = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { return null; }
    if (!s || !s.token) return null;
    if (s.expires_at && new Date(s.expires_at).getTime() <= Date.now()) { clearSession(); return null; }
    return s;
  }
  function clearSession() { try { localStorage.removeItem(KEY); } catch (e) {} session = null; }
  function sessionLost(res) {
    clearSession();
    $('app').hidden = true; $('who').hidden = true; $('gate').hidden = false;
    $('step-code').hidden = true; $('step-phone').hidden = false;
    show($('phone-msg'), (res && res.message_he) || 'נדרשת כניסה מחדש.');
  }

  /* ---------- כניסה ---------- */
  var phoneIn = $('phone'), codeIn = $('code'), phoneMsg = $('phone-msg'), codeMsg = $('code-msg');
  var phoneBtn = $('phone-btn'), codeBtn = $('code-btn'), resendBtn = $('resend-btn');
  var currentPhone = '', resendTimer = null;

  function cooldown(sec) {
    var left = sec; resendBtn.disabled = true; clearInterval(resendTimer);
    resendBtn.textContent = 'שליחת קוד חדש (' + left + ')';
    resendTimer = setInterval(function () {
      left--;
      resendBtn.textContent = left > 0 ? 'שליחת קוד חדש (' + left + ')' : 'שליחת קוד חדש';
      if (left <= 0) { clearInterval(resendTimer); resendBtn.disabled = false; }
    }, 1000);
  }
  // ספרת ביקורת של ת.ז / ח.פ ישראלי — אותה בדיקה שהשרת עושה
  function idValid(v) {
    var d = String(v || '').replace(/\D/g, '');
    if (d.length < 5 || d.length > 9) return false;
    d = ('000000000' + d).slice(-9);
    if (d === '000000000') return false;
    var s = 0;
    for (var i = 0; i < 9; i++) { var x = Number(d[i]) * (i % 2 ? 2 : 1); s += x > 9 ? x - 9 : x; }
    return s % 10 === 0;
  }
  var currentId = '';
  async function requestOtp(phone) {
    var res = await api('/portal/otp/request', { phone: phone, id_number: currentId });
    if (res.error === 'LOCKED') throw new Error(res.message_he || 'יותר מדי ניסיונות. נסו שוב בעוד 15 דקות.');
    if (res.ok !== true) throw new Error('השירות אינו זמין כרגע. נסו שוב בעוד כמה דקות.');
  }

  $('step-phone').addEventListener('submit', async function (e) {
    e.preventDefault(); hide(phoneMsg);
    var phone = phoneIn.value.trim();
    if (!looksLikePhone(phone)) { show(phoneMsg, 'מספר הטלפון אינו תקין. לדוגמה: 050-000-0000'); phoneIn.focus(); return; }
    var idn = $('idnum').value.replace(/\D/g, '');
    if (!idValid(idn)) { show(phoneMsg, 'מספר תעודת הזהות אינו תקין. הזינו את כל 9 הספרות, כולל ספרת הביקורת.'); $('idnum').focus(); return; }
    currentId = idn;
    phoneBtn.disabled = true; phoneBtn.textContent = 'שולח…';
    try {
      await requestOtp(phone);
      currentPhone = phone; $('phone-echo').textContent = phone;
      $('step-phone').hidden = true; $('step-code').hidden = false; codeIn.value = ''; codeIn.focus(); cooldown(45);
    } catch (err) { show(phoneMsg, err.message); }
    finally { phoneBtn.disabled = false; phoneBtn.textContent = 'שלחו לי קוד'; }
  });
  resendBtn.addEventListener('click', async function () {
    hide(codeMsg); resendBtn.disabled = true;
    try { await requestOtp(currentPhone); show(codeMsg, 'נשלח קוד חדש.', 'ok'); cooldown(45); }
    catch (err) { show(codeMsg, err.message); resendBtn.disabled = false; }
  });
  $('back-btn').addEventListener('click', function () {
    clearInterval(resendTimer); hide(codeMsg); $('step-code').hidden = true; $('step-phone').hidden = false; phoneIn.focus();
  });
  codeIn.addEventListener('input', function () {
    codeIn.value = codeIn.value.replace(/\D/g, '').slice(0, 6);
    if (codeIn.value.length === 6) $('step-code').requestSubmit ? $('step-code').requestSubmit() : codeBtn.click();
  });
  $('step-code').addEventListener('submit', async function (e) {
    e.preventDefault(); hide(codeMsg);
    var code = codeIn.value.trim();
    if (code.length !== 6) { show(codeMsg, 'יש להזין קוד בן 6 ספרות.'); return; }
    if (codeBtn.disabled) return;
    codeBtn.disabled = true; codeBtn.textContent = 'מאמת…';
    try {
      var res = await api('/portal/otp/verify', { phone: currentPhone, code: code });
      if (res.ok !== true || !res.session_token) { show(codeMsg, res.message_he || 'הקוד שגוי או שפג תוקפו.'); codeIn.select(); return; }
      saveSession(res); await enter(true);
    } catch (err) { show(codeMsg, err.message); }
    finally { codeBtn.disabled = false; codeBtn.textContent = 'כניסה'; }
  });
  $('signout').addEventListener('click', async function () {
    try { await api('/portal/logout'); } catch (e) {}
    clearSession(); location.reload();
  });

  /* ---------- טעינה ---------- */
  async function enter(fresh) {
    var res;
    try { res = await api('/portal/home'); } catch (err) { show(phoneMsg, err.message); return; }
    if (res.ok !== true) { sessionLost(res); return; }
    data = res;
    $('gate').hidden = true; $('app').hidden = false; $('who').hidden = false;
    var first = String(res.customer.name || '').split(' ')[0];
    $('who-name').textContent = res.customer.name;
    $('hello-title').textContent = 'שלום ' + (res.customer.type === 'company' ? res.customer.name : first);
    render();
    if (fresh) { $('main').focus(); window.scrollTo(0, 0); }
    loadInventory();
    loadOrders();
  }

  /* ---------- ההזמנה: מה שנשלח אליכם לאישור ---------- */
  var orders = null;
  async function loadOrders() {
    var host = $('orders'), res;
    try { res = await api('/portal/order', { action: 'list' }); } catch (e) { return; }
    if (!res || res.ok !== true) { if (res && res.__status === 401) sessionLost(res); return; }
    orders = res;
    host.innerHTML = (res.orders || []).map(orderHtml).join('');
    host.querySelectorAll('.order').forEach(bindOrder);
  }

  function orderHtml(o) {
    var s = o.snapshot || {}, t = s.totals || {}, st = (o.state || {}).code;
    var badge = st === 'sent' ? ['ממתינה לאישורכם', ' gold'] : st === 'approved' ? ['אישרתם את ההזמנה', ' done'] :
                st === 'closed' ? ['הושלמה', ' done'] : st === 'change_requested' ? ['ביקשתם שינוי', ''] :
                st === 'changed' ? ['מתעדכנת אצלנו', ''] : [(o.state || {}).he || '', ''];
    var h = '<article class="panel order" data-id="' + E(o.id) + '">' +
      '<div class="sec o-head"><div><div class="veh-title">ההזמנה שלכם <span class="o-no">' + E(o.order_number) + '</span></div>' +
      '<div class="veh-sub">נשלחה אליכם ' + E(relDay(o.sent_at)) + '</div></div>' +
      '<span class="badge' + badge[1] + '">' + E(badge[0]) + '</span></div>';

    h += '<div class="sec"><h3>מה בהזמנה</h3>' + (s.items || []).map(function (it) {
      var r = '<div class="o-item"><div class="o-row main"><span><b>' + E(vehName(it)) + '</b>' +
        '<small>' + E([it.model_year, it.color, it.vin ? 'שלדה …' + String(it.vin).slice(-6) : null].filter(Boolean).join(' · ')) + '</small></span>' +
        '<span class="n">' + nis(it.price) + '</span></div>';
      (it.extras || []).forEach(function (x) {
        r += '<div class="o-row"><span>+ ' + E(x.label) + (x.quantity > 1 ? ' × ' + x.quantity : '') + '</span><span class="n">' + nis(x.total) + '</span></div>';
      });
      if (it.trade_in) r += '<div class="o-row muted"><span>זיכוי טרייד-אין · ' + E(it.trade_in.title || '') + '</span><span class="n">−' + nis(it.trade_in.credit) + '</span></div>';
      if (it.expected_delivery_date) r += '<div class="o-row muted"><span>מועד מסירה משוער</span><span>' + fmtDate(it.expected_delivery_date) + '</span></div>';
      if (it.registered_to && it.registered_to.name) r += '<div class="o-row muted"><span>הרכב יירשם ברישיון על שם</span><span>' + E(it.registered_to.name) +
        (it.registered_to.id_tail ? ' · ' + E(it.registered_to.id_label || '') + ' …' + E(it.registered_to.id_tail) : '') + '</span></div>';
      return r + '</div>';
    }).join('') +
    '<div class="o-sum"><div class="o-row"><span>סה״כ כולל מע״מ</span><span class="n">' + nis(t.grand) + '</span></div>' +
      (t.trade_in ? '<div class="o-row muted"><span>זיכוי טרייד-אין</span><span class="n">−' + nis(t.trade_in) + '</span></div>' : '') +
      (t.down_payment ? '<div class="o-row muted"><span>מקדמה</span><span class="n">−' + nis(t.down_payment) + '</span></div>' : '') +
      (t.financing ? '<div class="o-row muted"><span>מימון</span><span class="n">−' + nis(t.financing) + '</span></div>' : '') +
      '<div class="o-row total"><span>יתרה לתשלום</span><span class="n">' + nis(t.balance) + '</span></div></div></div>';

    if (o.can_approve) {
      h += '<div class="sec"><div class="await"><div class="await-title">ממתין לאישורכם</div>' +
        '<label class="consent"><input type="checkbox" class="o-consent"><span>' + E(orders.consent_text || '') + '</span></label>' +
        '<div class="msg err o-msg" hidden></div>' +
        '<div class="o-btns"><button class="btn gold" type="button" data-o-ok>אישור ההזמנה</button>' +
        '<button class="btn ghost" type="button" data-o-change>בקשת שינוי</button></div>' + changeBox() + '</div></div>';
    } else if (st === 'approved') {
      h += '<div class="sec"><p class="o-done">אישרתם את ההזמנה ב-' + fmtDT(o.approved_at) + '. השלב הבא: הסכם המכירה, שיופיע כאן לקריאה ולחתימה.</p>' +
        '<button class="link" type="button" data-o-change>צריך לשנות משהו?</button><div class="msg err o-msg" hidden></div>' + changeBox() + '</div>';
    } else if (st === 'change_requested') {
      h += '<div class="sec"><p class="fine">הבקשה שלכם' + (o.change_requested_at ? ' מ-' + fmtDT(o.change_requested_at) : '') + ': ' + E(o.change_request_note || '') + '<br>הנציג יעדכן את ההזמנה וישלח אותה אליכם שוב.</p></div>';
    } else if (st === 'changed') {
      h += '<div class="sec"><p class="fine">עדכנו את ההזמנה אחרי ששלחנו אותה. נשלח לכם את הגרסה המעודכנת לאישור בקרוב.</p></div>';
    }
    return h + '</article>';
  }
  function vehName(it) {
    var t = it.title || '', tr = it.trim || '';
    if (tr && t && tr.toLowerCase().indexOf(t.toLowerCase()) === 0) return tr;
    return [t, tr].filter(Boolean).join(' · ') || 'רכב';
  }
  function changeBox() {
    return '<div class="o-change" hidden><span class="fine">מה תרצו לשנות?</span>' +
      '<textarea rows="3" maxlength="1000" placeholder="למשל: להוריד את הציפוי, להוסיף וו גרירה…"></textarea>' +
      '<button class="btn gold small" type="button" data-o-send>שליחת הבקשה לנציג</button></div>';
  }
  function bindOrder(card) {
    var id = card.getAttribute('data-id'), msg = card.querySelector('.o-msg');
    var ok = card.querySelector('[data-o-ok]');
    if (ok) ok.addEventListener('click', async function () {
      if (!card.querySelector('.o-consent').checked) { show(msg, 'יש לסמן את ההצהרה כדי לאשר.'); return; }
      ok.disabled = true; ok.textContent = 'מאשר…';
      var r; try { r = await api('/portal/order', { action: 'approve', order_id: id, consent: true }); } catch (e) { r = { ok: false, message_he: e.message }; }
      ok.disabled = false; ok.textContent = 'אישור ההזמנה';
      if (r.__status === 401) { sessionLost(r); return; }
      if (r.ok !== true) { show(msg, r.message_he || 'האישור נכשל.'); return; }
      notice(r.message_he, 'ok'); loadOrders();
    });
    var ch = card.querySelector('[data-o-change]');
    if (ch) ch.addEventListener('click', function () {
      var box = card.querySelector('.o-change'); box.hidden = false; box.querySelector('textarea').focus();
    });
    var send = card.querySelector('[data-o-send]');
    if (send) send.addEventListener('click', async function () {
      var note = card.querySelector('.o-change textarea').value.trim();
      if (!note) { show(msg, 'כתבו מה תרצו לשנות.'); return; }
      send.disabled = true;
      var r; try { r = await api('/portal/order', { action: 'request_change', order_id: id, note: note }); } catch (e) { r = { ok: false, message_he: e.message }; }
      send.disabled = false;
      if (r.__status === 401) { sessionLost(r); return; }
      if (r.ok !== true) { show(msg, r.message_he || 'השליחה נכשלה.'); return; }
      notice(r.message_he, 'ok'); loadOrders();
    });
  }
  async function refresh() {
    var res; try { res = await api('/portal/home'); } catch (e) { return; }
    if (res.ok !== true) { sessionLost(res); return; }
    data = res; render();
  }
  function loadInventory() {
    if (inventory) return;
    fetch('/data/inventory.json', { cache: 'no-cache' }).then(function (r) { return r.json(); })
      .then(function (j) { inventory = (j && j.vehicles) || []; render(); }).catch(function () { inventory = []; });
  }
  function siteVehicle(v) {
    if (!inventory || !v || !v.vin) return null;
    var tail = String(v.vin).slice(-6);
    return inventory.filter(function (x) { return x.id === tail || x.id === v.vin; })[0] || null;
  }

  /* ---------- תצוגה ---------- */
  function render() {
    var host = $('deals');
    if (!data.deals.length) {
      host.innerHTML = '<div class="panel"><div class="empty">עדיין אין עסקה פעילה בתיק שלכם. לכל שאלה — אנחנו כאן: ' +
        '<a href="https://wa.me/972508991090" rel="noopener">וואטסאפ</a> או <a href="tel:+97248419413">04-8419413</a>.</div></div>';
    } else {
      host.innerHTML = data.deals.map(dealHtml).join('');
      bindDeals(host);
    }
    $('me').innerHTML = meHtml();
  }

  var REQ_STATE = { missing: ['חסר', ''], received: ['התקבל · בבדיקה', 'ok'], verified: ['אושר', 'ok'] };

  function dealHtml(d) {
    var v = d.vehicle, p = d.price || {}, closed = d.deal_status === 'completed';
    var sv = siteVehicle(v);
    var img = sv && sv.images && sv.images[0];
    var reqs = (d.requirements || []);
    var slots = d.open_slots || [];
    var needUpload = reqs.filter(function (r) { return r.can_upload && r.status === 'missing'; }).length + slots.length;
    var agrPending = d.agreement && d.agreement.status === 'pending_signature';
    var h = '<article class="panel deal" data-id="' + E(d.id) + '">';

    // רכב
    h += '<div class="veh"><div class="veh-img' + (img ? '' : ' noimg') + '"' + (img ? ' style="background-image:url(\'' + E(img) + '\')"' : '') + ' aria-hidden="true">' + (img ? '' : '◆') + '</div>' +
      '<div><div class="veh-title">' + (v ? E([v.make, v.model].filter(Boolean).join(' ')) : 'הרכב שלכם') + '</div>' +
      '<div class="veh-sub">' + (v ? E([v.trim, v.model_year, v.color, v.license_plate ? 'מ.ר. ' + v.license_plate : (v.vin ? 'שלדה …' + String(v.vin).slice(-6) : null)].filter(Boolean).join(' · ')) : 'הרכב ישויך לעסקה בקרוב') +
      (sv ? ' · <a href="/stock/' + encodeURIComponent(sv.id) + '/">לעמוד הרכב באתר</a>' : '') + '</div></div>' +
      '<span class="badge' + (closed ? ' done' : ' gold') + '">' + E(closed ? 'נמסר' : journeyBadge(d)) + '</span></div>';

    // המסלול: תשלום → שיוך → בדרך לארץ → בארץ → התקנות ‖ רישוי → מסירה
    if (d.journey && d.journey.steps) h += journeyHtml(d.journey, closed);

    // ממתין לכם
    if (!closed && (agrPending || needUpload)) {
      h += '<div class="sec"><div class="await"><div class="await-title">ממתין לכם</div>';
      if (agrPending) h += '<div class="await-row"><span>הסכם המכירה מוכן לקריאה ולחתימה' + (d.agreement.expires_at ? ' (תקף עד ' + fmtDate(d.agreement.expires_at) + ')' : '') + '</span>' +
        '<button class="btn gold small" type="button" data-agr="' + E(d.agreement.id) + '">קריאה וחתימה</button></div>';
      if (needUpload) h += '<div class="await-row"><span>' + (needUpload === 1 ? 'מסמך אחד להעלאה' : needUpload + ' מסמכים להעלאה') + '</span>' +
        '<a class="btn ghost small" href="#docs-' + E(d.id) + '">למסמכים</a></div>';
      h += '</div></div>';
    }

    // עדכונים
    var ups = d.updates || [];
    if (ups.length) {
      h += '<div class="sec"><h3>עדכונים מהצוות</h3><div class="feed">' + ups.map(function (u, i) {
        return '<div class="upd' + (u.kind === 'milestone' ? ' ms' : '') + '"' + (i >= 3 ? ' data-extra hidden' : '') + '><span class="pin" aria-hidden="true"></span><div>' +
          '<div class="meta">' + E(relDay(u.at)) + (u.by ? ' · ' + E(u.by) : '') + '</div><div class="body">' + E(u.body) + '</div></div></div>';
      }).join('') + '</div>' + (ups.length > 3 ? '<button type="button" class="link more" data-more>' + (ups.length - 3 === 1 ? 'עוד עדכון אחד' : 'עוד ' + (ups.length - 3) + ' עדכונים') + '</button>' : '') + '</div>';
    }

    // מסמכים נדרשים
    var reqRows = reqs.map(function (r) {
      var st = REQ_STATE[r.status] || ['', ''];
      var cls = r.status === 'verified' ? 'done' : r.status === 'received' ? 'recv' : (r.is_open_for_upload ? 'ask' : '');
      return '<div class="item ' + cls + '"><span class="mark" aria-hidden="true">' + (r.status === 'verified' ? '✓' : '') + '</span>' +
        '<div class="txt"><div class="t">' + E(r.label_he) + '</div>' +
        '</div>' +
        '<div class="side"><span class="state ' + (r.status === 'missing' && r.is_open_for_upload ? 'ask' : st[1]) + '">' +
          (r.status === 'missing' && r.is_open_for_upload ? 'ביקשנו מכם' : E(st[0])) + (r.files ? ' · ' + r.files + (r.files === 1 ? ' קובץ' : ' קבצים') : '') + '</span>' +
        (r.can_upload ? '<button class="btn ' + (r.status === 'missing' ? 'gold' : 'ghost') + ' small" type="button" data-up-req="' + E(r.id) + '" data-label="' + E(r.label_he) + '">' + (r.status === 'missing' ? 'העלאה' : 'קובץ נוסף') + '</button>' : '') +
        '</div></div>';
    }).join('');
    var slotRows = slots.map(function (s) {
      return '<div class="item ask"><span class="mark" aria-hidden="true"></span><div class="txt"><div class="t">' + E(s.doc_type_he) + '</div>' +
        '<div class="s">ביקשנו מכם' + (s.opened_at ? ' ב-' + fmtDate(s.opened_at) : '') + '</div></div>' +
        '<div class="side"><button class="btn gold small" type="button" data-up-slot="' + E(s.id) + '" data-type="' + E(s.doc_type) + '" data-label="' + E(s.doc_type_he) + '">העלאה</button></div></div>';
    }).join('');
    if (reqRows || slotRows) {
      var done = reqs.filter(function (r) { return r.status !== 'missing'; }).length;
      h += '<div class="sec" id="docs-' + E(d.id) + '"><h3>מסמכים נדרשים<span class="count">' + done + '/' + (reqs.length + slots.length) + '</span></h3>' + slotRows + reqRows +
        '<p class="fine" style="margin-top:10px">אפשר לצלם ישירות מהטלפון. PDF או תמונה, עד 15MB לקובץ.</p></div>';
    }

    // הסכם
    if (d.agreement && !agrPending) {
      var a = d.agreement;
      h += '<div class="sec"><h3>הסכם המכירה</h3><div class="item done"><span class="mark" aria-hidden="true">✓</span><div class="txt"><div class="t">ההסכם נחתם</div>' +
        '<div class="s">' + fmtDT(a.signed_at) + '</div></div><div class="side">' +
        (a.pdf_drive_url ? '<a class="btn ghost small" href="' + E(a.pdf_drive_url) + '" target="_blank" rel="noopener">צפייה</a>' : '') + '</div></div></div>';
    }

    // מסמכים בתיק
    var docs = d.documents || [];
    if (docs.length) {
      h += '<div class="sec"><h3>המסמכים בתיק שלכם<span class="count">' + docs.length + '</span></h3>' + docs.map(function (x) {
        return '<div class="item"><span class="mark" aria-hidden="true">▤</span><div class="txt"><div class="t">' + E(x.doc_type_he) + '</div>' +
          '<div class="s">' + (x.from_customer ? 'הועלה על ידכם · ' : '') + fmtDate(x.created_at) + '</div></div>' +
          '<div class="side">' + (x.url ? '<a class="btn ghost small" href="' + E(x.url) + '" target="_blank" rel="noopener">פתיחה</a>' : '') + '</div></div>';
      }).join('') + '</div>';
    }

    // תמורה
    if (p.total != null) {
      h += '<div class="sec"><h3>פרטי העסקה</h3><div class="kv">' +
        kv('מחיר הרכב', nis(p.total), true) +
        (p.extras_total ? kv('אביזרים ושירותים', nis(p.extras_total)) : '') +
        (p.discount ? kv('הנחה', nis(p.discount)) : '') +
        (p.down_payment ? kv('מקדמה ששולמה', nis(p.down_payment)) : '') +
        (p.trade_in_credit ? kv('זיכוי טרייד-אין', nis(p.trade_in_credit)) : '') +
        (p.financing_amount ? kv('מימון', nis(p.financing_amount)) : '') +
        (p.balance != null ? kv('יתרה לתשלום', nis(p.balance), true) : '') +
        '</div>' + (p.price_includes_vat ? '<p class="fine" style="margin-top:10px">המחירים כוללים מע״מ.</p>' : '') + '</div>';
    }

    // איש קשר
    var sp = d.salesperson, b = data.brand || {};
    h += '<div class="sec"><h3>מי מלווה אתכם</h3><div class="contact">' +
      '<span class="avatar" aria-hidden="true">' + E(sp ? sp.name.charAt(0) : 'י') + '</span>' +
      '<div class="who-c"><div class="n">' + E(sp ? sp.name : (b.name || 'ידידיה מוטורס')) + '</div><div class="r">' + (sp ? 'הנציג שלכם בידידיה מוטורס' : 'צוות המכירות') + '</div></div>' +
      '<div class="actions">' +
        (sp && sp.phone_intl ? '<a class="btn ghost small" href="https://wa.me/' + E(sp.phone_intl) + '" rel="noopener">וואטסאפ</a><a class="btn ghost small" href="tel:+' + E(sp.phone_intl) + '">' + E(sp.phone) + '</a>'
          : '<a class="btn ghost small" href="https://wa.me/' + E(b.whatsapp || '972508991090') + '" rel="noopener">וואטסאפ</a><a class="btn ghost small" href="tel:+97248419413">04-8419413</a>') +
      '</div></div></div>';

    return h + '</article>';
  }
  function journeyBadge(d) {
    var j = d.journey;
    if (!j || !j.steps) return d.status_he;
    var by = {}; j.steps.forEach(function (x) { by[x.key] = x; });
    if (j.delivered) return 'נמסר';
    if (by.delivery && by.delivery.state === 'active') return 'נקבע מועד מסירה';
    if (by.install && (by.install.state !== 'todo' || by.license.state !== 'todo')) return 'בהכנה למסירה';
    if (j.in_israel && by.assigned.state === 'done') return 'הרכב בארץ';
    if (by.transit && by.transit.state === 'active') return 'בדרך לארץ';
    return by.assigned.state === 'done' ? 'הרכב שויך' : d.status_he;
  }

  function stepItem(s, extraCls) {
    var mark = s.state === 'done' ? '✓' : '';
    var items = (s.items || []).length ? '<ul class="jr-items">' + s.items.map(function (x) {
      return '<li>' + E(x.label) + (x.qty > 1 ? ' ×' + E(x.qty) : '') + '</li>';
    }).join('') + '</ul>' : '';
    return '<div class="jr-step ' + s.state + (extraCls || '') + '"' + (s.state === 'active' ? ' aria-current="step"' : '') + '>' +
      '<span class="jr-dot" aria-hidden="true">' + mark + '</span>' +
      '<div class="jr-body"><div class="jr-t">' + E(s.label_he) +
        (s.state === 'active' ? '<span class="jr-now">' + ({ payment: 'ממתין', assigned: 'ממתין', transit: 'בדרך', delivery: 'נקבע' }[s.key] || 'בתהליך') + '</span>' : '') + '</div>' +
        (s.detail ? '<div class="jr-d">' + E(s.detail) + '</div>' : '') + items + '</div></div>';
  }

  function journeyHtml(j, closed) {
    var by = {}; j.steps.forEach(function (x) { by[x.key] = x; });
    // שורת הדגשה: מועד מסירה, או זמן הגעה משוער
    var hi = '';
    if (!closed && by.delivery && by.delivery.state === 'active') hi = '<div class="jr-hi"><span>מועד המסירה</span><b>' + E(by.delivery.detail.replace(/^נקבע ליום /, '')) + '</b></div>';
    else if (by.transit && by.transit.state === 'active' && by.transit.eta) hi = '<div class="jr-hi"><span>הגעה משוערת לארץ</span><b>' + E(by.transit.detail.replace(/^הגעה משוערת: /, '')) + '</b>' +
      (by.transit.eta_updated_at ? '<small>עודכן ' + E(fmtDate(by.transit.eta_updated_at)) + '</small>' : '') + '</div>';
    var h = '<div class="sec"><h3>המסלול של הרכב שלכם</h3>' + hi + '<div class="jr">';
    var prepDone = false;
    j.steps.forEach(function (s) {
      if (s.group === 'prep') {
        if (prepDone) return;
        prepDone = true;
        var a = by.install, b = by.license;
        var st = a.state === 'done' && b.state === 'done' ? 'done' : (a.state !== 'todo' || b.state !== 'todo') ? 'active' : 'todo';
        h += '<div class="jr-step jr-group ' + st + '"><span class="jr-dot" aria-hidden="true">' + (st === 'done' ? '✓' : '') + '</span>' +
          '<div class="jr-body"><div class="jr-t">הכנת הרכב<span class="jr-par">שני התהליכים רצים במקביל</span></div>' +
          '<div class="jr-pair">' + stepItem(a, ' sub') + stepItem(b, ' sub') + '</div></div></div>';
      } else {
        h += stepItem(s);
      }
    });
    return h + '</div></div>';
  }

  function kv(k, v, big) { return '<div><span class="k">' + E(k) + '</span><span class="v' + (big ? ' big' : '') + '">' + E(v) + '</span></div>'; }

  function meHtml() {
    var c = data.customer, rows = [];
    rows.push(['שם', c.name]);
    if (c.contact_person) rows.push(['איש קשר', c.contact_person]);
    rows.push(['טלפון', c.phone]);
    if (c.id_masked) rows.push([c.type === 'company' ? 'ח.פ / ע.מ' : 'ת.ז.', c.id_masked]);
    if (c.invoice_email) rows.push(['מייל לחשבונית', c.invoice_email]);
    if (c.address) rows.push(['כתובת', c.address]);
    return '<div class="sec"><h3 id="me-title">הפרטים שלכם</h3><div class="details">' + rows.map(function (r) {
      return '<div><div class="k">' + E(r[0]) + '</div><div class="v"' + (/@|\d{3}/.test(r[1] || '') ? ' dir="ltr" style="text-align:right"' : '') + '>' + E(r[1] || '—') + '</div></div>';
    }).join('') + '</div><p class="fine" style="margin-top:12px">משהו לא מעודכן? כתבו לנציג שלכם ונתקן.</p></div>';
  }

  function bindDeals(host) {
    host.querySelectorAll('[data-agr]').forEach(function (b) { b.addEventListener('click', function () { openAgreement(b.getAttribute('data-agr')); }); });
    host.querySelectorAll('[data-more]').forEach(function (b) {
      b.addEventListener('click', function () {
        b.parentNode.querySelectorAll('[data-extra]').forEach(function (x) { x.hidden = false; }); b.remove();
      });
    });
    host.querySelectorAll('[data-up-req]').forEach(function (b) {
      b.addEventListener('click', function () {
        pickFile({ doc_type: 'requirement', target_id: b.getAttribute('data-up-req'), label: b.getAttribute('data-label'), btn: b });
      });
    });
    host.querySelectorAll('[data-up-slot]').forEach(function (b) {
      var dealId = b.closest('.deal').getAttribute('data-id');
      b.addEventListener('click', function () {
        pickFile({ doc_type: b.getAttribute('data-type'), target_id: dealId, document_id: b.getAttribute('data-up-slot'), label: b.getAttribute('data-label'), btn: b });
      });
    });
  }

  function notice(text, kind) {
    var el = $('notice');
    if (!text) { el.innerHTML = ''; return; }
    el.innerHTML = '<div class="msg ' + (kind || 'err') + '">' + E(text) + '</div>';
    if (kind === 'ok') setTimeout(function () { if (el.textContent === text) el.innerHTML = ''; }, 7000);
  }

  /* ---------- העלאת מסמך ---------- */
  var fileInput = $('file-input'), pending = null;
  function pickFile(ctx) { pending = ctx; fileInput.value = ''; fileInput.click(); }
  fileInput.addEventListener('change', async function () {
    var f = fileInput.files && fileInput.files[0], ctx = pending; pending = null;
    if (!f || !ctx) return;
    if (f.size > MAX_FILE) { notice('הקובץ גדול מדי — עד 15MB. אפשר לצלם שוב באיכות נמוכה יותר.'); return; }
    var orig = ctx.btn.textContent; ctx.btn.disabled = true; ctx.btn.textContent = 'מעלה…';
    notice('מעלה את "' + ctx.label + '"…', 'info');
    var fd = new FormData();
    fd.append('token', session.token);
    fd.append('scope', 'portal');
    fd.append('target_id', ctx.target_id);
    if (ctx.document_id) fd.append('document_id', ctx.document_id);
    fd.append('doc_type', ctx.doc_type);
    fd.append('file', f, f.name);
    var r;
    try {
      var resp = await fetch(API + '/documents/upload', { method: 'POST', body: fd });
      r = await resp.json().catch(function () { return { ok: false }; });
      if (resp.status === 401) { sessionLost(r); return; }
    } catch (err) { r = { ok: false, message_he: 'אין תקשורת עם השרת. נסו שוב.' }; }
    ctx.btn.disabled = false; ctx.btn.textContent = orig;
    if (r.ok) { notice('"' + ctx.label + '" התקבל. תודה! נעבור עליו ונעדכן.', 'ok'); refresh(); }
    else notice(r.message_he || 'ההעלאה נכשלה. נסו שוב או שלחו לנציג בוואטסאפ.');
  });

  /* ---------- ההסכם ---------- */
  var agrModal = $('agr-modal'), agrMsg = $('agr-msg'), consent = $('agr-consent');
  var otpWrap = $('otp-wrap'), signCode = $('sign-code'), btnStart = $('sig-start'), btnSubmit = $('sig-submit');
  var lastFocus = null;

  async function openAgreement(id) {
    hide(agrMsg); notice('');
    var res = await api('/portal/agreement', { agreement_id: id });
    if (res.__status === 401) { sessionLost(res); return; }
    if (res.ok !== true) { notice(res.message_he || 'לא ניתן לפתוח את ההסכם.'); return; }
    currentAgreement = res;
    $('agr-body').innerHTML = res.html;   // HTML שנבנה בשרת מתבנית ההסכם — אותו טקסט שנחתם
    $('agr-consent-text').textContent = res.consent_text || 'קראתי ואני מאשר/ת את ההסכם.';
    $('agr-sign').hidden = !res.can_sign; $('agr-done').hidden = true;
    consent.checked = false; otpWrap.hidden = true; signCode.value = '';
    btnStart.hidden = false; btnSubmit.hidden = true;
    lastFocus = document.activeElement;
    agrModal.hidden = false; document.body.style.overflow = 'hidden';
    clearSig(); $('agr-body').scrollTop = 0; $('agr-body').focus();
    if (!res.can_sign && res.expired) notice('תוקף ההסכם פג. פנו לנציג להנפקת הסכם מעודכן.');
  }
  function closeModal() { agrModal.hidden = true; document.body.style.overflow = ''; if (lastFocus) lastFocus.focus(); }

  btnStart.addEventListener('click', async function () {
    hide(agrMsg);
    if (!consent.checked) { show(agrMsg, 'יש לאשר את הצהרת ההסכמה לפני החתימה.'); return; }
    if (!dirty) { show(agrMsg, 'חסרה חתימה — ציירו את החתימה שלכם במסגרת.'); return; }
    btnStart.disabled = true; btnStart.textContent = 'שולח קוד…';
    try {
      var res = await api('/portal/sign/start', { agreement_id: currentAgreement.agreement.id });
      if (res.ok !== true) { show(agrMsg, res.message_he || 'שליחת הקוד נכשלה.'); return; }
      otpWrap.hidden = false; btnStart.hidden = true; btnSubmit.hidden = false;
      show(agrMsg, res.message_he || 'שלחנו קוד אימות לטלפון שלכם.', 'ok'); signCode.focus();
    } catch (err) { show(agrMsg, err.message); }
    finally { btnStart.disabled = false; btnStart.textContent = 'שלחו לי קוד לחתימה'; }
  });
  signCode.addEventListener('input', function () { signCode.value = signCode.value.replace(/\D/g, '').slice(0, 6); });
  btnSubmit.addEventListener('click', async function () {
    hide(agrMsg);
    if (!consent.checked) { show(agrMsg, 'יש לאשר את הצהרת ההסכמה.'); return; }
    if (!dirty) { show(agrMsg, 'חסרה חתימה.'); return; }
    if (signCode.value.length !== 6) { show(agrMsg, 'יש להזין את הקוד בן 6 הספרות.'); return; }
    btnSubmit.disabled = true; btnSubmit.textContent = 'חותם…';
    try {
      var res = await api('/portal/sign', { agreement_id: currentAgreement.agreement.id, code: signCode.value, consent: true, signature_png: canvas.toDataURL('image/png') });
      if (res.ok !== true) { show(agrMsg, res.message_he || 'החתימה נכשלה.'); return; }
      $('agr-sign').hidden = true; $('agr-done').hidden = false;
      var link = $('agr-pdf');
      if (res.pdf_url) { link.href = res.pdf_url; link.hidden = false; } else link.hidden = true;
      refresh();
    } catch (err) { show(agrMsg, err.message); }
    finally { btnSubmit.disabled = false; btnSubmit.textContent = 'חתימה על ההסכם'; }
  });
  $('agr-print').addEventListener('click', function () { window.print(); });
  document.querySelectorAll('[data-close]').forEach(function (b) { b.addEventListener('click', closeModal); });
  agrModal.addEventListener('click', function (e) { if (e.target === agrModal) closeModal(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !agrModal.hidden) closeModal(); });

  /* ---------- קנבס החתימה ---------- */
  var canvas = $('sig'), ctx2 = canvas.getContext('2d'), drawing = false, dirty = false, last = null;
  function sizeCanvas() {
    var ratio = window.devicePixelRatio || 1, w = canvas.clientWidth || 640, h = canvas.clientHeight || 180;
    canvas.width = Math.round(w * ratio); canvas.height = Math.round(h * ratio);
    ctx2.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx2.fillStyle = '#fff'; ctx2.fillRect(0, 0, w, h);
    ctx2.lineWidth = 2.2; ctx2.lineCap = 'round'; ctx2.lineJoin = 'round'; ctx2.strokeStyle = '#111';
  }
  function clearSig() { sizeCanvas(); dirty = false; }
  function pos(e) { var r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
  canvas.addEventListener('pointerdown', function (e) {
    e.preventDefault(); canvas.setPointerCapture(e.pointerId); drawing = true; dirty = true; last = pos(e);
    ctx2.beginPath(); ctx2.moveTo(last.x, last.y); ctx2.lineTo(last.x + 0.1, last.y); ctx2.stroke();
  });
  canvas.addEventListener('pointermove', function (e) {
    if (!drawing) return; e.preventDefault();
    var p = pos(e); ctx2.beginPath(); ctx2.moveTo(last.x, last.y); ctx2.lineTo(p.x, p.y); ctx2.stroke(); last = p;
  });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach(function (ev) { canvas.addEventListener(ev, function () { drawing = false; }); });
  $('sig-clear').addEventListener('click', clearSig);
  window.addEventListener('resize', function () { if (!dirty && !agrModal.hidden) sizeCanvas(); });

  /* ---------- התחלה ---------- */
  session = loadSession();
  if (session) enter(false); else phoneIn.focus();
})();

/* ------------------------------------------------------------
   פתיחת מסמכים מתוך הדף (קישורי /webhook/doc)
   חוסמי פרסומות (AdBlock, uBlock Lite ועוד) חוסמים מעבר לכתובת
   duckdns בלשונית חדשה — ERR_BLOCKED_BY_CLIENT. לכן מושכים את המסמך
   ב-fetch (כמו כל קריאה אחרת לשרת) ופותחים אותו מהזיכרון.
   ------------------------------------------------------------ */
(function () {
  'use strict';
  var DOC_PREFIX = 'https://yedidiamotors.duckdns.org/webhook/doc?';
  var VIEWABLE = /^(application\/pdf|image\/|text\/plain)/i;

  function msgPage(w, title, text) {
    if (!w || w.closed) return;
    try {
      w.document.open();
      w.document.write('<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8">' +
        '<meta name="viewport" content="width=device-width,initial-scale=1"><title>ידידיה מוטורס — מסמך</title>' +
        '<style>body{font-family:system-ui,Arial,sans-serif;background:#f5f5f4;color:#1c1917;display:flex;min-height:100vh;' +
        'align-items:center;justify-content:center;margin:0;padding:16px}main{background:#fff;border-radius:12px;padding:28px 24px;' +
        'max-width:420px;box-shadow:0 1px 3px rgba(0,0,0,.08)}h1{font-size:18px;margin:0 0 8px}p{margin:0;line-height:1.6;color:#44403c}</style>' +
        '</head><body><main><h1>' + title + '</h1><p>' + text + '</p></main></body></html>');
      w.document.close();
    } catch (e) {}
  }

  function fileNameFrom(r) {
    var cd = r.headers.get('Content-Disposition') || '';
    var m = /filename\*=UTF-8''([^;]+)/i.exec(cd);
    if (m) { try { return decodeURIComponent(m[1]); } catch (e) {} }
    m = /filename="?([^";]+)"?/i.exec(cd);
    return m ? m[1] : 'document';
  }

  function saveAs(url, name) {
    var a = document.createElement('a');
    a.href = url; a.download = name; a.style.display = 'none';
    document.body.appendChild(a); a.click();
    setTimeout(function () { a.remove(); }, 0);
  }

  function openDoc(href) {
    var w = null;
    try { w = window.open('', '_blank'); } catch (e) {}
    msgPage(w, 'פותח את המסמך…', 'רק רגע.');

    fetch(href, { method: 'GET', cache: 'no-store', credentials: 'omit' }).then(function (r) {
      var type = r.headers.get('Content-Type') || '';
      if (!r.ok || /text\/html/i.test(type)) {
        return r.text().then(function (html) {
          if (w && !w.closed && html) { w.document.open(); w.document.write(html); w.document.close(); }
          else alert('לא ניתן לפתוח את המסמך. רעננו את הדף ונסו שוב.');
        });
      }
      var name = fileNameFrom(r);
      return r.blob().then(function (b) {
        var url = URL.createObjectURL(b);
        setTimeout(function () { URL.revokeObjectURL(url); }, 120000);
        if (VIEWABLE.test(b.type || type) && w && !w.closed) {
          w.location.href = url;
        } else {
          saveAs(url, name);
          if (w && !w.closed) msgPage(w, 'המסמך הורד', 'הקובץ "' + name.replace(/[<>&"]/g, '') + '" נשמר בתיקיית ההורדות. אפשר לסגור את הלשונית.');
        }
      });
    }).catch(function () {
      if (w && !w.closed) msgPage(w, 'לא ניתן לפתוח את המסמך', 'אין תקשורת עם השרת. בדקו את החיבור לאינטרנט ונסו שוב.');
      else alert('לא ניתן לפתוח את המסמך — אין תקשורת עם השרת.');
    });
  }

  document.addEventListener('click', function (e) {
    if (e.defaultPrevented || e.button !== 0) return;
    var a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if (!a || String(a.href).indexOf(DOC_PREFIX) !== 0) return;
    e.preventDefault();
    openDoc(a.href);
  });
})();
