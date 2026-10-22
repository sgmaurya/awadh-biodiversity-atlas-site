/* search_core.js — the matching half of the site search, shared by the browser and by tests.
 *
 * Built into assets/atlas.js by build_site.js; also loadable in node (`require`) so that
 * scripts/test_search.js can check that "ritha", "bringraj" and "mendhak" find what they
 * should. No dependencies, ES5 only (it runs on old phones).
 *
 * The idea: every name is reduced to a spelling-insensitive key before comparing.
 *   - Roman: lower-case, no accents, aspirates dropped (bh->b, th->t), long vowels shortened
 *     (ee->i, oo->u, aa->a), w/v and ph/f and z/j merged, doubled letters collapsed.
 *   - Devanagari: nukta and chandrabindu normalised, long vowel signs shortened, and the
 *     word also transliterated to Roman with the same rules, so मेंढक and "mendhak" meet.
 * Then exact / prefix / substring hits rank first, and anything within a small edit
 * distance of a name token is offered as "did you mean".
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.AtlasSearch = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DEV_RE = /[ऀ-ॿ]/;

  function normRoman(s) {
    s = String(s || '').toLowerCase();
    if (s.normalize) s = s.normalize('NFD').replace(/[̀-ͯ]/g, '');
    s = s.replace(/[^a-z0-9\s]+/g, ' ');
    s = s.replace(/ph/g, 'f').replace(/w/g, 'v').replace(/z/g, 'j').replace(/q/g, 'k').replace(/x/g, 'ks');
    s = s.replace(/c(?=[^hk])/g, 'k').replace(/ck/g, 'k');          // "cobra" -> kobra; "ch" stays
    s = s.replace(/chh/g, 'c').replace(/ch/g, 'c');
    s = s.replace(/([bdgjkpt])h/g, '$1').replace(/sh/g, 's');         // aspirates
    s = s.replace(/aa/g, 'a').replace(/ee/g, 'i').replace(/ii/g, 'i').replace(/oo/g, 'u').replace(/uu/g, 'u');
    s = s.replace(/ai/g, 'e').replace(/au/g, 'o').replace(/ey/g, 'e').replace(/ou/g, 'u').replace(/ea/g, 'i');
    s = s.replace(/([a-z])\1+/g, '$1');                               // doubled letters
    s = s.replace(/y(?=[aeiou])/g, 'y');                              // keep y; placeholder for symmetry
    return s.replace(/\s+/g, ' ').trim();
  }

  // Devanagari -> rough Roman, then through normRoman so both sides share one key space.
  var CONS = {
    'क': 'k', 'ख': 'kh', 'ग': 'g', 'घ': 'gh', 'ङ': 'n', 'च': 'ch', 'छ': 'chh', 'ज': 'j', 'झ': 'jh', 'ञ': 'n',
    'ट': 't', 'ठ': 'th', 'ड': 'd', 'ढ': 'dh', 'ण': 'n', 'त': 't', 'थ': 'th', 'द': 'd', 'ध': 'dh', 'न': 'n',
    'प': 'p', 'फ': 'ph', 'ब': 'b', 'भ': 'bh', 'म': 'm', 'य': 'y', 'र': 'r', 'ल': 'l', 'व': 'v', 'श': 'sh',
    'ष': 'sh', 'स': 's', 'ह': 'h', 'ळ': 'l', 'क़': 'k', 'ख़': 'kh', 'ग़': 'g', 'ज़': 'j', 'ड़': 'r', 'ढ़': 'rh', 'फ़': 'f',
  };
  var VOW = { 'अ': 'a', 'आ': 'a', 'इ': 'i', 'ई': 'i', 'उ': 'u', 'ऊ': 'u', 'ए': 'e', 'ऐ': 'ai', 'ओ': 'o', 'औ': 'au', 'ऋ': 'ri', 'ऑ': 'o' };
  var MATRA = { 'ा': 'a', 'ि': 'i', 'ी': 'i', 'ु': 'u', 'ू': 'u', 'े': 'e', 'ै': 'ai', 'ो': 'o', 'ौ': 'au', 'ृ': 'ri', 'ॉ': 'o' };

  function translit(s) {
    s = String(s || '');
    if (s.normalize) s = s.normalize('NFC');
    var out = '', i, ch, next;
    for (i = 0; i < s.length; i++) {
      ch = s[i];
      // consonant with nukta as two code points
      if (s[i + 1] === '़' && CONS[ch + '़']) { ch = ch + '़'; i++; }
      if (CONS[ch]) {
        out += CONS[ch];
        next = s[i + 1];
        var isEnd = next === undefined || !/[ऀ-ॿ]/.test(next);
        if (next !== '्' && !MATRA[next] && !isEnd) out += 'a';   // inherent vowel, with schwa deletion at word end
      } else if (VOW[ch]) out += VOW[ch];
      else if (MATRA[ch]) out += MATRA[ch];
      else if (ch === '्') { /* virama: no vowel */ }
      else if (ch === 'ं' || ch === 'ँ') out += 'n';          // anusvara, chandrabindu
      else if (ch === 'ः') out += 'h';
      else if (ch === '़') { /* stray nukta */ }
      else out += ch;
    }
    return out;
  }

  function normDev(s) {
    s = String(s || '');
    if (s.normalize) s = s.normalize('NFD');
    s = s.replace(/़/g, '').replace(/ँ/g, 'ं');
    s = s.replace(/ी/g, 'ि').replace(/ू/g, 'ु').replace(/ई/g, 'इ').replace(/ऊ/g, 'उ');
    if (s.normalize) s = s.normalize('NFC');
    return s.replace(/[^ऀ-ॿ\s]+/g, ' ').replace(/\s+/g, ' ').trim();
  }

  // keys for one string: Roman key, and for Devanagari also the normalised Devanagari form
  function keysOf(s) {
    var out = [];
    String(s || '').split(/[\/,;|()]+/).forEach(function (part) {
      part = part.trim();
      if (!part) return;
      if (DEV_RE.test(part)) {
        var d = normDev(part); if (d) out.push(d);
        var r = normRoman(translit(part)); if (r) out.push(r);
      } else {
        var k = normRoman(part); if (k) out.push(k);
      }
    });
    return out;
  }

  // Damerau–Levenshtein (optimal string alignment), small strings only
  function dist(a, b) {
    var la = a.length, lb = b.length, i, j, d = [];
    if (!la) return lb; if (!lb) return la;
    for (i = 0; i <= la; i++) { d[i] = [i]; }
    for (j = 1; j <= lb; j++) d[0][j] = j;
    for (i = 1; i <= la; i++) {
      for (j = 1; j <= lb; j++) {
        var cost = a[i - 1] === b[j - 1] ? 0 : 1;
        d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
        if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
    return d[la][lb];
  }

  function allowed(len) { return len <= 3 ? 0 : len <= 5 ? 1 : len <= 8 ? 2 : 3; }

  // The primary names count a little more than alternates, and alternates more than group words,
  // so "mosquito" lists the mosquitoes before the "mosquito fern".
  var WEIGHT = { e: 1, h: 1, n: 1, l: 0.97, a: 0.97, f: 0.9, g: 0.85, k: 0.85 };

  /** Prepare an index entry: entry._keys = [{k, w}] full-name keys, entry._toks = [{t, w}] word tokens. */
  function prepare(entry) {
    var keys = [], toks = {};
    Object.keys(WEIGHT).forEach(function (f) {
      if (!entry[f]) return;
      keysOf(entry[f]).forEach(function (k) {
        keys.push({ k: k, w: WEIGHT[f] });
        k.split(' ').forEach(function (t) { if (t.length > 1 && !(toks[t] >= WEIGHT[f])) toks[t] = WEIGHT[f]; });
      });
    });
    entry._keys = keys;
    entry._toks = Object.keys(toks).map(function (t) { return { t: t, w: toks[t] }; });
    return entry;
  }

  /** Score one entry against the prepared query tokens. Returns 0 when a query word matches nothing. */
  function score(entry, qtoks) {
    var total = 0;
    for (var qi = 0; qi < qtoks.length; qi++) {
      var q = qtoks[qi], best = 0, i, k, t, w;
      for (i = 0; i < entry._keys.length && best < 100; i++) {
        k = entry._keys[i].k; w = entry._keys[i].w;
        if (k === q) best = Math.max(best, 100 * w);
        else if (k.indexOf(q) === 0) best = Math.max(best, 90 * w);
      }
      for (i = 0; i < entry._toks.length && best < 92; i++) {
        t = entry._toks[i].t; w = entry._toks[i].w;
        if (t === q) best = Math.max(best, 92 * w);
        else if (t.indexOf(q) === 0) best = Math.max(best, 80 * w);
        else if (q.length >= 3 && t.indexOf(q) !== -1) best = Math.max(best, 70 * w);
      }
      if (best < 70) {
        var lim = allowed(q.length);
        for (i = 0; i < entry._toks.length && best < 69; i++) {
          t = entry._toks[i].t; w = entry._toks[i].w;
          if (Math.abs(t.length - q.length) > lim + 1) continue;
          var dd = dist(q, t);
          if (dd <= lim) best = Math.max(best, (60 - dd * 10) * w);
          else if (q.length >= 4 && t.length > q.length) {             // typo while still typing: compare with the token's prefix
            dd = dist(q, t.slice(0, q.length));
            if (dd <= lim) best = Math.max(best, (50 - dd * 10) * w);
          }
        }
      }
      if (!best) return 0;
      total += best;
    }
    return total / qtoks.length;
  }

  /** Query -> { hits: [...], near: [...] } ; each item {entry, score}. */
  function search(data, query, limit) {
    limit = limit || 30;
    var qkeys = keysOf(query), qtoks = [];
    qkeys.forEach(function (k) { k.split(' ').forEach(function (t) { if (t && qtoks.indexOf(t) === -1) qtoks.push(t); }); });
    // a Devanagari query yields two keys (Devanagari and Roman) for the same word: keep the one that scores
    var devQuery = DEV_RE.test(query);
    var hits = [], near = [];
    for (var i = 0; i < data.length; i++) {
      var e = data[i];
      if (!e._keys) prepare(e);
      var s;
      if (devQuery) {
        // try each key form separately and take the better
        s = 0;
        for (var j = 0; j < qkeys.length; j++) s = Math.max(s, score(e, qkeys[j].split(' ')));
      } else s = score(e, qtoks);
      if (s >= 70) hits.push({ entry: e, score: s });
      else if (s > 0) near.push({ entry: e, score: s });
    }
    var byScore = function (a, b) { return b.score - a.score || (a.entry.e || '').localeCompare(b.entry.e || ''); };
    hits.sort(byScore); near.sort(byScore);
    return { hits: hits.slice(0, limit), near: near.slice(0, 6), tokens: qtoks };
  }

  return { search: search, prepare: prepare, normRoman: normRoman, normDev: normDev, translit: translit, dist: dist, keysOf: keysOf };
}));

/* Light by default; dark on request, remembered on this phone. */
(function () {
  var btn = document.getElementById('theme');
  if (!btn) return;
  btn.addEventListener('click', function () {
    var root = document.documentElement;
    var dark = root.getAttribute('data-theme') === 'dark';
    if (dark) root.removeAttribute('data-theme'); else root.setAttribute('data-theme', 'dark');
    try { localStorage.setItem('theme', dark ? 'light' : 'dark'); } catch (e) {}
  });
})();

/* The home page follows the calendar by itself.
   Every seasonal species is already in the HTML with the months it belongs to, so the page
   never needs rebuilding to stay right. The build month is shown if scripting is off. */
(function () {
  var sec = document.getElementById('thismonth');
  if (!sec) return;
  var months, allYear, perMonth, max;
  try {
    months = JSON.parse(sec.getAttribute('data-months'));
    allYear = JSON.parse(sec.getAttribute('data-allyear'));
    perMonth = JSON.parse(sec.getAttribute('data-permonth'));
    max = parseInt(sec.getAttribute('data-max'), 10) || 12;
  } catch (e) { return; }

  var m = new Date().getMonth() + 1;
  var nameEn = document.getElementById('mname');
  var nameHi = document.getElementById('mname-hi');
  if (nameEn) nameEn.textContent = months[m - 1][0];
  if (nameHi) nameHi.textContent = months[m - 1][1];
  var ay = document.getElementById('allyear');
  if (ay && allYear[m - 1] != null) ay.textContent = allYear[m - 1];

  var shown = 0;
  var cards = sec.querySelectorAll('#seasonal .card');
  for (var i = 0; i < cards.length; i++) {
    var list = (cards[i].getAttribute('data-m') || '').split(',');
    var on = list.indexOf(String(m)) !== -1 && shown < max;
    cards[i].hidden = !on;
    if (on) shown++;
  }
  var empty = document.getElementById('noseason');
  var grid = document.getElementById('seasonal');
  if (empty) empty.hidden = shown > 0;
  if (grid) grid.hidden = shown === 0;
  var see = document.getElementById('seemonth');
  if (see) {
    var total = perMonth[m - 1] || 0;
    see.hidden = total <= shown;
    var a = see.querySelector('a');
    if (a) {
      a.setAttribute('href', 'month/' + m + '/');
      a.textContent = 'See all ' + total + ' for ' + months[m - 1][0] + ' \u2192';
    }
  }
})();

/* Species of the day: the date picks one, in the same way the build did, so the page
   changes every day without a rebuild. Uses the search index, which has every name. */
(function () {
  var card = document.getElementById('daycard');
  if (!card) return;
  fetch('assets/search.json').then(function (r) { return r.json(); }).then(function (all) {
    var pics = all.filter(function (d) { return d.t; }).sort(function (a, b) { return a.e.localeCompare(b.e); });
    if (!pics.length) return;
    var now = new Date();
    var day = Math.floor((Date.now() - Date.UTC(now.getUTCFullYear(), 0, 0)) / 86400000);
    var d = pics[day % pics.length];
    card.setAttribute('href', 'species/' + d.s + '/');
    card.querySelector('img').src = d.t.replace('_t.', '.');
    card.querySelector('img').alt = d.e;
    card.querySelector('.n-hi').textContent = (d.h || '').split('/')[0].trim();
    card.querySelector('.n-en').textContent = d.e;
    card.querySelector('.n-sci').textContent = d.n;
  }).catch(function () {});
})();

/* Search across Hindi, English, Roman-Hindi, scientific and family names, and the Make & use
   and guide pages. Spelling- and transliteration-tolerant (scripts/search_core.js): "ritha",
   "bringraj" and "mendhak" all find their species. Loads a ~70 KB index on first use. */
(function () {
  var input = document.getElementById('q');
  var box = document.getElementById('results');
  if (!input || !box || typeof AtlasSearch === 'undefined') return;
  var root = input.getAttribute('data-root') || '';
  var data = null, loading = false, sel = -1;

  function load() {
    if (data || loading) return;
    loading = true;
    fetch(root + 'assets/search.json')
      .then(function (r) { return r.json(); })
      .then(function (j) { data = j.map(AtlasSearch.prepare); loading = false; if (input.value) run(); })
      .catch(function () { loading = false; });
  }

  function esc(s) { return String(s || '').replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  function row(d) {
    if (d.k) {
      return '<a href="' + root + d.u + '"><span class="r-hi">' + esc(d.h || d.e) + '</span> ' +
             '<span class="r-en">' + esc(d.e) + '</span><br><span class="r-sci">' + esc(d.g) + '</span></a>';
    }
    return '<a href="' + root + 'species/' + d.s + '/">' +
           '<span class="r-hi">' + esc((d.h || d.e).split('/')[0]) + '</span> ' +
           '<span class="r-en">' + esc(d.e) + '</span><br>' +
           '<span class="r-sci">' + esc(d.n) + (d.l ? ' · ' + esc(d.l.split(',').slice(0, 3).join(',')) : '') + '</span></a>';
  }

  function run() {
    var q = input.value.trim();
    if (!q) { box.hidden = true; box.innerHTML = ''; return; }
    if (!data) { load(); box.innerHTML = '<p class="none">Loading names…</p>'; box.hidden = false; return; }
    var r = AtlasSearch.search(data, q, 30);
    var html = '';
    if (r.hits.length) html += r.hits.map(function (x) { return row(x.entry); }).join('');
    if (r.near.length) {
      html += '<p class="dym">' + (r.hits.length ? 'Also close' : 'Did you mean') + ' <span class="hi">शायद आप यह ढूँढ रहे हैं</span></p>' +
              r.near.map(function (x) { return row(x.entry); }).join('');
    }
    if (!r.hits.length && !r.near.length) {
      html = '<p class="none">Nothing matched “' + esc(q) + '”. Try the Hindi name, a local name, or ' +
             '<a href="' + root + 'all/">browse by group</a>.</p>';
    }
    box.innerHTML = html;
    box.hidden = false;
    sel = -1;
  }

  input.addEventListener('focus', load);
  input.addEventListener('input', run);
  input.addEventListener('keydown', function (e) {
    var items = box.querySelectorAll('a');
    if (!items.length) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (sel >= 0) items[sel].classList.remove('sel');
      sel = e.key === 'ArrowDown' ? (sel + 1) % items.length : (sel <= 0 ? items.length - 1 : sel - 1);
      items[sel].classList.add('sel');
      items[sel].scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') {
      if (sel < 0 && items.length) sel = 0;            // Enter with nothing chosen opens the best match
      window.location.href = items[sel].getAttribute('href');
    } else if (e.key === 'Escape') {
      box.hidden = true; input.blur();
    }
  });
  document.addEventListener('click', function (e) {
    if (!box.contains(e.target) && e.target !== input) box.hidden = true;
  });
})();
