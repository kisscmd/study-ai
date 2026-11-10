(function () {
  'use strict';

  var SCREENS = {
    'home': 'screen-home',
    'ocr-review': 'screen-ocr-review',
    'solution': 'screen-solution'
  };
  var current = 'home';
  var toastTimer = null;

  function showScreen(name) {
    if (!SCREENS[name]) return;
    current = name;
    Object.keys(SCREENS).forEach(function (key) {
      document.getElementById(SCREENS[key]).classList.toggle('active', key === name);
    });
    document.querySelectorAll('.nav-btn[data-nav]').forEach(function (btn) {
      if (btn.getAttribute('data-nav') === name) {
        btn.setAttribute('aria-current', 'page');
      } else {
        btn.removeAttribute('aria-current');
      }
    });
    document.getElementById('content').scrollTop = 0;
    try {
      if (location.hash !== '#' + name) history.replaceState(null, '', '#' + name);
    } catch (e) { /* песочница (about:srcdoc) запрещает replaceState — хеш не обязателен */ }
  }

  function toast(message, ms) {
    var el = document.getElementById('toast');
    el.textContent = message;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('show'); }, ms || 3000);
  }

  document.querySelectorAll('[data-nav]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var target = btn.getAttribute('data-nav');
      if (SCREENS[target]) showScreen(target);
      else toast('Раздел появится на этапе E6');
    });
  });

  document.getElementById('btn-new-task').addEventListener('click', function () { if (window.studyAI) window.studyAI.reset(); else showScreen('home'); });

  window.addEventListener('hashchange', function () {
    var name = location.hash.slice(1);
    if (SCREENS[name] && name !== current) showScreen(name);
  });

  /* ================= E2: Input Layer ================= */
  var MAX_PHOTOS = 20, MAX_SIDE = 1600, QUALITY = 0.85, HOLD_MS = 250;
  var photos = [];          // [{id, blob, url}] — Blob в памяти, не base64
  var nextId = 1, busy = false;

  var $ = function (id) { return document.getElementById(id); };
  var grid = $('home-previews'), zone = $('home-dropzone');
  var btnCamera = $('btn-camera'), btnUpload = $('btn-upload');
  var inCamera = $('input-camera'), inUpload = $('input-upload');

  function isImage(file) {
    return /^image\//.test(file.type) || /\.(heic|heif|jpe?g|png|webp)$/i.test(file.name || '');
  }

  function loadImage(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file), img = new Image();
      img.onload = function () { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('decode')); };
      img.src = url;
    });
  }

  async function compress(file) {
    var src;
    try { src = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
    catch (e) { src = await loadImage(file); }
    var w = src.width || src.naturalWidth, h = src.height || src.naturalHeight;
    var k = Math.min(1, MAX_SIDE / Math.max(w, h));
    var canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(w * k));
    canvas.height = Math.max(1, Math.round(h * k));
    var ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(src, 0, 0, canvas.width, canvas.height);
    if (src.close) src.close();
    var blob = await new Promise(function (res) { canvas.toBlob(res, 'image/jpeg', QUALITY); });
    canvas.width = canvas.height = 0;   // освободить память на iOS
    if (!blob) throw new Error('encode');
    return blob;
  }

  function formatMB(bytes) {
    var mb = bytes / 1048576;
    return mb < 0.1 ? '<0,1' : mb.toFixed(1).replace('.', ',');
  }

  function render() {
    grid.textContent = '';
    photos.forEach(function (p, i) {
      var li = document.createElement('li');
      li.className = 'tile';
      li.dataset.id = p.id;
      var img = document.createElement('img');
      img.src = p.url; img.alt = 'Фото ' + (i + 1); img.draggable = false;
      var num = document.createElement('span');
      num.className = 'tile-num'; num.textContent = i + 1;
      var del = document.createElement('button');
      del.type = 'button'; del.className = 'tile-del';
      del.setAttribute('aria-label', 'Удалить фото ' + (i + 1));
      del.innerHTML = '<span><svg class="icon" aria-hidden="true" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></span>';
      li.append(img, num, del);
      grid.appendChild(li);
    });
    var total = photos.reduce(function (s, p) { return s + p.blob.size; }, 0);
    var has = photos.length > 0;
    $('home-meta').hidden = !has;
    $('btn-recognize').hidden = !has;
    $('photo-summary').textContent = photos.length + ' фото, ~' + formatMB(total) + ' МБ';
    var full = photos.length >= MAX_PHOTOS;
    btnCamera.disabled = btnUpload.disabled = full || busy;
    $('btn-clear').disabled = busy;
    var rb = $('btn-recognize');
    rb.disabled = busy;
    var pending = photos.some(function (p) { return !p.ocr; });
    rb.textContent = ocrFailed ? 'Повторить распознавание' : (pending ? 'Распознать текст' : 'К проверке текста');
    renderReview();
  }

  function setProgress(done, total) {
    var on = total > 0;
    $('home-progress').hidden = !on;
    $('home-status').hidden = !on;
    if (on) {
      $('progress-bar').style.width = Math.round(done / total * 100) + '%';
      $('home-status').textContent = 'Обработка фото ' + Math.min(done + 1, total) + '/' + total;
    }
  }

  async function addFiles(fileList) {
    if (busy) return;
    var files = Array.prototype.filter.call(fileList || [], isImage);
    if (!files.length) { if (fileList && fileList.length) toast('Выберите изображения'); return; }
    var slots = MAX_PHOTOS - photos.length;
    if (slots <= 0) { toast('Максимум ' + MAX_PHOTOS + ' фото'); return; }
    if (files.length > slots) {
      toast('Добавлено ' + slots + ' из ' + files.length + ': максимум ' + MAX_PHOTOS + ' фото');
      files = files.slice(0, slots);
    }
    busy = true; render();
    var failed = 0;
    for (var i = 0; i < files.length; i++) {      // по очереди: на iPhone мало памяти
      setProgress(i, files.length);
      try {
        var blob = await compress(files[i]);
        photos.push({ id: String(nextId++), blob: blob, url: URL.createObjectURL(blob) });
        render();
      } catch (e) { failed++; }
    }
    busy = false;
    setProgress(0, 0);
    if (photos.length) setState('PHOTOS_ADDED');
    render();
    if (failed) toast('Не удалось обработать фото: ' + failed);
  }

  function removePhoto(id) {
    if (busy) return;
    var i = photos.findIndex(function (p) { return p.id === id; });
    if (i < 0) return;
    URL.revokeObjectURL(photos[i].url);
    photos.splice(i, 1);
    render();
  }

  function clearPhotos() {
    if (busy) return;
    ocrFailed = false;
    photos.forEach(function (p) { URL.revokeObjectURL(p.url); });
    photos = [];
    render();
    solutions = [];
    if ($('solution-steps')) $('solution-steps').textContent = '';
  }

  btnCamera.addEventListener('click', function () { inCamera.click(); });
  btnUpload.addEventListener('click', function () { inUpload.click(); });
  [inCamera, inUpload].forEach(function (inp) {
    inp.addEventListener('change', function () {
      var files = Array.prototype.slice.call(inp.files);
      inp.value = '';
      addFiles(files);
    });
  });
  $('btn-clear').addEventListener('click', clearPhotos);

  // Drag & drop файлов — только десктоп
  ['dragover', 'drop'].forEach(function (t) {
    window.addEventListener(t, function (e) { e.preventDefault(); });
  });
  zone.addEventListener('dragover', function () { zone.classList.add('dragover'); });
  zone.addEventListener('dragleave', function () { zone.classList.remove('dragover'); });
  zone.addEventListener('drop', function (e) {
    zone.classList.remove('dragover');
    if (e.dataTransfer && e.dataTransfer.files) addFiles(Array.prototype.slice.call(e.dataTransfer.files));
  });

  // Удаление (делегирование)
  grid.addEventListener('click', function (e) {
    var del = e.target.closest('.tile-del');
    if (del) removePhoto(del.closest('.tile').dataset.id);
  });

  // Порядок: долгое нажатие (250мс) на плитке, затем перетаскивание пальцем
  var drag = null, holdTimer = null;

  function tileAt(x, y, except) {
    var tiles = grid.querySelectorAll('.tile');
    for (var i = 0; i < tiles.length; i++) {
      if (tiles[i] === except) continue;
      var r = tiles[i].getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return tiles[i];
    }
    return null;
  }

  function clearMarks() {
    grid.querySelectorAll('.drop-target').forEach(function (t) { t.classList.remove('drop-target'); });
  }

  function endDrag(commit, x, y) {
    clearTimeout(holdTimer);
    if (!drag) return;
    var d = drag; drag = null;
    clearMarks();
    d.tile.classList.remove('dragging');
    d.tile.style.transform = '';
    if (commit && d.active) {
      var target = tileAt(x, y, d.tile);
      if (target) {
        var from = photos.findIndex(function (p) { return p.id === d.tile.dataset.id; });
        var to = photos.findIndex(function (p) { return p.id === target.dataset.id; });
        if (from > -1 && to > -1 && from !== to) photos.splice(to, 0, photos.splice(from, 1)[0]);
      }
      render();
    }
  }

  grid.addEventListener('pointerdown', function (e) {
    var tile = e.target.closest('.tile');
    if (!tile || e.target.closest('.tile-del') || drag || busy) return;
    drag = { tile: tile, sx: e.clientX, sy: e.clientY, pid: e.pointerId, active: false };
    holdTimer = setTimeout(function () {
      if (!drag) return;
      drag.active = true;
      tile.classList.add('dragging');
      try { tile.setPointerCapture(drag.pid); } catch (err) { /* ignore */ }
      if (navigator.vibrate) navigator.vibrate(10);
    }, HOLD_MS);
  });
  grid.addEventListener('pointermove', function (e) {
    if (!drag) return;
    var dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
    if (!drag.active) {
      if (Math.abs(dx) > 8 || Math.abs(dy) > 8) endDrag(false);   // это скролл
      return;
    }
    drag.tile.style.transform = 'translate(' + dx + 'px,' + dy + 'px) scale(1.04)';
    clearMarks();
    var t = tileAt(e.clientX, e.clientY, drag.tile);
    if (t) t.classList.add('drop-target');
  });
  grid.addEventListener('pointerup', function (e) { endDrag(true, e.clientX, e.clientY); });
  grid.addEventListener('pointercancel', function () { endDrag(false); });
  document.addEventListener('touchmove', function (e) {
    if (drag && drag.active && e.cancelable) e.preventDefault();   // не скроллить при перетаскивании
  }, { passive: false });
  grid.addEventListener('contextmenu', function (e) { e.preventDefault(); });

  /* ================= E3: OCR Layer + экран проверки ================= */
  var TESS_URL = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
  var OCR_LANG = 'rus+eng';       // в E6 — из настроек
  var LOW_CONF = 0.7;
  var state = 'IDLE';             // IDLE → PHOTOS_ADDED → OCR_PROCESSING → OCR_REVIEW → SOLVING → SOLUTION_SHOWN
  var worker = null, ocrLogger = null, reviewIdx = 0, ocrFailed = false;

  /*E3-PURE-START*/
  function binarize(gray, w, h) {   // Otsu binarization, +5-15% точности OCR; затем медианный фильтр 3×3
    var hist = new Uint32Array(256), n = w * h, i, t, x, y;
    for (i = 0; i < n; i++) hist[gray[i] | 0]++;
    var sumAll = 0;
    for (t = 0; t < 256; t++) sumAll += t * hist[t];
    var wB = 0, sumB = 0, best = -1, thr = 127;
    for (t = 0; t < 256; t++) {
      wB += hist[t];
      if (!wB) continue;
      var wF = n - wB;
      if (!wF) break;
      sumB += t * hist[t];
      var mB = sumB / wB, mF = (sumAll - sumB) / wF, between = wB * wF * (mB - mF) * (mB - mF);
      if (between > best) { best = between; thr = t; }
    }
    var bin = new Uint8Array(n);
    for (i = 0; i < n; i++) bin[i] = gray[i] > thr ? 0 : 1;   // gray > порог → белый, иначе тёмный (1)
    var med = new Uint8Array(n);                                // медиана 3×3 по бинарной карте
    for (y = 0; y < h; y++) {
      var ya = Math.max(0, y - 1), yb = Math.min(h - 1, y + 1);
      for (x = 0; x < w; x++) {
        var xa = Math.max(0, x - 1), xb = Math.min(w - 1, x + 1), c = 0, tot = 0;
        for (var yy = ya; yy <= yb; yy++) for (var xx = xa; xx <= xb; xx++) { c += bin[yy * w + xx]; tot++; }
        med[y * w + x] = c * 2 > tot ? 1 : 0;
      }
    }
    return { bin: bin, med: med };   // bin — для поиска тонких черт дробей, med — для картинки Tesseract
  }

  function findBars(dark, w, h) {   // горизонтальные тонкие чёрточки = кандидаты в черты дробей
    var minLen = Math.max(24, Math.round(w * 0.02)), maxThick = Math.max(4, Math.round(h * 0.01));
    var open = [], done = [], y, x;
    for (y = 0; y < h; y++) {
      var runs = [];
      x = 0;
      while (x < w) {
        if (dark[y * w + x]) {
          var st = x;
          while (x < w && dark[y * w + x]) x++;
          if (x - st >= minLen) runs.push([st, x - 1]);
        } else x++;
      }
      var next = [];
      runs.forEach(function (r) {
        var m = null;
        for (var i = 0; i < open.length; i++) {
          var b = open[i];
          if (b.y1 === y - 1 && Math.min(b.x1, r[1]) - Math.max(b.x0, r[0]) > 0.7 * Math.min(b.x1 - b.x0, r[1] - r[0])) { m = b; open.splice(i, 1); break; }
        }
        if (m) { m.y1 = y; m.x0 = Math.min(m.x0, r[0]); m.x1 = Math.max(m.x1, r[1]); next.push(m); }
        else next.push({ x0: r[0], x1: r[1], y0: y, y1: y });
      });
      open.forEach(function (b) { done.push(b); });
      open = next;
    }
    open.forEach(function (b) { done.push(b); });
    return done.filter(function (b) { return b.y1 - b.y0 + 1 <= maxThick; });
  }

  function getWords(data) {
    if (data.words && data.words.length) return data.words;
    var out = [];
    (data.blocks || []).forEach(function (b) { (b.paragraphs || []).forEach(function (p) { (p.lines || []).forEach(function (l) { (l.words || []).forEach(function (w) { out.push(w); }); }); }); });
    return out;
  }

  // Пересборка текста по координатам слов: стопки «числитель / черта / знаменатель» → (числитель)/(знаменатель)
  function buildText(rawWords, bars) {
    var ws = rawWords.filter(function (w) { return w && w.bbox && String(w.text || '').trim(); }).map(function (w) {
      return { t: String(w.text).trim(), x0: w.bbox.x0, y0: w.bbox.y0, x1: w.bbox.x1, y1: w.bbox.y1, used: false };
    });
    if (!ws.length) return { text: '', fracs: 0 };
    ws.forEach(function (w) { w.cx = (w.x0 + w.x1) / 2; w.cy = (w.y0 + w.y1) / 2; w.h = w.y1 - w.y0; });
    var hs = ws.map(function (w) { return w.h; }).sort(function (a, b) { return a - b; });
    var medH = hs[Math.floor(hs.length / 2)] || 10;
    var byX = function (a, b) { return a.x0 - b.x0; };
    var fracs = [];
    bars.forEach(function (bar) {
      var up = [], dn = [], bc = (bar.y0 + bar.y1) / 2;
      ws.forEach(function (w) {
        if (w.used || w.cx < bar.x0 - 4 || w.cx > bar.x1 + 4) return;
        var gu = bar.y0 - w.y1, gd = w.y0 - bar.y1;
        if (gu >= -w.h * 0.25 && gu <= medH * 1.2) up.push(w);
        else if (gd >= -w.h * 0.25 && gd <= medH * 1.2) dn.push(w);
      });
      if (!up.length || !dn.length) return;
      var all = up.concat(dn);
      var mx0 = Math.min.apply(null, all.map(function (w) { return w.x0; }));
      var mx1 = Math.max.apply(null, all.map(function (w) { return w.x1; }));
      var tw = mx1 - mx0, bw = bar.x1 - bar.x0;
      if (bw > tw * 1.35 + 20 || bw < tw * 0.55) return;   // не дробь (линейка, рамка, минус)
      up.sort(byX); dn.sort(byX);
      all.forEach(function (w) { w.used = true; });
      ws.forEach(function (w) {   // чёрту Tesseract мог прочитать как «—», «_»
        if (!w.used && /^[-—–_=~.|]+$/.test(w.t) && Math.abs(w.cy - bc) <= medH * 0.6 && w.cx >= bar.x0 - 4 && w.cx <= bar.x1 + 4) w.used = true;
      });
      fracs.push({
        t: '(' + up.map(function (w) { return w.t; }).join(' ') + ')/(' + dn.map(function (w) { return w.t; }).join(' ') + ')',
        x0: bar.x0, x1: bar.x1, cx: (bar.x0 + bar.x1) / 2, cy: bc, h: medH
      });
    });
    var items = ws.filter(function (w) { return !w.used; }).concat(fracs).sort(function (a, b) { return a.cy - b.cy; });
    var lines = [];
    items.forEach(function (it) {
      var L = lines[lines.length - 1];
      if (L && Math.abs(it.cy - L.cy) <= medH * 0.7) { L.items.push(it); L.cy = (L.cy * (L.items.length - 1) + it.cy) / L.items.length; }
      else lines.push({ cy: it.cy, items: [it] });
    });
    var text = '';
    lines.forEach(function (L, i) {
      if (i) text += (L.cy - lines[i - 1].cy > medH * 5 ? '\n\n' : '\n');
      text += L.items.sort(byX).map(function (w) { return w.t; }).join(' ');
    });
    return { text: text, fracs: fracs.length };
  }
  /*E3-PURE-END*/

  async function preprocess(blob) {   // увеличение мелких снимков + адаптивная бинаризация
    var bmp = await createImageBitmap(blob);
    var k = Math.min(3, Math.max(1, 1800 / Math.max(bmp.width, bmp.height)));
    var w = Math.round(bmp.width * k), h = Math.round(bmp.height * k);
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    var ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
    ctx.drawImage(bmp, 0, 0, w, h);
    if (bmp.close) bmp.close();
    var img = ctx.getImageData(0, 0, w, h), d = img.data, n = w * h, gray = new Uint8ClampedArray(n), sum = 0, i;
    for (i = 0; i < n; i++) { var g = (d[4 * i] * 299 + d[4 * i + 1] * 587 + d[4 * i + 2] * 114) / 1000; gray[i] = g; sum += g; }
    if (sum / n < 110) for (i = 0; i < n; i++) gray[i] = 255 - gray[i];   // тёмная тема: светлый текст на тёмном
    var bz = binarize(gray, w, h), dark = bz.bin;
    for (i = 0; i < n; i++) { var v = bz.med[i] ? 0 : 255; d[4 * i] = d[4 * i + 1] = d[4 * i + 2] = v; d[4 * i + 3] = 255; }
    ctx.putImageData(img, 0, 0);
    var out = await new Promise(function (res) { c.toBlob(res, 'image/png', 1.0); });
    c.width = c.height = 0;
    if (!out) throw new Error('png');
    return { blob: out, dark: dark, w: w, h: h };
  }

  function setState(s) { state = s; document.body.dataset.state = s; }

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      if (window.Tesseract) return resolve();
      var s = document.createElement('script');
      s.src = src; s.onload = resolve;
      s.onerror = function () { reject(new Error('script')); };
      document.head.appendChild(s);
    });
  }

  async function killWorker() {
    if (!worker) return;
    try { await worker.terminate(); } catch (e) { /* ignore */ }
    worker = null;                // освобождаем память iPhone до следующих этапов
  }

  function ocrProgress(frac, text, loading) {
    $('home-progress').hidden = false;
    $('home-progress').classList.toggle('loading', !!loading);
    $('progress-bar').style.width = Math.round(frac * 100) + '%';
    $('home-status').hidden = false;
    $('home-status').textContent = text;
  }

  async function runOcr() {
    if (busy || !photos.length) return;
    var todo = photos.filter(function (p) { return !p.ocr; });
    if (!todo.length) { goReview(); return; }
    busy = true; ocrFailed = false; setState('OCR_PROCESSING'); render();
    ocrProgress(0, 'Загрузка модели распознавания…', true);

    try {
      await loadScript(TESS_URL);
      ocrLogger = function (m) {
        if (m.status && m.status.indexOf('loading') === 0) {
          ocrProgress(0, 'Загрузка языка ' + Math.round((m.progress || 0) * 100) + '%', true);
        }
      };
      
      // ИСПРАВЛЕНО: Жестко прописаны пути для Tesseract, чтобы не было AbortError
      worker = await Tesseract.createWorker(OCR_LANG, 1, {
        workerPath: 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/worker.min.js',
        corePath: 'https://cdn.jsdelivr.net/npm/tesseract.js-core@5.1.1',
        langPath: 'https://tessdata.projectnaptha.com/4.0.0',
        logger: function (m) { if (ocrLogger) ocrLogger(m); }
      });
      
      try {
        await worker.setParameters({ tessedit_pageseg_mode: '6', preserve_interword_spaces: '1', user_defined_dpi: '300' });
      } catch (e3) { /* параметры не критичны */ }
    } catch (e) {
      await killWorker();
      busy = false; ocrFailed = true; setState('PHOTOS_ADDED');
      $('home-progress').hidden = true; $('home-status').hidden = true;
      render();
      toast('Нет интернета. Подключитесь один раз для загрузки');
      return;
    }

    var failed = 0, done = 0;
    for (var k = 0; k < todo.length; k++) {      // строго по очереди
      var p = todo[k], idx = photos.indexOf(p) + 1;
      ocrLogger = (function (doneNow, idxNow) {
        return function (m) {
          if (m.status === 'recognizing text') {
            var pr = m.progress || 0;
            ocrProgress((doneNow + pr) / todo.length, 'Фото ' + idxNow + '/' + photos.length + ' — распознавание ' + Math.round(pr * 100) + '%', false);
          }
        };
      })(done, idx);
      ocrProgress(done / todo.length, 'Фото ' + idx + '/' + photos.length + ' — распознавание 0%', false);
      try {
        var pre = null;
        try { pre = await preprocess(p.blob); } catch (e4) { pre = null; }
        var res = await worker.recognize(pre ? pre.blob : p.blob, {}, { text: true, blocks: true });
        var txt = (res.data.text || '').trim();
        if (pre) {
          try {   // дроби: собрать по координатам; если дробей нет — оставляем текст Tesseract как есть
            var rb = buildText(getWords(res.data), findBars(pre.dark, pre.w, pre.h));
            if (rb.fracs > 0 && rb.text) txt = rb.text;
          } catch (e5) { /* оставляем res.data.text */ }
          pre = null;
        }
        p.ocr = { text: txt, confidence: (res.data.confidence || 0) / 100 };
      } catch (e) { failed++; }
      done++;
    }
    ocrLogger = null;
    await killWorker();
    busy = false;
    $('home-progress').hidden = true; $('home-progress').classList.remove('loading'); $('home-status').hidden = true;

    if (failed) {
      ocrFailed = true; setState('PHOTOS_ADDED'); render();
      toast('Не удалось распознать фото: ' + failed);
      return;
    }
    goReview();
  }

  function goReview() {
    setState('OCR_REVIEW');
    reviewIdx = 0;
    render();
    showScreen('ocr-review');
  }

  function renderReview() {
    var n = photos.length;
    if (reviewIdx >= n) reviewIdx = Math.max(0, n - 1);
    var p = photos[reviewIdx];
    var ta = $('ocr-text'), frame = $('ocr-photo');
    $('ocr-pager').hidden = n < 2;
    $('ocr-page-label').textContent = 'Фото ' + (reviewIdx + 1) + ' из ' + n;
    $('ocr-prev').disabled = reviewIdx <= 0;
    $('ocr-next').disabled = reviewIdx >= n - 1;
    frame.textContent = '';

    var low = [];
    photos.forEach(function (ph, i) { if (ph.ocr && ph.ocr.confidence < LOW_CONF) low.push(i + 1); });
    var warn = $('ocr-warning');
    warn.hidden = !low.length;
    if (low.length) warn.textContent = 'Низкая уверенность распознавания: фото ' + low.join(', ') + '. Проверьте и поправьте текст перед решением. Возможно, OCR ошибся. Частые путаницы: 0↔O, 1↔l, x↔×, 5↔S, 2↔Z.';

    var conf = $('ocr-conf');
    if (!p) {
      ta.value = ''; ta.disabled = true; ta.classList.remove('low'); conf.textContent = ''; conf.className = 'status';
    } else {
      var img = document.createElement('img');
      img.src = p.url; img.alt = 'Фото ' + (reviewIdx + 1);
      frame.appendChild(img);
      ta.disabled = !p.ocr;
      if (document.activeElement !== ta) ta.value = p.ocr ? p.ocr.text : '';
      var isLow = !!(p.ocr && p.ocr.confidence < LOW_CONF);
      ta.classList.toggle('low', isLow);
      conf.className = 'status' + (isLow ? ' low' : '');
      conf.textContent = p.ocr ? 'Уверенность распознавания: ' + Math.round(p.ocr.confidence * 100) + '%' : '';
    }
    var any = photos.some(function (ph) { return ph.ocr && ph.ocr.text.trim(); });
    $('btn-solve').disabled = !any;
  }

  function getOcrResults() {
    return photos.filter(function (p) { return p.ocr; }).map(function (p) {
      return { photoIndex: photos.indexOf(p), text: p.ocr.text, confidence: p.ocr.confidence };
    });
  }

  $('btn-recognize').addEventListener('click', runOcr);
  $('ocr-prev').addEventListener('click', function () { if (reviewIdx > 0) { reviewIdx--; renderReview(); $('content').scrollTop = 0; } });
  $('ocr-next').addEventListener('click', function () { if (reviewIdx < photos.length - 1) { reviewIdx++; renderReview(); $('content').scrollTop = 0; } });
  $('ocr-text').addEventListener('input', function () {
    var p = photos[reviewIdx];
    if (p && p.ocr) { p.ocr.text = this.value; p.ocr.edited = true; $('btn-solve').disabled = !photos.some(function (ph) { return ph.ocr && ph.ocr.text.trim(); }); }
  });
  $('btn-ocr-back').addEventListener('click', function () { showScreen('home'); });
  $('btn-solve').addEventListener('click', function () { runSolve(); });

  /* ================= E4: Router + Solver + вывод ответа ================= */
  var solutions = [], solving = false, nerdamerReady = false;
  var NERD_BASE = 'https://cdn.jsdelivr.net/npm/nerdamer@1.1.13/';
  var FUNCS = /\b(sin|cos|tan|cot|asin|acos|atan|log|sqrt|exp|pi|abs|defint|integrate|diff|simplify|factor|expand)\b/g;

  /*E4-PURE-START*/
  function normalize(s) {
    return String(s)
      .replace(/[−–—]/g, '-').replace(/-{2,}/g, '-').replace(/[×·⋅]/g, '*').replace(/÷/g, '/')
      .replace(/²/g, '^2').replace(/³/g, '^3').replace(/π/g, 'pi')
      .replace(/√\s*\(([^)]*)\)/g, 'sqrt($1)').replace(/√\s*([A-Za-z0-9.]+)/g, 'sqrt($1)')
      .replace(/(\d),(\d)/g, '$1.$2')
      .replace(/\barc(sin|cos|tan)\b/gi, 'a$1').replace(/\barctg\b/gi, 'atan')
      .replace(/\btg\b/gi, 'tan').replace(/\bctg\b/gi, 'cot').replace(/\bln\b/gi, 'log')
      .replace(/\b(sin|cos|tan|cot|asin|acos|atan|log|sqrt|exp)\s+([A-Za-z0-9.]+(?:\^[0-9.]+)?)/gi, '$1($2)')
      .replace(/([0-9a-z)])\s+(sin|cos|tan|cot|asin|acos|atan|log|sqrt|exp)\(/gi, '$1*$2(');
  }

  function cleanMath(n) {
    // Tesseract теряет степень после скобки: «(x+5)2» → (x+5)^2. Метки списков «1) 2x…», «A) 3x…» не трогаем
    n = n.replace(/\)\s*([23])(?![\d.])/g, function (m, d, off, str) {
      var ls = str.lastIndexOf('\n', off) + 1;
      return /^\s*\S{1,2}$/.test(str.slice(ls, off)) ? m : ')^' + d;
    });
    // Tesseract часто читает показатель степени как * или ?: «9q?» → 9q^2
    n = n.replace(/(\d)([a-zA-Z])[?*](?=\s|$|[-+−—)\/])/g, '$1$2^2')
         .replace(/([\s(])([a-zA-Z])[?*](?=\s*[-+−—)\/=])/g, '$1$2^2');
    var CYR = { 'а': 'a', 'е': 'e', 'о': 'o', 'р': 'p', 'с': 'c', 'х': 'x', 'у': 'y', 'к': 'k', 'м': 'm', 'т': 't', 'в': 'b', 'н': 'h', 'Х': 'x', 'У': 'y' };
    // OCR читает цифру 3 как кириллическую «З»: «За + 5а» → «3а + 5а». Только отдельная З либо З + буква перед знаком/концом:
    // слова вроде «значение», «Задание» не трогаем (иначе в выражении остаётся лишняя «3»)
    n = n.replace(/(^|[^А-Яа-яЁё])[зЗ](?=[^А-Яа-яЁё]|$)/g, function (m, pre) { return pre + '3'; })
         .replace(/(^|[^А-Яа-яЁё])[зЗ](?=[a-zA-Zаеорсхукмтвн]\s*(?:[-+*\/^=)]|$))/g, function (m, pre) { return pre + '3'; });
    var s = n.replace(/[А-Яа-яЁё]{2,}/g, ' ')
      // кириллические «двойники» → латиница (3а+5а-2а → 3a+5a-2a); х/у — всегда, остальные — только вплотную к цифре, знаку или скобке
      .replace(/[аеорсхукмтвнХУ]/g, function (ch, off, str) {
        if (ch === 'х' || ch === 'Х' || ch === 'у' || ch === 'У') return CYR[ch];
        var glued = /[\dA-Za-z+\-*\/^=()]/;
        return (glued.test(str[off - 1] || ' ') || glued.test(str[off + 1] || ' ')) ? CYR[ch] : ch;
      })
      .replace(/[А-Яа-яЁё]/g, ' ').replace(/[?!№]+/g, ' ').replace(/\s+/g, ' ')
      .replace(/^[\s.,;:]+|[\s.,;:]+$/g, '').trim();
    // …а если степень потеряна совсем: q2 → q^2 (если в тексте нет индексов вида x1)
    if (!/(^|[^a-zA-Z])[a-zA-Z]1(?![\w.])/.test(s)) s = s.replace(/(^|[^a-zA-Z])([a-zA-Z])([23])(?![\w.(])/g, '$1$2^$3');
    return s;
  }

  function detectVar(e) {
    var t = e.replace(FUNCS, ' '), set = {}, i;
    (t.match(/[a-zA-Z]/g) || []).forEach(function (c) { set[c] = 1; });
    if (set.x) return 'x';
    var keys = Object.keys(set).filter(function (c) { return c !== 'e' && c !== 'i'; });
    return keys[0] || null;
  }

  function parseChoices(text) {   // тест с вариантами A) B) C) D): условие + варианты
    var lines = String(text).split('\n').map(function (l) { return l.trim(); })
      .filter(function (l) { return l && !(l.length <= 2 && !/[A-Za-z0-9А-Яа-я]/.test(l)); });   // мусор вроде «@»
    var strict = /^([A-Ea-eАВСЕавсе])\s*[)\].:]\s*(.*)$/, loose = /^(?:(\S{1,2})\s*[)\]]|([A-E])\s+(?=\())\s*(\S.*)$/, frac = /^\S{0,2}\s*\(.+\)\/\(.+\)$/, fx = function (l) { return l.slice(l.indexOf('(')); };
    var map = { 'А': 'A', 'В': 'B', 'С': 'C', 'Е': 'E', 'а': 'A', 'в': 'B', 'с': 'C', 'е': 'E' };
    var ABC = 'ABCDEFG', stem = [], opts = [], m;
    // 1) строгий разбор: метки A) B) C) прочитаны верно
    lines.forEach(function (l) {
      if ((m = strict.exec(l))) opts.push({ label: map[m[1]] || m[1].toUpperCase(), text: m[2] });
      else if (opts.length && frac.test(l)) opts.push({ label: ABC[ABC.indexOf(opts[opts.length - 1].label) + 1] || '?', text: fx(l) });
      else if (opts.length) opts[opts.length - 1].text += ' ' + l;
      else stem.push(l);
    });
    if (opts.length >= 2 && opts[0].label === 'A') return { stem: stem.join(' '), options: opts };
    // 2) мягкий разбор: OCR исказил или потерял метки — берём хвост из строк «метка) выражение» и строк-дробей
    var first = -1, i;
    for (i = 1; i < lines.length; i++) if (loose.test(lines[i])) { first = i; break; }
    if (first < 0) return null;
    opts = [];
    lines.slice(first).forEach(function (l) {
      if ((m = loose.exec(l))) opts.push({ text: m[3], sl: (strict.test(l) || m[2]) ? (map[l[0]] || l[0].toUpperCase()) : null });
      else if (frac.test(l)) opts.push({ text: fx(l), sl: null });
      else if (opts.length) opts[opts.length - 1].text += ' ' + l;
    });
    if (opts.length < 3) return null;
    var offset = 0;
    for (i = 0; i < opts.length; i++) if (opts[i].sl) { offset = Math.max(0, ABC.indexOf(opts[i].sl) - i); break; }
    return { stem: lines.slice(0, first).join(' '), options: opts.map(function (o, k) { return { label: ABC[k + offset], text: o.text }; }) };
  }

  function splitProblems(text) {
    var out = [], blocks = [];
    var head = /^(задани[ея]|задач[аи]|упражнени[ея]|вопрос|№)\s*\d*\s*[.:)]?\s*$/i;
    var optStart = /^[AАaа]\s*[)\].:]/, optAny = /(^|\n)[AАaа]\s*[)\].:]/;
    String(text).split(/\n\s*\n/).forEach(function (b) {
      var lines = b.split('\n').map(function (l) { return l.trim(); }).filter(function (l) { return l && !head.test(l); });
      if (!lines.length) return;
      var prev = blocks[blocks.length - 1];
      if (prev && optStart.test(lines[0]) && !optAny.test(prev.join('\n'))) blocks[blocks.length - 1] = prev.concat(lines);   // варианты оторвались от условия
      else blocks.push(lines);
    });
    var num = /^\d+[.)]\s*/;
    blocks.forEach(function (lines) {
      if (parseChoices(lines.join('\n'))) { out.push(lines.join('\n').replace(num, '')); return; }
      var numbered = lines.filter(function (l) { return num.test(l); }).length;
      if (numbered >= 2) {
        var cur = null;
        lines.forEach(function (l) {
          if (num.test(l)) { if (cur) out.push(cur); cur = l.replace(num, ''); }
          else if (cur !== null) cur += ' ' + l;
        });
        if (cur) out.push(cur);
      } else {
        out.push(lines.join('\n').replace(num, ''));
      }
    });
    return out.filter(function (t) { return t.trim(); });
  }

  function route(t) {
    if (/[∫∑√]|\b(sin|cos|tan|tg|ctg|cot|log|ln)\b|производн|интеграл|\^|[²³]/i.test(t)) return 'math';
    if (/[₀-₉]|моль|реакци|кислот|оксид|щ[её]лоч|электролит|\b(H2O|NaOH|HCl|H2SO4|CO2|O2|H2|N2|NaCl)\b/i.test(t)) return 'chem';
    if (/треугольник|окружност|площад|периметр|радиус|параллелограмм|трапеци|диагонал|гипотенуз/i.test(t)) return 'geom';
    if (/=|\d/.test(t)) return 'math';
    return 'unknown';
  }

  function splitTop(s) {
    var out = [], depth = 0, cur = '';
    for (var i = 0; i < s.length; i++) {
      var c = s[i];
      if (c === '(' || c === '[') depth++;
      if (c === ')' || c === ']') depth--;
      if (c === ',' && depth === 0) { out.push(cur.trim()); cur = ''; } else cur += c;
    }
    if (cur.trim()) out.push(cur.trim());
    return out.filter(Boolean);
  }

  function pretty(s) {
    return String(s).replace(/\*/g, '·').replace(/sqrt\(([^()]*)\)/g, '√($1)').replace(/\bpi\b/g, 'π').replace(/\blog\(/g, 'ln(');
  }

  function isComplex(s) { return /(^|[^a-z])i([^a-z]|$)/.test(s); }
  /*E4-PURE-END*/

  function addScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = src; s.onload = resolve;
      s.onerror = function () { reject(new Error('script')); };
      document.head.appendChild(s);
    });
  }

  async function loadNerdamer() {
    if (nerdamerReady) return;
    var files = ['nerdamer.core.js', 'Algebra.js', 'Calculus.js', 'Solve.js', 'Extra.js'];
    for (var i = 0; i < files.length; i++) await addScript(NERD_BASE + files[i]);
    nerdamerReady = true;
  }

  function dec(expr) {
    try {
      var n = Number(nerdamer(expr).evaluate().text('decimals'));
      if (!isFinite(n)) return null;
      return String(+n.toFixed(6));
    } catch (e) { return null; }
  }

  function unsolved(str) {
    if (/\b(integrate|defint|diff)\(/.test(str)) throw new Error('unsolved');
    return str;
  }

  function solveIntegral(raw) {
    var n = normalize(raw), a = null, b = null, m;
    if ((m = /от\s*(-?[\w.]+(?:\/[\w.]+)?)\s*до\s*(-?[\w.]+(?:\/[\w.]+)?)/i.exec(n))) { a = m[1]; b = m[2]; n = n.replace(m[0], ' '); }
    if ((m = /∫\s*_\s*\(?\s*(-?[\w.]+)\s*\)?\s*\^\s*\(?\s*(-?[\w.]+)\s*\)?/.exec(n))) { a = m[1]; b = m[2]; n = n.replace(m[0], '∫'); }
    var e = cleanMath(n.replace(/∫/g, ' ')), v = null;
    m = /(^|[^a-zA-Z])d([a-z])\s*$/.exec(e);
    if (m) { v = m[2]; e = e.slice(0, m.index + m[1].length).trim(); }
    v = v || detectVar(e) || 'x';
    if (!e) throw new Error('empty');
    if (a !== null) {
      var r = nerdamer('defint(' + e + ',' + a + ',' + b + ',' + v + ')');
      var s = unsolved(r.toString()), d = dec(s);
      return { answer: pretty(s) + (d && d !== s ? ' ≈ ' + d : ''), kind: 'Определённый интеграл' };
    }
    var res = unsolved(nerdamer('integrate(' + e + ',' + v + ')').toString());
    return { answer: pretty(res) + ' + C', kind: 'Неопределённый интеграл' };
  }

  function solveDerivative(raw) {
    var e = cleanMath(normalize(raw));
    e = e.replace(/d\s*\/\s*d[a-z]/g, ' ').replace(/\b[a-zA-Z]\s*'\s*(\(\s*[a-z]\s*\))?\s*=?/g, ' ').replace(/'/g, ' ').trim();
    if (e.indexOf('=') > -1) e = e.slice(e.lastIndexOf('=') + 1).trim();
    if (!e) throw new Error('empty');
    var v = detectVar(e) || 'x';
    return { answer: pretty(unsolved(nerdamer('diff(' + e + ',' + v + ')').toString())), kind: 'Производная' };
  }

  var SAMPLES = [0.37, 1.3, -2.1, 2.9, -0.73];

  function val(e, v, x) {
    try {
      var subs = {};
      if (v) subs[v] = String(x);
      return Number(nerdamer(e, subs).evaluate().text('decimals'));
    } catch (err) { return NaN; }
  }

  function sameValue(e1, e2, v) {   // совпадение выражений по значениям в нескольких точках
    var pts = v ? SAMPLES : [0], ok = 0;
    for (var i = 0; i < pts.length; i++) {
      var a = val(e1, v, pts[i]), b = val(e2, v, pts[i]);
      if (!isFinite(a) || !isFinite(b)) continue;
      if (Math.abs(a - b) > 1e-6 * Math.max(1, Math.abs(a), Math.abs(b))) return false;
      ok++;
    }
    return ok >= (v ? 3 : 1);
  }

  function solveExpression(raw, preClean) {
    var e = preClean || cleanMath(normalize(raw));
    e = e.replace(/=\s*$/, '').trim();
    if (!e) throw new Error('empty');
    var v = detectVar(e);
    if (!v) {
      var s = nerdamer(e).evaluate().toString(), d = dec(e);
      return { answer: pretty(s) + (d && d !== s ? ' ≈ ' + d : ''), kind: 'Вычисление', verified: true };
    }
    var fn = /множител/i.test(raw) ? 'factor' : (/раскро|скобк/i.test(raw) ? 'expand' : 'simplify');
    var res = nerdamer(fn + '(' + e + ')').toString();
    var ok = sameValue(e, res, v);
    return { answer: pretty(res), kind: 'Преобразование выражения', verified: ok, note: ok ? 'Проверено подстановкой.' : 'Не удалось проверить подстановкой.' };
  }

  function solveChoice(ch) {   // тест с вариантами: ответ = вариант, совпавший по значениям с результатом
    var stem = cleanMath(normalize(ch.stem));
    var opts = ch.options.map(function (o) { return { label: o.label, expr: cleanMath(normalize(o.text)) }; });
    if (!stem) {   // подпункты a) b) c) без общего условия — решаем каждый отдельно
      var parts = opts.map(function (o) {
        try { return o.label + ') ' + mathSolve(o.expr).answer; } catch (e) { return o.label + ') не решено'; }
      });
      return { answer: parts.join('\n'), kind: 'Подпункты' };
    }
    var v = detectVar(stem) || detectVar(opts.map(function (o) { return o.expr; }).join(' '));
    var base = null;
    try { base = solveExpression(ch.stem); } catch (e) { base = null; }
    var hits = opts.filter(function (o) { return o.expr && sameValue(stem, o.expr, v); });
    var simple = base && base.verified ? ' Упрощённо: ' + base.answer : '';
    if (hits.length) {
      return { answer: hits.map(function (h) { return h.label + ') ' + pretty(h.expr); }).join('; '), kind: 'Тест с вариантами',
        note: 'Вариант совпал с результатом (проверено подстановкой чисел).' + simple };
    }
    if (base && base.verified) return { answer: base.answer, kind: 'Тест с вариантами', note: 'Ни один вариант не совпал — проверьте текст вариантов.' };
    throw new Error('choice');
  }

  function solveEquation(raw) {
    var e = cleanMath(normalize(raw)).replace(/[{}]/g, '');
    var parts = e.split('=');
    if (parts.length !== 2) throw new Error('eq');
    var lhs = parts[0].trim(), rhs = parts[1].trim();
    if (!rhs) return solveExpression(raw, lhs);
    var v = detectVar(e) || 'x';
    var sol = nerdamer.solve(lhs + '=' + rhs, v).toString().replace(/^\[|\]$/g, '');
    var items = splitTop(sol);
    if (!items.length) {
      try {   // пустой список корней: возможно, это тождество
        var idn = Number(nerdamer(lhs + ' - (' + rhs + ')').evaluate().text('decimals'));
        if (isFinite(idn) && Math.abs(idn) < 1e-9) return { answer: v + ' — любое число', kind: 'Уравнение' };
      } catch (e6) { /* не тождество */ }
      return { answer: 'Действительных решений нет', kind: 'Уравнение' };
    }
    var bad = false;
    var out = items.map(function (it) {
      if (!isComplex(it)) {
        try {
          var chk = nerdamer('(' + lhs + ')-(' + rhs + ')', (function () { var o = {}; o[v] = it; return o; })()).evaluate().text('decimals');
          var v2 = Number(chk); if (!isFinite(v2) || Math.abs(v2) > 1e-6) bad = true;
        } catch (e2) { /* проверка недоступна */ }
      }
      var d = isComplex(it) ? null : dec(it);
      return v + ' = ' + pretty(it) + (d && d !== it ? ' ≈ ' + d : '');
    });
    return { answer: out.join('; '), kind: 'Уравнение', note: bad ? 'Проверка подстановкой не сошлась — проверьте условие.' : 'Проверено подстановкой.' };
  }

  function solveSystem(lines) {
    var eqs = lines.map(function (l) { return cleanMath(normalize(l)).replace(/[{}]/g, '').trim(); })
      .filter(function (l) { return l.indexOf('=') > -1; });
    var r = nerdamer.solveEquations(eqs);
    if (!Array.isArray(r) || !r.length) throw new Error('system');
    var out = r.map(function (p) { return Array.isArray(p) ? p[0] + ' = ' + pretty(String(p[1])) : String(p); });
    return { answer: out.join('; '), kind: 'Система уравнений' };
  }

  function mathSolve(text) {
    var ch = parseChoices(text);
    if (ch) return solveChoice(ch);
    var lines = text.split('\n').map(function (l) { return l.trim(); }).filter(Boolean);
    if (/∫|интеграл/i.test(text)) return solveIntegral(text);
    if (/производн|d\s*\/\s*d[a-z]|\)\s*'/i.test(text)) return solveDerivative(text);
    var eqLines = lines.filter(function (l) { return /\S\s*=\s*\S/.test(l); });
    if (eqLines.length >= 2) return solveSystem(eqLines);
    if (text.indexOf('=') > -1) return solveEquation(text);
    return solveExpression(text);
  }

  function solveOne(pr) {
    var kind = route(pr.text), base = { photoIndex: pr.photoIndex, text: pr.text, route: kind };
    if (pr.text.trim().length < 3 || pr.confidence < 0.3) {
      return Object.assign(base, { status: 'fail', kind: 'ocr', message: 'Не удалось прочитать фото. Переснимите при лучшем свете.' });
    }
    if (kind === 'chem') return Object.assign(base, { status: 'stub', message: 'Химия — скоро' });
    if (kind === 'geom') return Object.assign(base, { status: 'stub', message: 'Геометрия — в следующей версии' });
    if (kind === 'unknown') return Object.assign(base, { status: 'fail', kind: 'route', message: 'Текст распознан, но этот предмет пока не решаю.' });
    try {
      var r = mathSolve(pr.text);
      if (!r.answer) throw new Error('empty');
      return Object.assign(base, { status: 'ok', answer: r.answer, note: r.note || '', kindLabel: r.kind });
    } catch (e) {
      return Object.assign(base, { status: 'fail', kind: 'solve', message: 'Не смог решить — проверьте условие.' });
    }
  }

  var tick = function () { return new Promise(function (r) { setTimeout(r, 0); }); };

  function renderSkeleton() {
    $('solution-task').textContent = 'Решаю…';
    $('solution-task').className = 'card summary';
    var list = $('solution-steps'); list.textContent = '';
    for (var i = 0; i < 2; i++) { var s = document.createElement('div'); s.className = 'skeleton'; list.appendChild(s); }
  }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  // Превращает текст Nerdamer в красивый LaTeX
  function latexify(str) {
    if (!str) return '';
    var s = String(str);
    s = s.replace(/(\d)\*([a-zA-Z])/g, '$1$2'); // 20*x -> 20x
    s = s.replace(/\*/g, ' \\cdot ');           // остальные * -> ·
    s = s.replace(/sqrt\(([^()]*)\)/g, '\\sqrt{$1}'); // sqrt(5) -> √5
    s = s.replace(/\bpi\b/g, '\\pi');           // pi -> π
    s = s.replace(/\blog\(/g, '\\ln(');         // log -> ln
    s = s.replace(/≈/g, '\\approx');
    return s;
  }

  function renderSolutions() {
    var ok = solutions.filter(function (s) { return s.status === 'ok'; }).length;
    var head = $('solution-task');
    head.className = 'card summary';
    head.textContent = solutions.length ? 'Задач: ' + solutions.length + ' · решено: ' + ok : 'Пока нет решений';
    var list = $('solution-steps'); list.textContent = '';
    solutions.forEach(function (s, i) {
      var card = el('div', 'card prob');
      card.appendChild(el('div', 'prob-meta', 'Фото ' + (s.photoIndex + 1) + (s.kindLabel ? ' · ' + s.kindLabel : '')));
      card.appendChild(el('div', 'prob-task', s.text));
      var box = el('div', 'answer-box' + (s.status === 'fail' ? ' err' : (s.status === 'stub' ? ' stub' : '')));
      if (s.status === 'ok') {
        box.appendChild(el('div', 'answer-label', 'Ответ'));
        var ansEl = el('div', 'answer');
        
        // Если в ответе есть русские буквы (например "Действительных решений нет"), пишем текстом
        if (/[а-яА-Я]/.test(s.answer)) {
          ansEl.textContent = s.answer;
        } else {
          try {
            // Разбиваем ответы через ; (например "x = 2; x = 3") и рисуем каждый на новой строке
            var parts = s.answer.split(';');
            parts.forEach(function(p, i) {
              if (i > 0) ansEl.appendChild(document.createElement('br'));
              var span = document.createElement('span');
              katex.render(latexify(p.trim()), span, { displayMode: true, throwOnError: false });
              ansEl.appendChild(span);
            });
          } catch (e) {
            ansEl.textContent = s.answer; // если KaTeX сломался, показываем как было
          }
        }
        
        box.appendChild(ansEl);
        if (s.note) box.appendChild(el('div', 'answer-note', s.note));
      } else {
        box.appendChild(el('div', 'answer', s.message));
      }
      card.appendChild(box);
      if (s.status === 'ok') addSteps(card, s);
      if (s.status === 'fail') {
        var b = el('button', 'btn btn-secondary btn-block', 'Редактировать текст');
        b.type = 'button';
        b.addEventListener('click', function () {
          reviewIdx = s.photoIndex; setState('OCR_REVIEW'); renderReview(); showScreen('ocr-review');
        });
        card.appendChild(b);
      }
      list.appendChild(card);
    });
  }

  async function runSolve() {
    if (solving) return;
    var probs = [];
    photos.forEach(function (p, i) {
      if (!p.ocr) return;
      var conf = p.ocr.edited ? 1 : p.ocr.confidence, txt = p.ocr.text.trim();
      if (txt.length < 3) { probs.push({ photoIndex: i, text: txt, confidence: conf }); return; }
      splitProblems(txt).forEach(function (t) { probs.push({ photoIndex: i, text: t, confidence: conf }); });
    });
    if (!probs.length) { toast('Нет текста для решения'); return; }
    solving = true; solutions = [];
    $('btn-solve').disabled = true;
    setState('SOLVING'); renderSkeleton(); showScreen('solution');
    if (probs.some(function (p) { return p.text.length >= 3 && !(p.confidence < 0.3) && route(p.text) === 'math'; })) {
      try { await loadNerdamer(); }
      catch (e) {
        solving = false; setState('OCR_REVIEW'); renderReview(); showScreen('ocr-review');
        toast('Нет интернета. Подключитесь один раз для загрузки');
        return;
      }
    }
    for (var i = 0; i < probs.length; i++) { await tick(); solutions.push(solveOne(probs[i])); }
    solving = false;
    setState('SOLUTION_SHOWN');
    renderSolutions();
    renderReview();
  }

  /* ================= E5: Пошаговое решение (алгоритм, без нейросетей) ================= */
  /*E5-PURE-START*/
  function numsOf(str) {
    var out = [];
    String(str).replace(/(\d)\s*,\s*(\d)/g, '$1.$2').replace(/\d+(?:\.\d+)?(?:\/\d+)?/g, function (t) {
      var v;
      if (t.indexOf('/') > -1) { var q = t.split('/'); v = Number(q[0]) / Number(q[1]); } else v = Number(t);
      if (isFinite(v)) out.push(v);
      return t;
    });
    return out;
  }

  function nearNum(a, b) { return Math.abs(a - b) < 1e-9 || Math.abs(a - b) <= 0.01 * Math.max(Math.abs(a), Math.abs(b)); }

  function fmt(n) {   // число → «5», «3/2» или «1.4142»
    if (!isFinite(n)) return String(n);
    var r = Math.round(n);
    if (Math.abs(n - r) < 1e-9) return String(r === 0 ? 0 : r);
    for (var q = 2; q <= 100; q++) {
      var p = Math.round(n * q);
      if (Math.abs(n * q - p) < 1e-9) return p + '/' + q;
    }
    return String(+n.toFixed(4));
  }
  function fmtD(n) { return Math.abs(n - Math.round(n)) < 1e-9 ? String(Math.round(n)) : String(+n.toFixed(6)); }
  function signed(n) { var f = fmt(n); return (n < 0 || f.indexOf('/') > -1) ? '(' + f + ')' : f; }
  function term(a, v) {
    if (Math.abs(a - 1) < 1e-9) return v;
    if (Math.abs(a + 1) < 1e-9) return '-' + v;
    var f = fmt(a);
    return (f.indexOf('/') > -1 ? '(' + f + ')' : f) + v;
  }

  // шаги показываем только если вычисленные ими числа совпали с ответом nerdamer
  function matchesAnswer(vals, finalAnswer) {
    var ans = numsOf(finalAnswer);
    if (!ans.length) return false;
    return vals.every(function (v) { return ans.some(function (a) { return nearNum(Math.abs(v), a); }); });
  }

  function varsOf(e) {
    var t = e.replace(FUNCS, ' '), seen = {}, out = [];
    (t.match(/[a-zA-Z]/g) || []).forEach(function (c) { if (c !== 'e' && c !== 'i' && !seen[c]) { seen[c] = 1; out.push(c); } });
    return out.sort();
  }

  function evalN(e, subs) {   // численное значение выражения при подстановке переменных
    var o = {};
    Object.keys(subs).forEach(function (k) { o[k] = String(subs[k]); });
    try { return Number(nerdamer(e, o).evaluate().text('decimals')); } catch (err) { return NaN; }
  }

  // Коэффициенты A·v² + B·v + C по значениям функции в нескольких точках; null — не многочлен степени ≤ 2
  function polyFit(f, v) {
    var g = function (x) { var o = {}; o[v] = x; return f(o); };
    var c = g(0), p = g(1), m = g(-1);
    if (![c, p, m].every(isFinite)) return null;
    var A = (p + m) / 2 - c, B = (p - m) / 2, chk = [2, -2, 3, 0.5];
    for (var i = 0; i < chk.length; i++) {
      var y = g(chk[i]);
      if (!isFinite(y) || Math.abs(y - (A * chk[i] * chk[i] + B * chk[i] + c)) > 1e-7 * (1 + Math.abs(y) + Math.abs(c))) return null;
    }
    return { A: A, B: B, C: c };
  }

  function linearSteps(lhs, rhs, v, fa) {
    var L = polyFit(function (o) { return evalN(lhs, o); }, v), R = polyFit(function (o) { return evalN(rhs, o); }, v);
    if (!L || !R || Math.abs(L.A) > 1e-9 || Math.abs(R.A) > 1e-9) return null;
    var al = L.B, bl = L.C, ar = R.B, br = R.C, a = al - ar;
    if (Math.abs(a) < 1e-9) return null;
    var c = br - bl, x = c / a, steps = [];
    if (Math.abs(ar) < 1e-9) {   // ax + b = c
      if (Math.abs(bl) > 1e-9) {
        steps.push('1. Перенесем ' + fmt(bl) + ' в правую часть' + (bl < 0 ? ' (знак меняется)' : '') + ': ' + term(a, v) + ' = ' + fmt(br) + (bl < 0 ? ' + ' + fmt(-bl) : ' - ' + fmt(bl)) + ' = ' + fmt(c));
      }
    } else {                     // x есть в обеих частях
      steps.push('1. Перенесем слагаемые с ' + v + ' влево, числа вправо: (' + fmt(al) + ' - ' + signed(ar) + ')' + v + ' = ' + fmt(br) + ' - ' + signed(bl) + ', то есть ' + term(a, v) + ' = ' + fmt(c));
    }
    if (Math.abs(a - 1) > 1e-9) steps.push((steps.length + 1) + '. Разделим обе части на ' + fmt(a) + ': ' + v + ' = ' + fmt(c) + ' / ' + fmt(a) + ' = ' + fmt(x));
    if (!steps.length) return null;
    return matchesAnswer([x], fa) ? steps : null;
  }

  function quadraticSteps(lhs, rhs, v, fa) {
    var F = polyFit(function (o) { return evalN(lhs, o) - evalN(rhs, o); }, v);
    if (!F || Math.abs(F.A) < 1e-9) return null;
    var A = F.A, B = F.B, C = F.C, D = B * B - 4 * A * C;
    var steps = [
      '1. Приведем уравнение к виду ax² + bx + c = 0: a = ' + fmt(A) + ', b = ' + fmt(B) + ', c = ' + fmt(C),
      '2. Найдем дискриминант по формуле D = b² - 4ac: D = ' + signed(B) + '² - 4·' + signed(A) + '·' + signed(C) + ' = ' + fmt(D)
    ];
    if (D > 1e-9) {
      var sq = Math.sqrt(D), r1 = (-B + sq) / (2 * A), r2 = (-B - sq) / (2 * A);
      var sqs = Math.abs(sq - Math.round(sq)) < 1e-9 ? fmt(sq) : '√' + fmt(D);
      steps.push('3. D > 0, значит два корня: ' + v + ' = (-b ± √D) / (2a)');
      steps.push('4. Вычислим корни: ' + v + '₁ = (' + fmt(-B) + ' + ' + sqs + ') / ' + signed(2 * A) + ' = ' + fmt(r1) + ';  ' + v + '₂ = (' + fmt(-B) + ' - ' + sqs + ') / ' + signed(2 * A) + ' = ' + fmt(r2));
      return matchesAnswer([r1, r2], fa) ? steps : null;
    }
    if (Math.abs(D) <= 1e-9) {
      var r = -B / (2 * A);
      steps.push('3. D = 0, значит один корень: ' + v + ' = -b / (2a) = ' + fmt(-B) + ' / ' + signed(2 * A) + ' = ' + fmt(r));
      return matchesAnswer([r], fa) ? steps : null;
    }
    steps.push('3. D < 0, значит действительных корней нет');
    return /нет|i/i.test(String(fa)) ? steps : null;
  }

  function systemSteps(lines, fa) {
    var eqs = lines.map(function (l) { return l.split('='); });
    if (eqs.some(function (q) { return q.length !== 2 || !q[1].trim(); })) return null;
    var vars = varsOf(lines.join(' '));
    if (vars.length !== 2) return null;
    var X = vars[0], Y = vars[1];
    var coef = function (q) {   // ax + by = k
      var g = function (x, y) { var o = {}; o[X] = x; o[Y] = y; return evalN(q[0], o) - evalN(q[1], o); };
      var g0 = g(0, 0), a = g(1, 0) - g0, b = g(0, 1) - g0, k = -g0;
      var t1 = g(2, 3), t2 = g(-1, 2);
      if (![g0, a, b, t1, t2].every(isFinite)) return null;
      if (Math.abs(t1 - (2 * a + 3 * b - k)) > 1e-7 * (1 + Math.abs(t1)) || Math.abs(t2 - (-a + 2 * b - k)) > 1e-7 * (1 + Math.abs(t2))) return null;
      return { a: a, b: b, k: k };
    };
    var c1 = coef(eqs[0]), c2 = coef(eqs[1]);
    if (!c1 || !c2) return null;
    var u = X, w = Y;
    if (Math.abs(c1.a) < 1e-9) {
      if (Math.abs(c1.b) < 1e-9) return null;
      u = Y; w = X;
      c1 = { a: c1.b, b: c1.a, k: c1.k }; c2 = { a: c2.b, b: c2.a, k: c2.k };
    }
    var P = c2.b - c2.a * c1.b / c1.a, Q = c2.k - c2.a * c1.k / c1.a;
    if (Math.abs(P) < 1e-9) return null;   // нет единственного решения
    var wv = Q / P, uv = (c1.k - c1.b * wv) / c1.a;
    var expr = '(' + fmt(c1.k) + ' - ' + signed(c1.b) + '·' + w + ') / ' + signed(c1.a);
    var steps = [
      '1. Выразим ' + u + ' из первого уравнения: ' + u + ' = ' + expr,
      '2. Подставим во второе уравнение: ' + signed(c2.a) + '·' + '(' + expr + ') + ' + signed(c2.b) + '·' + w + ' = ' + fmt(c2.k),
      '3. Раскроем скобки и приведем подобные слагаемые: ' + signed(P) + '·' + w + ' = ' + fmt(Q),
      '4. Найдем ' + w + ': ' + w + ' = ' + fmt(Q) + ' / ' + signed(P) + ' = ' + fmt(wv),
      '5. Подставим ' + w + ' = ' + fmt(wv) + ' в выражение для ' + u + ': ' + u + ' = (' + fmt(c1.k) + ' - ' + signed(c1.b) + '·' + signed(wv) + ') / ' + signed(c1.a) + ' = ' + fmt(uv),
      '6. Получили: ' + (u === X ? X + ' = ' + fmt(uv) + ', ' + Y + ' = ' + fmt(wv) : X + ' = ' + fmt(wv) + ', ' + Y + ' = ' + fmt(uv))
    ];
    return matchesAnswer([uv, wv], fa) ? steps : null;
  }

  function arithSteps(expr, fa) {   // числа, + - * / ^ и скобки (без отрицательных чисел внутри скобок)
    var e = expr.replace(/\s+/g, '').replace(/·/g, '*');
    if (!/^[\d.+\-*\/^()]+$/.test(e) || !/\d[+\-*\/^]\(?\d/.test(e) || /\d\(|\)\d|\)\(/.test(e)) return null;
    var steps = [], num = '\\d+(?:\\.\\d+)?', guard = 0, m;
    var push = function (t) { steps.push((steps.length + 1) + '. ' + t); };
    var rs = function (r) { return String(+r.toFixed(9)); };
    var flat = function (str) {
      var g = 0, m2;
      while (g++ < 40) {
        if ((m2 = new RegExp('(' + num + ')\\^(' + num + ')').exec(str))) {
          var r1 = Math.pow(+m2[1], +m2[2]);
          push('Возведем в степень: ' + m2[1] + '^' + m2[2] + ' = ' + fmtD(r1)); str = str.replace(m2[0], rs(r1)); continue;
        }
        if ((m2 = new RegExp('(' + num + ')([*\\/])(' + num + ')').exec(str))) {
          if (m2[2] === '/' && +m2[3] === 0) throw new Error('div0');
          var r2 = m2[2] === '*' ? +m2[1] * +m2[3] : +m2[1] / +m2[3];
          push((m2[2] === '*' ? 'Выполним умножение: ' + m2[1] + ' · ' + m2[3] : 'Выполним деление: ' + m2[1] + ' / ' + m2[3]) + ' = ' + fmtD(r2));
          str = str.replace(m2[0], rs(r2)); continue;
        }
        if ((m2 = new RegExp('^(-?' + num + ')([+\\-])(' + num + ')').exec(str))) {
          var r3 = m2[2] === '+' ? +m2[1] + +m2[3] : +m2[1] - +m2[3];
          push((m2[2] === '+' ? 'Выполним сложение: ' : 'Выполним вычитание: ') + m2[1] + ' ' + m2[2] + ' ' + m2[3] + ' = ' + fmtD(r3));
          str = str.replace(m2[0], rs(r3)); continue;
        }
        break;
      }
      return str;
    };
    while (guard++ < 20 && (m = /\(([^()]*)\)/.exec(e))) {
      if (/^\d+(?:\.\d+)?$/.test(m[1])) { e = e.replace(m[0], m[1]); continue; }
      push('Сначала выполним действия в скобках: (' + m[1] + ')');
      var res = flat(m[1]);
      if (!/^\d+(?:\.\d+)?$/.test(res)) return null;
      e = e.replace(m[0], res);
    }
    e = flat(e);
    if (!/^-?\d+(?:\.\d+)?$/.test(e) || !steps.length) return null;
    return matchesAnswer([Number(e)], fa) ? steps : null;
  }

  function groupSteps(expr) {   // 3a + 5a - 2a → (3 + 5 - 2)a = 6a
    var s = expr.replace(/\s+/g, '').replace(/·/g, '*');
    if (!/^[+\-]?[\w.*^]+(?:[+\-][\w.*^]+)*$/.test(s)) return null;
    var terms = s.match(/[+\-]?[^+\-]+/g), groups = [], idx = {};
    for (var i = 0; i < terms.length; i++) {
      var m = /^([+\-]?)(\d*\.?\d*)\*?([a-zA-Z](?:\^\d+)?)?$/.exec(terms[i]);
      if (!m || (m[2] === '' && !m[3])) return null;
      var c = (m[2] === '' ? 1 : Number(m[2])) * (m[1] === '-' ? -1 : 1), key = m[3] || '';
      if (!(key in idx)) { idx[key] = groups.length; groups.push({ key: key, cs: [] }); }
      groups[idx[key]].cs.push(c);
    }
    if (!groups.some(function (g) { return g.cs.length > 1; })) return null;
    var list = function (cs) { return cs.map(function (c, k) { return k === 0 ? fmt(c) : (c < 0 ? '- ' + fmt(-c) : '+ ' + fmt(c)); }).join(' '); };
    var joinSigned = function (items) {
      return items.map(function (it, k) { return k === 0 ? (it.neg ? '-' : '') + it.text : (it.neg ? ' - ' : ' + ') + it.text; }).join('');
    };
    var before = groups.map(function (g) {
      return g.cs.length > 1 ? { neg: false, text: '(' + list(g.cs) + ')' + g.key } : { neg: g.cs[0] < 0, text: fmt(Math.abs(g.cs[0])) + g.key };
    });
    var sums = groups.map(function (g) { return { key: g.key, c: g.cs.reduce(function (p, q) { return p + q; }, 0) }; }).filter(function (g) { return Math.abs(g.c) > 1e-9; });
    var after = sums.map(function (g) { return { neg: g.c < 0, text: (Math.abs(Math.abs(g.c) - 1) < 1e-9 && g.key ? '' : fmt(Math.abs(g.c))) + g.key }; });
    var resText = after.length ? joinSigned(after) : '0';
    var resExpr = sums.length ? sums.map(function (g) { return '(' + g.c + ')' + (g.key ? '*' + g.key : ''); }).join('+') : '0';
    if (!sameValue(s, resExpr, detectVar(s))) return null;
    return ['1. Сгруппируем подобные слагаемые: ' + joinSigned(before), '2. Сложим коэффициенты: ' + resText];
  }

  function generateSteps(taskText, finalAnswer) {
    try {
      var text = String(taskText), ch = parseChoices(text), base = ch ? ch.stem : text;
      var lines = base.split('\n').map(function (l) { return l.trim(); }).filter(Boolean);
      var eqLines = lines.filter(function (l) { return /\S\s*=\s*\S/.test(l); });
      var steps = null;
      if (eqLines.length >= 2) {
        steps = systemSteps(eqLines.map(function (l) { return cleanMath(normalize(l)).replace(/[{}]/g, '').trim(); }), finalAnswer);
      } else {
        var e = cleanMath(normalize(base)).replace(/[{}]/g, '');
        if (e.indexOf('=') > -1) {
          var parts = e.split('=');
          if (parts.length === 2 && parts[1].trim()) {
            var v = detectVar(e);
            if (v) steps = linearSteps(parts[0], parts[1], v, finalAnswer) || quadraticSteps(parts[0], parts[1], v, finalAnswer);
            e = '';
          } else if (parts.length === 2) e = parts[0];
        }
        if (!steps && e && e.indexOf('=') === -1) steps = arithSteps(e, finalAnswer) || groupSteps(e);
      }
      return steps || [];
    } catch (err) { return []; }
  }
  /*E5-PURE-END*/

  function addSteps(card, s) {
    var btn = el('button', 'btn btn-secondary btn-block', 'Показать шаги решения');
    btn.type = 'button';
    var steps = el('div', 'answer-steps');
    steps.style.cssText = 'display:none; margin-top: 12px; padding-left: 12px; border-left: 2px solid var(--border);';
    btn.addEventListener('click', function () {
      var list = generateSteps(s.text, s.answer);
      steps.textContent = '';
      (list.length ? list : ['Для этого типа задач пошаговый разбор пока не поддерживается.']).forEach(function (l) {
        steps.appendChild(el('div', 'step', l));
      });
      steps.style.display = 'block';
      btn.disabled = true;
    });
    card.appendChild(btn);
    card.appendChild(steps);
  }

  function resetAll() {
    if (busy || solving) return;
    solutions = []; reviewIdx = 0;
    clearPhotos();
    $('solution-task').textContent = ''; $('solution-steps').textContent = '';
    setState('IDLE');
    showScreen('home');
  }

  render();
  setState('IDLE');

  // Для проверки: #home, #ocr-review, #solution в адресе или studyAI.showScreen('solution') в консоли
  window.studyAI = {
    showScreen: showScreen,
    toast: toast,
    getPhotos: function () { return photos.map(function (p) { return { id: p.id, blob: p.blob }; }); },
    getOcrResults: getOcrResults,
    getSolutions: function () { return solutions.slice(); },
    reset: resetAll
  };
  var initial = location.hash.slice(1);
  showScreen(SCREENS[initial] ? initial : 'home');
})();
