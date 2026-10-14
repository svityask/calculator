(function () {
  'use strict';

  var LS_USER = 'indastro-calc-user';
  var LS_DRAFT = 'indastro-calc-settings-draft';
  var LS_GH = 'indastro-calc-github';
  var SS_ADMIN = 'indastro-calc-admin';
  var SS_TOKEN = 'indastro-calc-gh-token';

  var $ = function (id) { return document.getElementById(id); };
  var published = null;   // настройки из settings.json
  var settings = null;    // действующие настройки (опубликованные или локальный черновик)
  var edit = null;        // копия, которую правит администратор
  var adminSys = 0;
  var user = loadJSON(localStorage, LS_USER) || { sys: null, bySys: {} };

  // ---------- утилиты ----------
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function loadJSON(store, key) {
    try { var v = store.getItem(key); return v ? JSON.parse(v) : null; } catch (e) { return null; }
  }
  function saveJSON(store, key, val) {
    try { store.setItem(key, JSON.stringify(val)); } catch (e) { /* приватный режим и т.п. */ }
  }
  function removeKey(store, key) { try { store.removeItem(key); } catch (e) {} }
  function parseNum(s) {
    if (typeof s === 'number') return s;
    s = String(s).replace(/\s| /g, '').replace(',', '.');
    if (s === '' || s === '-' || s === '.') return NaN;
    return Number(s);
  }
  function clamp(v, min, max) { return Math.min(max, Math.max(min, v)); }
  function fmt(v, d) {
    return Number(v).toLocaleString('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: d == null ? 2 : d });
  }
  function fmtFixed(v, d) {
    return Number(v).toLocaleString('ru-RU', { minimumFractionDigits: d, maximumFractionDigits: d });
  }
  function money(v) { return fmt(Math.round(v), 0) + ' ₽'; }
  function money2(v) { return fmtFixed(v, 2) + ' ₽'; }
  function el(tag, attrs, children) {
    var n = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === 'class') n.className = attrs[k];
      else if (k === 'text') n.textContent = attrs[k];
      else if (k === 'html') n.innerHTML = attrs[k];
      else if (k.slice(0, 2) === 'on') n.addEventListener(k.slice(2), attrs[k]);
      else n.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) { if (c != null) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return n;
  }
  function decimalsOf(step) {
    var s = String(step); var i = s.indexOf('.'); return i < 0 ? 0 : s.length - i - 1;
  }
  var toastTimer;
  function toast(msg) {
    var t = $('toast'); t.textContent = msg; t.classList.add('is-visible');
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.classList.remove('is-visible'); }, 2600);
  }
  function sha256(text) {
    if (!window.crypto || !crypto.subtle) return Promise.reject(new Error('no-crypto'));
    return crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)).then(function (buf) {
      return Array.prototype.map.call(new Uint8Array(buf), function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
    });
  }

  // ---------- загрузка настроек ----------
  function init() {
    fetch('settings.json?ts=' + Date.now(), { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .catch(function () { return clone(window.CALC_DEFAULTS); })
      .then(function (pub) {
        published = pub;
        var draft = loadJSON(localStorage, LS_DRAFT);
        settings = draft && isValidShape(draft) ? draft : clone(published);
        $('draftBanner').hidden = !draft;
        $('footCompany').textContent = settings.company || '';
        $('footSite').textContent = settings.site || 'www.indastro.ru';
        buildUser();
        bindStatic();
        if (location.hash === '#admin') setMode('admin');
      });
  }

  function isValidShape(s) {
    return s && Array.isArray(s.systems) && s.systems.length > 0 && s.systems.every(function (sys) {
      return sys.thickness && sys.area && Array.isArray(sys.steps);
    });
  }

  // ---------- пользовательский режим ----------
  function currentSystem() {
    var idx = 0;
    settings.systems.forEach(function (s, i) { if (s.id === user.sys) idx = i; });
    return settings.systems[idx];
  }
  function sysState(sys) {
    var st = user.bySys[sys.id] || (user.bySys[sys.id] = {});
    if (typeof st.area !== 'number') st.area = sys.area.value;
    if (typeof st.thickness !== 'number') st.thickness = sys.thickness.value;
    if (!st.coefs) st.coefs = {};
    if (typeof st.sealer !== 'boolean') st.sealer = false;
    // значения пользователя всегда в пределах, заданных администратором
    st.area = clamp(st.area, sys.area.min, sys.area.max);
    st.thickness = clamp(st.thickness, sys.thickness.min, sys.thickness.max);
    sys.steps.forEach(function (step, si) {
      if (step.type !== 'layer') return;
      step.materials.forEach(function (m, mi) {
        var k = si + '.' + mi;
        if (typeof st.coefs[k] === 'number') st.coefs[k] = clamp(st.coefs[k], m.coef.min, m.coef.max);
      });
    });
    return st;
  }
  function saveUser() { saveJSON(localStorage, LS_USER, user); }

  function buildUser() {
    var tabs = $('systemTabs'); tabs.innerHTML = '';
    if (!settings.systems.some(function (s) { return s.id === user.sys; })) user.sys = settings.systems[0].id;
    settings.systems.forEach(function (s) {
      var active = s.id === user.sys;
      tabs.appendChild(el('button', {
        type: 'button', role: 'tab', 'aria-selected': String(active), class: 'sys-btn' + (active ? ' is-active' : ''),
        onclick: function () { user.sys = s.id; saveUser(); buildUser(); }
      }, [el('b', { text: s.title }), el('span', { text: s.subtitle || '' })]));
    });

    var sys = currentSystem();
    var st = sysState(sys);
    $('heroTitle').textContent = sys.subtitle || sys.title;

    numberField($('fArea'), {
      label: 'Площадь', unit: 'м²', lim: sys.area, value: st.area, step: 1, slider: false,
      onChange: function (v) { st.area = v; saveUser(); renderResults(); }
    });
    numberField($('fThickness'), {
      label: 'Толщина', unit: 'мм', lim: sys.thickness, value: st.thickness, step: sys.thickness.step || 0.1, slider: true,
      onChange: function (v) { st.thickness = v; saveUser(); renderResults(); }
    });

    var optional = sys.steps.filter(function (s) { return s.optional; })[0];
    $('optSealer').closest('.switch').hidden = !optional;
    $('optSealer').checked = st.sealer;
    if (optional) $('optSealerLabel').textContent = 'Добавить: ' + optional.op.replace(/\s*\(.*\)\s*$/, '').toLowerCase() + ' — ' + optional.materials.map(function (m) { return m.name.split('—').pop().trim().toLowerCase(); }).join(', ');

    buildCoefs(sys, st);
    renderResults();
  }

  // поле ввода числа с подсказкой о допустимом диапазоне и (опционально) ползунком
  function numberField(box, o) {
    box.innerHTML = '';
    var dec = decimalsOf(o.step);
    var id = 'in' + Math.random().toString(36).slice(2, 8);
    var input = el('input', { id: id, type: 'text', inputmode: 'decimal', autocomplete: 'off', value: fmtInput(o.value, dec) });
    var hint = el('div', { class: 'field__hint' });
    var range = o.slider ? el('input', { type: 'range', min: o.lim.min, max: o.lim.max, step: o.step, value: o.value, 'aria-label': o.label }) : null;
    function rangeText() { return 'от ' + fmt(o.lim.min, dec) + ' до ' + fmt(o.lim.max, dec) + ' ' + o.unit; }
    hint.textContent = rangeText();
    input.addEventListener('input', function () {
      var v = parseNum(input.value);
      var bad = !isFinite(v) || v < o.lim.min || v > o.lim.max;
      input.classList.toggle('is-invalid', bad);
      hint.classList.toggle('is-error', bad);
      hint.textContent = bad ? 'Допустимо ' + rangeText() : rangeText();
      if (isFinite(v)) { v = clamp(v, o.lim.min, o.lim.max); if (range) range.value = v; o.onChange(v); }
    });
    input.addEventListener('blur', function () {
      var v = parseNum(input.value);
      v = isFinite(v) ? clamp(v, o.lim.min, o.lim.max) : o.lim.min;
      input.value = fmtInput(v, dec); input.classList.remove('is-invalid'); hint.classList.remove('is-error'); hint.textContent = rangeText();
      if (range) range.value = v;
      o.onChange(v);
    });
    if (range) range.addEventListener('input', function () {
      var v = Number(range.value); input.value = fmtInput(v, dec);
      input.classList.remove('is-invalid'); hint.classList.remove('is-error'); hint.textContent = rangeText();
      o.onChange(v);
    });
    box.appendChild(el('label', { for: id, class: 'field__label', html: '<b>' + o.label + '</b>, ' + o.unit }));
    box.appendChild(el('div', { class: 'num' }, [input, el('span', { class: 'num__unit', text: o.unit })]));
    if (range) box.appendChild(range);
    box.appendChild(hint);
  }
  function fmtInput(v, dec) { return String(Number(v.toFixed(Math.max(dec, 2)))).replace('.', ','); }

  function buildCoefs(sys, st) {
    var list = $('coefList'); list.innerHTML = '';
    sys.steps.forEach(function (step, si) {
      if (step.type !== 'layer') return;
      var badge = el('span', { class: 'badge' });
      var box = el('div', { class: 'coef-step', 'data-step': si }, [
        el('div', { class: 'coef-step__head' }, [el('h3', { text: step.op }), badge]),
        step.note ? el('p', { class: 'coef-step__note', text: step.note }) : null
      ]);
      step.materials.forEach(function (m, mi) {
        var k = si + '.' + mi;
        var val = typeof st.coefs[k] === 'number' ? st.coefs[k] : m.coef.value;
        var num = el('input', { class: 'coef-row__val', type: 'text', inputmode: 'decimal', value: fmtInput(val, 2), 'aria-label': 'Коэффициент: ' + m.name });
        var range = el('input', { type: 'range', min: m.coef.min, max: m.coef.max, step: 0.05, value: val, 'aria-label': 'Коэффициент: ' + m.name });
        function set(v, fromRange) {
          v = clamp(v, m.coef.min, m.coef.max);
          st.coefs[k] = v; saveUser();
          if (fromRange) num.value = fmtInput(v, 2); else range.value = v;
          renderResults();
        }
        range.addEventListener('input', function () { set(Number(range.value), true); });
        num.addEventListener('input', function () {
          var v = parseNum(num.value);
          num.classList.toggle('is-invalid', !isFinite(v) || v < m.coef.min || v > m.coef.max);
          if (isFinite(v)) set(v, false);
        });
        num.addEventListener('blur', function () {
          num.classList.remove('is-invalid');
          num.value = fmtInput(typeof st.coefs[k] === 'number' ? st.coefs[k] : m.coef.value, 2);
        });
        box.appendChild(el('div', { class: 'coef-row' }, [
          el('div', { class: 'coef-row__top' }, [el('span', { class: 'coef-row__name', text: shortName(m.name) }), num]),
          range,
          el('div', { class: 'coef-row__range' }, [el('span', { text: 'мин ' + fmt(m.coef.min) }), el('span', { text: 'макс ' + fmt(m.coef.max) })])
        ]));
      });
      list.appendChild(box);
    });
  }
  function shortName(n) { return n.replace(/^Индастро\s+Левелайн\s+/i, ''); }

  function renderResults() {
    var sys = currentSystem(), st = sysState(sys);
    st.sealer = $('optSealer').checked;
    var r = Calc.calculate(sys, { thickness: st.thickness, area: st.area, coefs: st.coefs, includeOptional: st.sealer });

    $('tTotal').textContent = money(r.total);
    $('tPerM2').textContent = money2(r.perM2);
    $('sTotal').textContent = money(r.total);
    $('sPerM2').textContent = money2(r.perM2) + ' / м²';

    // проверка соотношений песок/пол
    r.steps.forEach(function (s, si) {
      var box = document.querySelector('.coef-step[data-step="' + si + '"] .badge');
      if (!box || s.ratio == null) return;
      var ok = s.ratioMax == null || s.ratio <= s.ratioMax + 1e-9;
      box.className = 'badge ' + (ok ? 'badge--ok' : 'badge--warn');
      box.textContent = 'песок/пол ' + fmtFixed(s.ratio, 2) + (s.ratioMax != null ? (ok ? ' ✓' : ' > ' + fmt(s.ratioMax)) : '');
    });

    var out = $('results'); out.innerHTML = '';
    r.steps.forEach(function (s) {
      var sum = s.rows.reduce(function (a, x) { return a + x.cost; }, 0);
      var card = el('div', { class: 'step' + (s.included ? '' : ' is-off') }, [
        el('div', { class: 'step__head' }, [
          el('h3', { text: s.op }),
          el('span', { class: 'step__sum', text: s.included ? money(sum) : 'не включено' })
        ])
      ]);
      s.rows.forEach(function (x) {
        card.appendChild(el('div', { class: 'mat' }, [
          el('div', { class: 'mat__name', text: x.name }),
          el('dl', { class: 'mat__grid' }, [
            dItem('Расход', fmtFixed(x.perM2, 3) + ' кг/м²'),
            dItem('На площадь', fmt(x.onArea, 1) + ' кг'),
            dItem('Комплектов', fmt(x.packs, 0) + ' × ' + fmt(x.pack) + ' кг'),
            dItem('Кол-во кратно компл.', fmt(x.qty, 1) + ' кг')
          ]),
          el('div', { class: 'mat__cost' }, [
            el('span', { class: 'muted', text: fmt(x.price) + ' ₽/кг' }),
            el('b', { text: money(x.cost) })
          ])
        ]));
      });
      out.appendChild(card);
    });
    lastResult = { sys: sys, st: st, r: r };
  }
  var lastResult = null;
  function dItem(t, v) { return el('div', null, [el('dt', { text: t }), el('dd', { text: v })]); }

  function shareText() {
    var x = lastResult; if (!x) return '';
    var lines = ['INDASTRO — ' + (x.sys.subtitle || x.sys.title),
      'Площадь: ' + fmt(x.st.area) + ' м², толщина: ' + fmt(x.st.thickness) + ' мм', ''];
    x.r.steps.forEach(function (s) {
      if (!s.included) return;
      lines.push(s.op + ':');
      s.rows.forEach(function (row) {
        lines.push('• ' + row.name + ' — ' + fmtFixed(row.perM2, 3) + ' кг/м², ' + fmt(row.packs, 0) + ' компл. × ' + fmt(row.pack) + ' кг = ' + fmt(row.qty, 1) + ' кг, ' + money(row.cost));
      });
    });
    lines.push('', 'Итого: ' + money(x.r.total) + ' (' + money2(x.r.perM2) + ' за м²)');
    lines.push(settings.site || 'www.indastro.ru');
    return lines.join('\n');
  }

  // ---------- режимы ----------
  function setMode(mode) {
    document.querySelectorAll('.mode__btn').forEach(function (b) {
      var on = b.getAttribute('data-mode') === mode;
      b.classList.toggle('is-active', on); b.setAttribute('aria-selected', String(on));
    });
    $('userView').hidden = mode !== 'user';
    $('adminView').hidden = mode !== 'admin';
    document.body.classList.toggle('is-admin', mode === 'admin');
    $('heroTitle').textContent = mode === 'admin' ? 'Режим администратора' : $('heroTitle').textContent;
    if (mode === 'admin') {
      var authed = sessionStorage.getItem(SS_ADMIN) === '1';
      $('adminLogin').hidden = authed; $('adminPanel').hidden = !authed;
      if (authed) openEditor(); else setTimeout(function () { $('adminPass').focus(); }, 50);
      $('stickyTotal').classList.remove('is-visible');
      if (location.hash !== '#admin') history.replaceState(null, '', '#admin');
    } else {
      if (location.hash) history.replaceState(null, '', location.pathname + location.search);
      buildUser();
    }
    window.scrollTo(0, 0);
  }

  // ---------- администратор ----------
  function openEditor() {
    edit = clone(settings);
    adminSys = Math.min(adminSys, edit.systems.length - 1);
    buildEditor();
    var gh = loadJSON(localStorage, LS_GH) || {};
    $('ghRepo').value = gh.repo || guessRepo();
    $('ghBranch').value = gh.branch || 'main';
    try { $('ghToken').value = sessionStorage.getItem(SS_TOKEN) || ''; } catch (e) {}
  }
  function guessRepo() {
    var m = location.hostname.match(/^([\w-]+)\.github\.io$/i);
    var seg = location.pathname.split('/').filter(Boolean)[0];
    return m && seg ? m[1] + '/' + seg : 'svityask/calculator';
  }

  function buildEditor() {
    var tabs = $('adminSystemTabs'); tabs.innerHTML = '';
    edit.systems.forEach(function (s, i) {
      tabs.appendChild(el('button', { type: 'button', class: 'sys-btn' + (i === adminSys ? ' is-active' : ''),
        onclick: function () { adminSys = i; buildEditor(); } }, [el('b', { text: s.title }), el('span', { text: s.subtitle || '' })]));
    });
    var sys = edit.systems[adminSys];
    var root = $('adminEditor'); root.innerHTML = '';

    var main = el('div', { class: 'card' });
    main.appendChild(el('div', { class: 'adm-block' }, [
      el('h3', { text: 'Название' }),
      el('div', { class: 'adm-grid adm-grid--2' }, [
        txt('Короткое', sys, 'title'), txt('Описание', sys, 'subtitle')
      ])
    ]));
    main.appendChild(el('div', { class: 'adm-block' }, [
      el('h3', { text: 'Толщина, мм' }), triple(sys.thickness, 'По умолчанию')
    ]));
    main.appendChild(el('div', { class: 'adm-block' }, [
      el('h3', { text: 'Площадь, м²' }), triple(sys.area, 'По умолчанию')
    ]));
    root.appendChild(main);

    sys.steps.forEach(function (step) {
      var card = el('div', { class: 'card' }, [el('h2', { class: 'card__title', text: step.op })]);
      if (step.note) card.appendChild(el('p', { class: 'muted small', text: step.note }));
      if (step.type === 'layer') {
        card.appendChild(el('div', { class: 'adm-grid adm-grid--2' }, [
          num('Макс. соотношение песок/пол', step, 'ratioMax', { min: 0 })
        ]));
      }
      step.materials.forEach(function (m) {
        var box = el('div', { class: 'adm-mat' }, [txt('Наименование материала', m, 'name')]);
        if (step.type === 'layer') {
          box.appendChild(el('div', { class: 'adm-label', text: 'Коэффициент (' + (m.kind === 'filler' ? 'песок' : 'пол') + ')' }));
          box.appendChild(triple(m.coef, 'По умолч.'));
          box.appendChild(el('div', { class: 'adm-label', text: 'Материал' }));
          box.appendChild(el('div', { class: 'adm-grid' }, [
            num('Плотность, кг/м³', m, 'density', { min: 1 }),
            num('Вес компл., кг', m, 'pack', { min: 0.001 }),
            num('Цена, ₽/кг', m, 'price', { min: 0 })
          ]));
        } else {
          box.appendChild(el('div', { class: 'adm-label', text: 'Материал' }));
          box.appendChild(el('div', { class: 'adm-grid' }, [
            num('Расход, кг/м²', m, 'consumption', { min: 0 }),
            num('Вес компл., кг', m, 'pack', { min: 0.001 }),
            num('Цена, ₽/кг', m, 'price', { min: 0 })
          ]));
        }
        card.appendChild(box);
      });
      root.appendChild(card);
    });
    validateEdit();
  }

  // value / min / max: значения по умолчанию и пределы для пользователя
  function triple(obj, valueLabel) {
    var g = el('div', { class: 'adm-grid' }, [
      num('Минимум', obj, 'min', {}), num(valueLabel, obj, 'value', {}), num('Максимум', obj, 'max', {})
    ]);
    g.setAttribute('data-triple', '1');
    g._obj = obj;
    return g;
  }
  function num(label, obj, key, rules) {
    var id = 'a' + Math.random().toString(36).slice(2, 8);
    var input = el('input', { id: id, type: 'text', inputmode: 'decimal', value: obj[key] == null ? '' : String(obj[key]).replace('.', ',') });
    input._rules = rules; input._obj = obj; input._key = key;
    input.addEventListener('input', function () {
      var v = parseNum(input.value);
      obj[key] = isFinite(v) ? v : NaN;
      validateEdit();
    });
    return el('div', { class: 'field' }, [el('label', { for: id, text: label }), input]);
  }
  function txt(label, obj, key) {
    var id = 'a' + Math.random().toString(36).slice(2, 8);
    var input = el('input', { id: id, type: 'text', value: obj[key] || '' });
    input.addEventListener('input', function () { obj[key] = input.value; });
    return el('div', { class: 'field' }, [el('label', { for: id, text: label }), input]);
  }

  function validateEdit() {
    var root = $('adminEditor');
    root.querySelectorAll('input').forEach(function (i) { i.classList.remove('is-invalid'); i.title = ''; });
    root.querySelectorAll('input').forEach(function (i) {
      if (!i._rules) return;
      var v = i._obj[i._key];
      var bad = typeof v !== 'number' || !isFinite(v) || (i._rules.min != null && v < i._rules.min);
      if (bad) { i.classList.add('is-invalid'); i.title = 'Некорректное значение'; }
    });
    root.querySelectorAll('[data-triple]').forEach(function (g) {
      var o = g._obj, inputs = g.querySelectorAll('input');
      if (!(o.min <= o.value && o.value <= o.max)) inputs.forEach(function (i) { i.classList.add('is-invalid'); i.title = 'Должно быть: минимум ≤ по умолчанию ≤ максимум'; });
      if (o.min < 0) inputs[0].classList.add('is-invalid');
    });
    return allErrors(edit);
  }
  function allErrors(s) {
    var errs = [];
    s.systems.forEach(function (sys) {
      function chk(o, what) {
        if (![o.min, o.value, o.max].every(isFinite) || !(o.min <= o.value && o.value <= o.max) || o.min < 0) errs.push(sys.title + ': ' + what);
      }
      chk(sys.thickness, 'толщина'); chk(sys.area, 'площадь');
      if (!(sys.thickness.max > 0) || !(sys.area.max > 0)) errs.push(sys.title + ': пределы должны быть больше нуля');
      sys.steps.forEach(function (step) {
        if (step.type === 'layer' && step.ratioMax != null && !(step.ratioMax >= 0)) errs.push(sys.title + ': ' + step.op + ' — соотношение');
        step.materials.forEach(function (m) {
          if (!(m.pack > 0) || !(m.price >= 0)) errs.push(sys.title + ': ' + m.name + ' — вес/цена');
          if (step.type === 'layer') { chk(m.coef, m.name + ' — коэффициент'); if (!(m.density > 0)) errs.push(sys.title + ': ' + m.name + ' — плотность'); }
          else if (!(m.consumption >= 0)) errs.push(sys.title + ': ' + m.name + ' — расход');
        });
      });
    });
    return errs;
  }
  function status(msg, kind) {
    var s = $('admStatus'); s.textContent = msg; s.className = 'status' + (kind ? ' is-' + kind : '');
  }
  function ensureValid() {
    var errs = allErrors(edit);
    if (errs.length) { status('Исправьте ошибки: ' + errs.slice(0, 3).join('; ') + (errs.length > 3 ? '…' : ''), 'error'); return false; }
    return true;
  }
  function applyLocal() {
    settings = clone(edit);
    saveJSON(localStorage, LS_DRAFT, settings);
    $('draftBanner').hidden = JSON.stringify(settings) === JSON.stringify(published);
    if ($('draftBanner').hidden) removeKey(localStorage, LS_DRAFT);
  }
  function settingsJSON(s) { return JSON.stringify(s, null, 2) + '\n'; }

  function publish() {
    if (!ensureValid()) return;
    var repo = $('ghRepo').value.trim(), branch = $('ghBranch').value.trim() || 'main', token = $('ghToken').value.trim();
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) { status('Укажите репозиторий в формате владелец/имя', 'error'); return; }
    if (!token) { status('Укажите токен GitHub', 'error'); return; }
    saveJSON(localStorage, LS_GH, { repo: repo, branch: branch });
    try { sessionStorage.setItem(SS_TOKEN, token); } catch (e) {}
    var url = 'https://api.github.com/repos/' + repo + '/contents/settings.json';
    var headers = { 'Authorization': 'Bearer ' + token, 'Accept': 'application/vnd.github+json' };
    status('Публикация…');
    fetch(url + '?ref=' + encodeURIComponent(branch), { headers: headers, cache: 'no-store' })
      .then(function (r) { if (r.status === 404) return {}; if (!r.ok) throw new Error('Чтение: ' + r.status); return r.json(); })
      .then(function (cur) {
        var body = { message: 'Обновление настроек калькулятора', branch: branch,
          content: btoa(unescape(encodeURIComponent(settingsJSON(edit)))) };
        if (cur.sha) body.sha = cur.sha;
        return fetch(url, { method: 'PUT', headers: headers, body: JSON.stringify(body) });
      })
      .then(function (r) {
        if (!r.ok) return r.json().catch(function () { return {}; }).then(function (j) { throw new Error(r.status + (j.message ? ' ' + j.message : '')); });
        published = clone(edit); settings = clone(edit);
        removeKey(localStorage, LS_DRAFT); $('draftBanner').hidden = true;
        status('Опубликовано. Пользователи увидят изменения в течение 1–2 минут.', 'ok');
      })
      .catch(function (e) {
        var m = String(e.message || e);
        if (/401|403/.test(m)) m += ' — проверьте токен и права на запись';
        status('Не удалось опубликовать: ' + m, 'error');
      });
  }

  // ---------- обработчики ----------
  function bindStatic() {
    document.querySelectorAll('.mode__btn').forEach(function (b) {
      b.addEventListener('click', function () { setMode(b.getAttribute('data-mode')); });
    });
    $('optSealer').addEventListener('change', function () { saveUser(); renderResults(); });
    $('coefReset').addEventListener('click', function () {
      var sys = currentSystem(); sysState(sys).coefs = {}; saveUser(); buildUser(); toast('Коэффициенты сброшены');
    });
    $('actPrint').addEventListener('click', function () { window.print(); });
    $('actShare').addEventListener('click', function () {
      var text = shareText();
      if (navigator.share) { navigator.share({ title: 'Расчёт INDASTRO', text: text }).catch(function () {}); return; }
      copy(text).then(function () { toast('Расчёт скопирован в буфер обмена'); }, function () { toast('Не удалось скопировать'); });
    });
    $('draftDiscard').addEventListener('click', function () {
      removeKey(localStorage, LS_DRAFT); settings = clone(published); $('draftBanner').hidden = true;
      if (!$('adminView').hidden && !$('adminPanel').hidden) openEditor(); else buildUser();
      toast('Возвращены опубликованные настройки');
    });

    $('loginForm').addEventListener('submit', function (e) {
      e.preventDefault();
      sha256($('adminPass').value).then(function (h) {
        if (h === settings.adminPasswordHash) {
          sessionStorage.setItem(SS_ADMIN, '1'); $('adminPass').value = ''; $('loginError').hidden = true;
          $('adminLogin').hidden = true; $('adminPanel').hidden = false; openEditor();
        } else { $('loginError').textContent = 'Неверный пароль'; $('loginError').hidden = false; }
      }, function () {
        $('loginError').textContent = 'Браузер не поддерживает проверку пароля — откройте страницу по https'; $('loginError').hidden = false;
      });
    });
    $('admLogout').addEventListener('click', function () { sessionStorage.removeItem(SS_ADMIN); setMode('user'); });
    $('admSave').addEventListener('click', function () {
      if (!ensureValid()) return;
      applyLocal();
      status($('draftBanner').hidden ? 'Совпадает с опубликованными настройками.' : 'Применено на этом устройстве. Чтобы изменения увидели все — опубликуйте.', 'ok');
    });
    $('admPublishOpen').addEventListener('click', function () {
      $('publishCard').open = true; $('publishCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    $('admPublish').addEventListener('click', publish);
    $('admExport').addEventListener('click', function () {
      if (!ensureValid()) return;
      var a = el('a', { href: URL.createObjectURL(new Blob([settingsJSON(edit)], { type: 'application/json' })), download: 'settings.json' });
      document.body.appendChild(a); a.click(); a.remove();
      status('Файл скачан. Загрузите его в репозиторий вместо settings.json — или нажмите «Опубликовать».', 'ok');
    });
    $('admImport').addEventListener('change', function (e) {
      var f = e.target.files[0]; if (!f) return;
      f.text().then(function (t) {
        var s = JSON.parse(t);
        if (!isValidShape(s)) throw new Error('shape');
        if (!s.adminPasswordHash) s.adminPasswordHash = edit.adminPasswordHash;
        edit = s; adminSys = 0; buildEditor(); status('Файл загружен. Проверьте значения и нажмите «Применить» или «Опубликовать».', 'ok');
      }).catch(function () { status('Не удалось прочитать файл настроек', 'error'); });
      e.target.value = '';
    });
    $('admReset').addEventListener('click', function () {
      if (!confirm('Вернуть все значения к исходным из Excel? Пароль останется прежним.')) return;
      var hash = edit.adminPasswordHash; edit = clone(window.CALC_DEFAULTS); edit.adminPasswordHash = hash;
      buildEditor(); status('Значения сброшены к Excel. Нажмите «Применить» или «Опубликовать».', 'ok');
    });
    $('admPass').addEventListener('click', function () {
      var a = $('newPass').value, b = $('newPass2').value;
      if (a.length < 4) { status('Пароль должен быть не короче 4 символов', 'error'); return; }
      if (a !== b) { status('Пароли не совпадают', 'error'); return; }
      sha256(a).then(function (h) {
        edit.adminPasswordHash = h; $('newPass').value = $('newPass2').value = '';
        status('Пароль изменён в настройках. Нажмите «Применить» и «Опубликовать».', 'ok');
      });
    });

    // плавающий итог внизу экрана, когда основной блок итогов прокручен
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (entries) {
        var hidden = !entries[0].isIntersecting && $('adminView').hidden;
        $('stickyTotal').classList.toggle('is-visible', hidden);
      }).observe($('totals'));
    }
  }
  function copy(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text);
    return new Promise(function (res, rej) {
      var ta = el('textarea'); ta.value = text; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy') ? res() : rej(); } catch (e) { rej(e); } ta.remove();
    });
  }

  init();
})();
