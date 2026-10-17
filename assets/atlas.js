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

/* Search across Hindi, English and scientific names. Loads a ~40 KB index on first use. */
(function () {
  var input = document.getElementById('q');
  var box = document.getElementById('results');
  if (!input || !box) return;
  var root = input.getAttribute('data-root') || '';
  var data = null, loading = false, sel = -1;

  function load() {
    if (data || loading) return;
    loading = true;
    fetch(root + 'assets/search.json')
      .then(function (r) { return r.json(); })
      .then(function (j) { data = j; loading = false; if (input.value) run(); })
      .catch(function () { loading = false; });
  }

  function norm(s) { return (s || '').toLowerCase(); }

  function run() {
    var q = norm(input.value.trim());
    if (!q) { box.hidden = true; box.innerHTML = ''; return; }
    if (!data) { load(); return; }
    var hits = [];
    for (var i = 0; i < data.length && hits.length < 40; i++) {
      var d = data[i];
      var hay = norm(d.e) + ' ' + (d.h || '') + ' ' + norm(d.n) + ' ' + norm(d.g);
      if (hay.indexOf(q) !== -1) hits.push(d);
    }
    if (!hits.length) { box.innerHTML = '<p class="none">Nothing found.</p>'; box.hidden = false; return; }
    box.innerHTML = hits.map(function (d) {
      return '<a href="' + root + 'species/' + d.s + '/">' +
             '<span class="r-hi">' + (d.h || d.e) + '</span> ' +
             '<span class="r-en">' + d.e + '</span><br>' +
             '<span class="r-sci">' + d.n + '</span></a>';
    }).join('');
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
    } else if (e.key === 'Enter' && sel >= 0) {
      window.location.href = items[sel].getAttribute('href');
    } else if (e.key === 'Escape') {
      box.hidden = true; input.blur();
    }
  });
  document.addEventListener('click', function (e) {
    if (!box.contains(e.target) && e.target !== input) box.hidden = true;
  });
})();
