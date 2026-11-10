(function () {
  'use strict';

  // --- НАСТРОЙКА ТЕМЫ ---
  function applyTheme(theme) {
    if (theme === 'system') {
      var isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
    } else {
      document.documentElement.setAttribute('data-theme', theme);
    }
    localStorage.setItem('study_ai_theme', theme);
    var sel = document.getElementById('theme-select');
    if (sel) sel.value = theme;
  }
  applyTheme(localStorage.getItem('study_ai_theme') || 'system');

  var SCREENS = { 'home': 'screen-home', 'crop': 'screen-crop', 'ocr-review': 'screen-ocr-review', 'solution': 'screen-solution', 'history': 'screen-history', 'settings': 'screen-settings' };
  var current = 'home';
  var toastTimer = null;

  function showScreen(name) {
    if (!SCREENS[name]) return;
    current = name;
    Object.keys(SCREENS).forEach(function (key) {
      document.getElementById(SCREENS[key]).classList.toggle('active', key === name);
    });
    document.querySelectorAll('.nav-btn[data-nav]').forEach(function (btn) {
      if (btn.getAttribute('data-nav') === name) btn.setAttribute('aria-current', 'page');
      else btn.removeAttribute('aria-current');
    });
    document.getElementById('content').scrollTop = 0;
    try { if (location.hash !== '#' + name) history.replaceState(null, '', '#' + name); } catch (e) { }
    if (name === 'history') renderHistory();
    document.getElementById('math-keyboard').classList.remove('show');
  }

  function toast(message, ms) {
    var el = document.getElementById('toast');
    el.textContent = message; el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('show'); }, ms || 3000);
  }

  document.querySelectorAll('[data-nav]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var target = btn.getAttribute('data-nav');
      if (SCREENS[target]) showScreen(target);
    });
  });

  document.getElementById('btn-new-task').addEventListener('click', function () { resetAll(); });
  window.addEventListener('hashchange', function () {
    var name = location.hash.slice(1);
    if (SCREENS[name] && name !== current) showScreen(name);
  });

  // Настройки
  document.getElementById('btn-reset-data').addEventListener('click', function() {
    if (confirm('Вы уверены? Все данные и история будут удалены.')) {
      localStorage.clear();
      if ('caches' in window) { caches.keys().then(function(names) { for (var name of names) caches.delete(name); }); }
      location.reload();
    }
  });
  document.getElementById('theme-select').addEventListener('change', function(e) { applyTheme(e.target.value); });

  // История
  var historyList = document.getElementById('history-list');
  function saveToHistory(text, answer) {
    var history = JSON.parse(localStorage.getItem('study_ai_history') || '[]');
    history.unshift({ id: Date.now(), date: new Date().toISOString(), text: text, answer: answer });
    if (history.length > 50) history.pop();
    localStorage.setItem('study_ai_history', JSON.stringify(history));
  }
  function renderHistory() {
    var history = JSON.parse(localStorage.getItem('study_ai_history') || '[]');
    historyList.textContent = '';
    if (!history.length) { historyList.innerHTML = '<p class="status" style="text-align:center; margin-top: 24px;">История пуста</p>'; return; }
    history.forEach(function(item) {
      var d = new Date(item.date);
      var dateStr = d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
      var card = document.createElement('div'); card.className = 'card history-item';
      card.innerHTML = '<button class="history-del" data-id="'+item.id+'" aria-label="Удалить"><svg class="icon"><use href="#i-trash"/></svg></button>' +
        '<div class="history-date">' + dateStr + '</div><div class="history-task">' + item.text + '</div><div class="history-answer">' + (item.answer || '—') + '</div>';
      historyList.appendChild(card);
    });
  }
  historyList.addEventListener('click', function(e) {
    var delBtn = e.target.closest('.history-del');
    if (delBtn) {
      var id = Number(delBtn.dataset.id);
      var history = JSON.parse(localStorage.getItem('study_ai_history') || '[]');
      history = history.filter(function(h) { return h.id !== id; });
      localStorage.setItem('study_ai_history', JSON.stringify(history)); renderHistory();
    }
  });
  document.getElementById('btn-clear-history').addEventListener('click', function() {
    if (confirm('Очистить историю?')) { localStorage.removeItem('study_ai_history'); renderHistory(); }
  });

  /* ================= E2: Input & Manual Mode ================= */
  var manualArea = document.getElementById('manual-area');
  var mathKeyboard = document.getElementById('math-keyboard');
  var mathInput = document.getElementById('math-input');
  
  document.getElementById('btn-manual-toggle').addEventListener('click', function() {
    manualArea.classList.toggle('show');
    if (manualArea.classList.contains('show')) {
      setTimeout(() => mathInput.focus(), 100);
    }
  });
  
  document.getElementById('btn-show-math').addEventListener('click', function(e) {
    e.preventDefault(); mathKeyboard.classList.add('show'); mathInput.focus();
  });
  
  document.getElementById('btn-hide-math').addEventListener('click', function() {
    mathKeyboard.classList.remove('show');
  });
  
  document.querySelectorAll('.key').forEach(function(btn) {
    btn.addEventListener('click', function() {
      var sym = this.dataset.key;
      var startPos = mathInput.selectionStart;
      var endPos = mathInput.selectionEnd;
      mathInput.value = mathInput.value.substring(0, startPos) + sym + mathInput.value.substring(endPos, mathInput.value.length);
      mathInput.focus();
      mathInput.selectionStart = mathInput.selectionEnd = startPos + sym.length;
      // Клавиатура НЕ скрывается
    });
  });

  document.getElementById('btn-solve-manual').addEventListener('click', function() {
    var txt = mathInput.value.trim();
    if (!txt) { toast('Введите задачу'); return; }
    runManualSolve(txt);
  });

  async function runManualSolve(text) {
    if (solving) return;
    solving = true; solutions = [];
    setState('SOLVING'); renderSkeleton(); showScreen('solution');
    try { await loadNerdamer(); } catch(e) { toast('Ошибка загрузки математики'); solving = false; return; }
    
    await tick();
    var sol = solveOne({ photoIndex: 0, text: text, confidence: 1 });
    solutions.push(sol);
    if (sol.status === 'ok') saveToHistory(sol.text, sol.answer);
    
    solving = false; setState('SOLUTION_SHOWN'); renderSolutions();
  }

  /* ================= Камера и Обрезка ================= */
  var inCamera = document.getElementById('input-camera');
  var inUpload = document.getElementById('input-upload');
  var cropImg = document.getElementById('crop-image');
  var cropContainer = document.getElementById('crop-container');
  var currentFileBlob = null; // Сюда сохраняем вырезанный кусок
  
  document.getElementById('btn-camera').addEventListener('click', function () { inCamera.click(); });
  document.getElementById('btn-upload').addEventListener('click', function () { inUpload.click(); });
  
  [inCamera, inUpload].forEach(function(inp) {
    inp.addEventListener('change', function() {
      if (!inp.files.length) return;
      var file = inp.files[0];
      var url = URL.createObjectURL(file);
      cropImg.src = url;
      showScreen('crop');
      inp.value = '';
    });
  });

  document.getElementById('btn-crop-cancel').addEventListener('click', function() { showScreen('home'); });
  
  document.getElementById('btn-crop-apply').addEventListener('click', function() {
    if (!cropImg.src) return;
    var box = document.getElementById('crop-box');
    var imgRect = cropImg.getBoundingClientRect();
    var boxRect = box.getBoundingClientRect();
    
    // Координаты рамки относительно картинки
    var x = boxRect.left - imgRect.left;
    var y = boxRect.top - imgRect.top;
    var w = boxRect.width;
    var h = boxRect.height;

    // Пересчет в реальные пиксели картинки
    var scaleX = cropImg.naturalWidth / imgRect.width;
    var scaleY = cropImg.naturalHeight / imgRect.height;
    
    var canvas = document.createElement('canvas');
    canvas.width = w * scaleX;
    canvas.height = h * scaleY;
    var ctx = canvas.getContext('2d');
    
    // Вырезаем
    ctx.drawImage(cropImg, x * scaleX, y * scaleY, w * scaleX, h * scaleY, 0, 0, canvas.width, canvas.height);
    
    canvas.toBlob(function(blob) {
      currentFileBlob = blob;
      photos = [{ id: '1', blob: blob, url: URL.createObjectURL(blob) }];
      showScreen('ocr-review');
      runOcr(); // Запускаем распознавание
    }, 'image/jpeg', 0.85);
  });

  // Логика движения рамки (4 угла)
  var cropBox = document.getElementById('crop-box');
  var handles = document.querySelectorAll('.handle');
  var isDragging = false, isResizing = false, currentHandle = null;
  var startX, startY, startLeft, startTop, startWidth, startHeight;

  cropBox.addEventListener('pointerdown', function(e) {
    if (e.target.classList.contains('handle')) return;
    isDragging = true; startX = e.clientX; startY = e.clientY;
    startLeft = cropBox.offsetLeft; startTop = cropBox.offsetTop;
    cropBox.setPointerCapture(e.pointerId);
  });

  handles.forEach(function(handle) {
    handle.addEventListener('pointerdown', function(e) {
      e.stopPropagation(); isResizing = true; currentHandle = handle.dataset.dir;
      startX = e.clientX; startY = e.clientY; startLeft = cropBox.offsetLeft; startTop = cropBox.offsetTop;
      startWidth = cropBox.offsetWidth; startHeight = cropBox.offsetHeight;
      handle.setPointerCapture(e.pointerId);
    });
  });

  document.addEventListener('pointermove', function(e) {
    if (isDragging) {
      var dx = e.clientX - startX; var dy = e.clientY - startY;
      cropBox.style.left = Math.max(0, Math.min(cropContainer.offsetWidth - cropBox.offsetWidth, startLeft + dx)) + 'px';
      cropBox.style.top = Math.max(0, Math.min(cropContainer.offsetHeight - cropBox.offsetHeight, startTop + dy)) + 'px';
    }
    if (isResizing) {
      var dx = e.clientX - startX; var dy = e.clientY - startY;
      if (currentHandle === 'br') {
        cropBox.style.width = Math.max(50, Math.min(cropContainer.offsetWidth - startLeft, startWidth + dx)) + 'px';
        cropBox.style.height = Math.max(50, Math.min(cropContainer.offsetHeight - startTop, startHeight + dy)) + 'px';
      } else if (currentHandle === 'tl') {
        var newW = Math.max(50, startWidth - dx); var newH = Math.max(50, startHeight - dy);
        cropBox.style.width = newW + 'px'; cropBox.style.height = newH + 'px';
        cropBox.style.left = (startLeft + (startWidth - newW)) + 'px'; cropBox.style.top = (startTop + (startHeight - newH)) + 'px';
      } else if (currentHandle === 'tr') {
        var newH = Math.max(50, startHeight - dy);
        cropBox.style.width = Math.max(50, Math.min(cropContainer.offsetWidth - startLeft, startWidth + dx)) + 'px';
        cropBox.style.height = newH + 'px'; cropBox.style.top = (startTop + (startHeight - newH)) + 'px';
      } else if (currentHandle === 'bl') {
        var newW = Math.max(50, startWidth - dx);
        cropBox.style.width = newW + 'px'; cropBox.style.height = Math.max(50, Math.min(cropContainer.offsetHeight - startTop, startHeight + dy)) + 'px';
        cropBox.style.left = (startLeft + (startWidth - newW)) + 'px';
      }
    }
  });
  document.addEventListener('pointerup', function() { isDragging = false; isResizing = false; currentHandle = null; });

  /* ================= E3-E5: OCR & Math Logic ================= */
  // (Здесь идет весь тот огромный код, который мы писали ранее: binarize, Tesseract, Nerdamer, KaTeX, шаги решений)
  // Пробрасываем переменные
  var photos = [];
  var solutions = [], solving = false, nerdamerReady = false;
  var TESS_URL = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
  var OCR_LANG = 'rus+eng';
  var LOW_CONF = 0.7;
  var worker = null, ocrLogger = null, reviewIdx = 0, ocrFailed = false;
  var NERD_BASE = 'https://cdn.jsdelivr.net/npm/nerdamer@1.1.13/';

  function runOcr() {
    // Вставь сюда старую функцию runOcr из предыдущего app.js (она рабочая)
    // Для сокращения ответа я её опускаю, но она должна быть здесь!
    // ... 
    // (Если нужно, я могу скинуть только этот кусок, но лучше взять из старого файла)
  }
  
  // ... Вставь сюда все функции: normalize, cleanMath, solveEquation, quadraticSteps, expandSteps, generateSteps и т.д.
  // А также renderSolutions, addSteps и логику KaTeX.

  function resetAll() {
    if (solving) return;
    solutions = []; reviewIdx = 0; photos = [];
    document.getElementById('math-input').value = '';
    document.getElementById('solution-task').textContent = '';
    document.getElementById('solution-steps').textContent = '';
    showScreen('home');
  }
  
  window.studyAI = { showScreen: showScreen, toast: toast, reset: resetAll };
  showScreen('home');
})();
