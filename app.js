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

  var SCREENS = {
    'home': 'screen-home',
    'ocr-review': 'screen-ocr-review',
    'solution': 'screen-solution',
    'history': 'screen-history',
    'settings': 'screen-settings'
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
    } catch (e) {}
    
    if (name === 'history') renderHistory();
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
    });
  });

  document.getElementById('btn-new-task').addEventListener('click', function () { if (window.studyAI) window.studyAI.reset(); else showScreen('home'); });

  window.addEventListener('hashchange', function () {
    var name = location.hash.slice(1);
    if (SCREENS[name] && name !== current) showScreen(name);
  });

  // Настройки: Сброс данных
  document.getElementById('btn-reset-data').addEventListener('click', function() {
    if (confirm('Вы уверены? Все данные и история будут удалены.')) {
      localStorage.clear();
      if ('caches' in window) {
        caches.keys().then(function(names) {
          for (var name of names) caches.delete(name);
        });
      }
      location.reload();
    }
  });

  // Настройки: Переключатель темы
  document.getElementById('theme-select').addEventListener('change', function(e) {
    applyTheme(e.target.value);
  });

  // --- ИСТОРИЯ ---
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
    if (!history.length) {
      historyList.innerHTML = '<p class="status" style="text-align:center; margin-top: 24px;">История пуста</p>';
      return;
    }
    history.forEach(function(item) {
      var d = new Date(item.date);
      var dateStr = d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
      
      var card = document.createElement('div');
      card.className = 'card history-item';
      card.innerHTML = 
        '<button class="history-del" data-id="'+item.id+'" aria-label="Удалить"><svg class="icon"><use href="#i-trash"/></svg></button>' +
        '<div class="history-date">' + dateStr + '</div>' +
        '<div class="history-task">' + item.text + '</div>' +
        '<div class="history-answer">' + (item.answer || '—') + '</div>';
      
      historyList.appendChild(card);
    });
  }

  historyList.addEventListener('click', function(e) {
    var delBtn = e.target.closest('.history-del');
    if (delBtn) {
      var id = Number(delBtn.dataset.id);
      var history = JSON.parse(localStorage.getItem('study_ai_history') || '[]');
      history = history.filter(function(h) { return h.id !== id; });
      localStorage.setItem('study_ai_history', JSON.stringify(history));
      renderHistory();
    }
  });

  document.getElementById('btn-clear-history').addEventListener('click', function() {
    if (confirm('Очистить историю?')) {
      localStorage.removeItem('study_ai_history');
      renderHistory();
    }
  });


  /* ================= E2: Input Layer ================= */
  // ... (остальной код E2, E3, E4, E5 без изменений)
  // ВНИМАНИЕ: Я не вставляю его сюда, чтобы не спамить, но он должен быть в файле!
