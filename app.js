(() => {
  'use strict';

  const STORAGE_KEYS = Object.freeze({
    history: 'study-ai-history-v1',
    theme: 'study-ai-theme-v1'
  });

  const CDN = Object.freeze({
    nerdamer: 'https://cdn.jsdelivr.net/npm/nerdamer@1.1.13/all.min.js',
    tesseract: 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js'
  });

  const state = {
    screen: 'home',
    files: [],
    items: [],
    cropIndex: 0,
    ocrIndex: 0,
    cropObjectUrl: '',
    cropDrag: null,
    toastTimer: null,
    tesseractWorker: null,
    tesseractPromise: null,
    nerdamerPromise: null
  };

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

  const elements = {};

  function cacheElements() {
    elements.html = document.documentElement;
    elements.content = $('#content');
    elements.manualArea = $('#manual-area');
    elements.mathInput = $('#math-input');
    elements.keyboard = $('#math-keyboard');
    elements.cropContainer = $('#crop-container');
    elements.cropImage = $('#crop-image');
    elements.cropBox = $('#crop-box');
    elements.homeProgress = $('#home-progress');
    elements.progressBar = $('#progress-bar');
    elements.homeStatus = $('#home-status');
    elements.ocrWarning = $('#ocr-warning');
    elements.ocrPager = $('#ocr-pager');
    elements.ocrPrevious = $('#ocr-prev');
    elements.ocrNext = $('#ocr-next');
    elements.ocrPageLabel = $('#ocr-page-label');
    elements.ocrPhoto = $('#ocr-photo');
    elements.ocrText = $('#ocr-text');
    elements.ocrConfidence = $('#ocr-conf');
    elements.solutionTask = $('#solution-task');
    elements.solutionSteps = $('#solution-steps');
    elements.historyList = $('#history-list');
    elements.themeSelect = $('#theme-select');
    elements.toast = $('#toast');
  }

  function loadScript(src, id) {
    if (window[id]) return Promise.resolve(window[id]);
    const existing = document.querySelector(`script[data-study-ai-library="${id}"]`);
    if (existing) {
      return new Promise((resolve, reject) => {
        existing.addEventListener('load', () => resolve(window[id]), { once: true });
        existing.addEventListener('error', () => reject(new Error(`Не удалось загрузить ${id}`)), { once: true });
      });
    }

    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = src;
      script.async = true;
      script.dataset.studyAiLibrary = id;
      script.onload = () => window[id] ? resolve(window[id]) : reject(new Error(`Библиотека ${id} недоступна`));
      script.onerror = () => reject(new Error(`Не удалось загрузить ${id}`));
      document.head.appendChild(script);
    });
  }

  function ensureNerdamer() {
    if (window.nerdamer) return Promise.resolve(window.nerdamer);
    if (!state.nerdamerPromise) {
      state.nerdamerPromise = loadScript(CDN.nerdamer, 'nerdamer').catch((error) => {
        state.nerdamerPromise = null;
        throw error;
      });
    }
    return state.nerdamerPromise;
  }

  function showToast(message, duration = 3200) {
    if (!elements.toast) return;
    elements.toast.textContent = message;
    elements.toast.classList.add('show');
    clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(() => elements.toast.classList.remove('show'), duration);
  }

  function setStatus(message, visible = true) {
    if (!elements.homeStatus) return;
    elements.homeStatus.textContent = message;
    elements.homeStatus.hidden = !visible;
  }

  function setProgress(value, message = '') {
    const normalized = Math.max(0, Math.min(100, Number(value) || 0));
    if (elements.homeProgress) elements.homeProgress.hidden = normalized <= 0 || normalized >= 100;
    if (elements.progressBar) elements.progressBar.style.width = `${normalized}%`;
    if (message) setStatus(message, true);
  }

  function navigate(screenName) {
    const target = ['home', 'crop', 'ocr-review', 'solution', 'history', 'settings'].includes(screenName)
      ? screenName
      : 'home';

    state.screen = target;
    $$('.screen').forEach((screen) => {
      const active = screen.id === `screen-${target}`;
      screen.classList.toggle('active', active);
      screen.setAttribute('aria-hidden', String(!active));
    });
    $$('[data-nav]').forEach((button) => {
      const active = button.dataset.nav === target;
      button.setAttribute('aria-current', active ? 'page' : 'false');
    });
    if (target === 'history') renderHistory();
    if (target !== 'crop') stopCropInteraction();
    if (elements.content) elements.content.scrollTop = 0;
  }

  function getSavedTheme() {
    const value = localStorage.getItem(STORAGE_KEYS.theme);
    return ['system', 'light', 'dark'].includes(value) ? value : 'system';
  }

  function applyTheme(value, persist = true) {
    const theme = ['system', 'light', 'dark'].includes(value) ? value : 'system';
    if (theme === 'system') elements.html.removeAttribute('data-theme');
    else elements.html.setAttribute('data-theme', theme);
    if (elements.themeSelect) elements.themeSelect.value = theme;
    if (persist) localStorage.setItem(STORAGE_KEYS.theme, theme);
  }

  function toggleManualInput() {
    const shouldShow = !elements.manualArea.classList.contains('show');
    elements.manualArea.classList.toggle('show', shouldShow);
    if (shouldShow) {
      elements.mathInput.focus();
      elements.manualArea.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }

  function insertAtCursor(text) {
    const input = elements.mathInput;
    const start = Number.isInteger(input.selectionStart) ? input.selectionStart : input.value.length;
    const end = Number.isInteger(input.selectionEnd) ? input.selectionEnd : start;
    input.setRangeText(text, start, end, 'end');
    input.focus();
  }

  function showKeyboard() {
    elements.keyboard.classList.add('show');
    elements.keyboard.setAttribute('aria-hidden', 'false');
  }

  function hideKeyboard() {
    elements.keyboard.classList.remove('show');
    elements.keyboard.setAttribute('aria-hidden', 'true');
    elements.mathInput.focus();
  }

  function resetCropBox() {
    const box = elements.cropBox;
    box.style.left = '10%';
    box.style.top = '35%';
    box.style.width = '80%';
    box.style.height = '30%';
  }

  function createWorkflowItems(files) {
    state.items.forEach((item) => item.objectUrl && URL.revokeObjectURL(item.objectUrl));
    state.files = files.slice(0, 20);
    state.items = state.files.map((file) => ({
      file,
      objectUrl: URL.createObjectURL(file),
      cropBlob: null,
      cropDataUrl: '',
      text: '',
      confidence: null
    }));
    state.cropIndex = 0;
    state.ocrIndex = 0;
  }

  function openFilePicker(inputId) {
    const input = document.getElementById(inputId);
    if (!input) return;
    input.value = '';
    input.click();
  }

  function showCropScreen(index = 0) {
    if (!state.items.length) return;
    state.cropIndex = Math.max(0, Math.min(index, state.items.length - 1));
    const item = state.items[state.cropIndex];
    state.cropObjectUrl = item.objectUrl;
    elements.cropImage.onload = () => {
      resetCropBox();
      navigate('crop');
    };
    elements.cropImage.onerror = () => {
      showToast('Не удалось открыть изображение.');
      navigate('home');
    };
    elements.cropImage.src = item.objectUrl;
    if (elements.cropImage.complete && elements.cropImage.naturalWidth > 0) elements.cropImage.onload();
  }

  function stopCropInteraction() {
    const pointerId = state.cropDrag?.pointerId;
    if (pointerId !== undefined && elements.cropBox.hasPointerCapture?.(pointerId)) {
      elements.cropBox.releasePointerCapture(pointerId);
    }
    state.cropDrag = null;
  }

  function getLocalPoint(event) {
    const rect = elements.cropContainer.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(rect.width, event.clientX - rect.left)),
      y: Math.max(0, Math.min(rect.height, event.clientY - rect.top)),
      width: rect.width,
      height: rect.height
    };
  }

  function getBoxMetrics() {
    const containerRect = elements.cropContainer.getBoundingClientRect();
    const boxRect = elements.cropBox.getBoundingClientRect();
    return {
      left: boxRect.left - containerRect.left,
      top: boxRect.top - containerRect.top,
      width: boxRect.width,
      height: boxRect.height,
      containerWidth: containerRect.width,
      containerHeight: containerRect.height
    };
  }

  function setBoxMetrics(metrics) {
    const safe = {
      left: Math.max(0, Math.min(metrics.left, metrics.containerWidth - metrics.width)),
      top: Math.max(0, Math.min(metrics.top, metrics.containerHeight - metrics.height)),
      width: Math.max(24, Math.min(metrics.width, metrics.containerWidth)),
      height: Math.max(24, Math.min(metrics.height, metrics.containerHeight))
    };
    safe.left = Math.min(safe.left, metrics.containerWidth - safe.width);
    safe.top = Math.min(safe.top, metrics.containerHeight - safe.height);
    elements.cropBox.style.left = `${safe.left}px`;
    elements.cropBox.style.top = `${safe.top}px`;
    elements.cropBox.style.width = `${safe.width}px`;
    elements.cropBox.style.height = `${safe.height}px`;
  }

  function beginCropPointer(event) {
    if (event.button !== undefined && event.button !== 0) return;
    const handle = event.target.closest('.handle');
    const mode = handle ? handle.dataset.dir : 'move';
    if (!handle && event.target !== elements.cropBox && !event.target.closest('#crop-box')) return;
    state.cropDrag = {
      pointerId: event.pointerId,
      mode,
      start: getLocalPoint(event),
      box: getBoxMetrics()
    };
    elements.cropBox.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  }

  function moveCropPointer(event) {
    const drag = state.cropDrag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const point = getLocalPoint(event);
    const dx = point.x - drag.start.x;
    const dy = point.y - drag.start.y;
    const minSize = 32;
    let { left, top, width, height } = drag.box;

    if (drag.mode === 'move') {
      left = Math.max(0, Math.min(drag.box.containerWidth - width, left + dx));
      top = Math.max(0, Math.min(drag.box.containerHeight - height, top + dy));
    } else {
      const right = drag.box.left + drag.box.width;
      const bottom = drag.box.top + drag.box.height;
      if (drag.mode.includes('l')) {
        left = Math.max(0, Math.min(drag.box.left + drag.box.width - minSize, drag.box.left + dx));
        width = right - left;
      }
      if (drag.mode.includes('r')) {
        width = Math.max(minSize, Math.min(drag.box.containerWidth - drag.box.left, drag.box.width + dx));
      }
      if (drag.mode.includes('t')) {
        top = Math.max(0, Math.min(drag.box.top + drag.box.height - minSize, drag.box.top + dy));
        height = bottom - top;
      }
      if (drag.mode.includes('b')) {
        height = Math.max(minSize, Math.min(drag.box.containerHeight - drag.box.top, drag.box.height + dy));
      }
    }
    setBoxMetrics({ left, top, width, height, containerWidth: drag.box.containerWidth, containerHeight: drag.box.containerHeight });
    event.preventDefault();
  }

  function endCropPointer(event) {
    if (!state.cropDrag || state.cropDrag.pointerId !== event.pointerId) return;
    elements.cropBox.releasePointerCapture?.(event.pointerId);
    state.cropDrag = null;
  }

  function loadImage(url) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('Не удалось прочитать изображение'));
      image.src = url;
    });
  }

  function rgbToGray(r, g, b) {
    return Math.round(0.299 * r + 0.587 * g + 0.114 * b);
  }

  function otsuBinarize(imageData) {
    const { data } = imageData;
    const histogram = new Uint32Array(256);
    const gray = new Uint8Array(data.length / 4);
    for (let i = 0, p = 0; i < data.length; i += 4, p += 1) {
      const value = rgbToGray(data[i], data[i + 1], data[i + 2]);
      gray[p] = value;
      histogram[value] += 1;
    }

    let total = 0;
    for (let i = 0; i < 256; i += 1) total += i * histogram[i];
    let backgroundWeight = 0;
    let backgroundSum = 0;
    let threshold = 128;
    let maxVariance = 0;
    const totalPixels = gray.length;

    for (let i = 0; i < 256; i += 1) {
      backgroundWeight += histogram[i];
      if (!backgroundWeight) continue;
      const foregroundWeight = totalPixels - backgroundWeight;
      if (!foregroundWeight) break;
      backgroundSum += i * histogram[i];
      const meanBackground = backgroundSum / backgroundWeight;
      const meanForeground = (total - backgroundSum) / foregroundWeight;
      const variance = backgroundWeight * foregroundWeight * (meanBackground - meanForeground) ** 2;
      if (variance > maxVariance) {
        maxVariance = variance;
        threshold = i;
      }
    }

    for (let i = 0, p = 0; i < data.length; i += 4, p += 1) {
      const value = gray[p] > threshold ? 255 : 0;
      data[i] = value;
      data[i + 1] = value;
      data[i + 2] = value;
      data[i + 3] = 255;
    }
    return imageData;
  }

  function canvasToBlob(canvas, type = 'image/png', quality = 0.95) {
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('Не удалось создать изображение')), type, quality);
    });
  }

  function getCropSourceRect() {
    const container = elements.cropContainer.getBoundingClientRect();
    const image = elements.cropImage.getBoundingClientRect();
    const box = elements.cropBox.getBoundingClientRect();
    const left = Math.max(box.left, image.left);
    const top = Math.max(box.top, image.top);
    const right = Math.min(box.right, image.right);
    const bottom = Math.min(box.bottom, image.bottom);
    if (right <= left || bottom <= top) throw new Error('Рамка должна находиться внутри изображения');

    const scaleX = elements.cropImage.naturalWidth / image.width;
    const scaleY = elements.cropImage.naturalHeight / image.height;
    return {
      x: (left - image.left) * scaleX,
      y: (top - image.top) * scaleY,
      width: (right - left) * scaleX,
      height: (bottom - top) * scaleY,
      container
    };
  }

  async function cropCurrentImage() {
    const item = state.items[state.cropIndex];
    if (!item) throw new Error('Изображение не выбрано');
    const source = await loadImage(item.objectUrl);
    const rect = getCropSourceRect();
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(rect.width));
    canvas.height = Math.max(1, Math.round(rect.height));
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(source, rect.x, rect.y, rect.width, rect.height, 0, 0, canvas.width, canvas.height);
    const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
    context.putImageData(otsuBinarize(imageData), 0, 0);
    item.cropBlob = await canvasToBlob(canvas);
    item.cropDataUrl = canvas.toDataURL('image/png');
    return item.cropBlob;
  }

  async function ensureTesseract() {
    if (window.Tesseract) return window.Tesseract;
    if (!state.tesseractPromise) {
      state.tesseractPromise = loadScript(CDN.tesseract, 'Tesseract').catch((error) => {
        state.tesseractPromise = null;
        throw error;
      });
    }
    return state.tesseractPromise;
  }

  async function createTesseractWorker() {
    const Tesseract = await ensureTesseract();
    if (state.tesseractWorker) return state.tesseractWorker;
    const logger = (event) => {
      if (event.status === 'recognizing text' && Number.isFinite(event.progress)) {
        const base = state.cropIndex / Math.max(1, state.items.length);
        setProgress((base + event.progress / Math.max(1, state.items.length)) * 100, `Распознавание: ${Math.round(event.progress * 100)}%`);
      }
    };
    try {
      state.tesseractWorker = await Tesseract.createWorker('rus+eng', 1, { logger });
    } catch (error) {
      state.tesseractWorker = await Tesseract.createWorker('eng', 1, { logger });
    }
    return state.tesseractWorker;
  }

  async function recognizeBlob(blob) {
    const worker = await createTesseractWorker();
    const result = await worker.recognize(blob, {}, { preserve_interword_spaces: '1' });
    return {
      text: result?.data?.text?.trim() || '',
      confidence: Number.isFinite(result?.data?.confidence) ? result.data.confidence : null
    };
  }

  function normalizeMathText(input) {
    let text = String(input || '')
      .replace(/[\u2212\u2013\u2014]/g, '-')
      .replace(/[×✕]/g, '*')
      .replace(/[÷:]/g, '/')
      .replace(/π/g, 'pi')
      .replace(/∞/g, 'Infinity')
      .replace(/[²]/g, '^2')
      .replace(/[³]/g, '^3')
      .replace(/√\s*\(/g, 'sqrt(')
      .replace(/√\s*([0-9.]+)/g, 'sqrt($1)')
      .replace(/\s+/g, ' ')
      .trim();
    text = text.replace(/\b([0-9]+)\s*([a-zA-Z])\b/g, '$1*$2');
    text = text.replace(/\)\s*([a-zA-Z0-9])/g, ')*$1');
    text = text.replace(/([a-zA-Z0-9])\s*\(/g, '$1*(');
    text = text.replace(/\b(sqrt|sin|cos|tan|log)\*\(/g, '$1(');
    return text;
  }

  function getVariables(expression) {
    const withoutFunctions = expression
      .replace(/sqrt|sin|cos|tan|log|abs|exp|pi/gi, '')
      .replace(/\d+(?:\.\d+)?/g, '')
      .replace(/[+\-*/^().,=\s]/g, '');
    return Array.from(new Set(withoutFunctions.split('').filter((char) => /[a-zA-Z]/.test(char))));
  }

  function cleanNerdamerAnswer(value) {
    if (Array.isArray(value)) return value.map(cleanNerdamerAnswer).filter(Boolean).join(', ');
    if (value && typeof value.text === 'function') return value.text('fractions');
    return String(value ?? '').replace(/^\[|\]$/g, '').trim();
  }

  function extractEquationAnswer(raw, variable) {
    if (!Array.isArray(raw)) return cleanNerdamerAnswer(raw);
    const values = raw.map((entry) => {
      if (!Array.isArray(entry)) return cleanNerdamerAnswer(entry);
      const variableIndex = entry.findIndex((part) => String(part).trim() === variable);
      const candidate = variableIndex >= 0 ? entry[variableIndex + 1] : entry[entry.length - 1];
      return cleanNerdamerAnswer(candidate);
    }).filter(Boolean);
    return Array.from(new Set(values)).join(', ');
  }

  function numericNerdamer(expression) {
    if (!window.nerdamer) return NaN;
    try {
      const result = window.nerdamer(expression).evaluate().text('decimal');
      const number = Number(result);
      return Number.isFinite(number) ? number : NaN;
    } catch {
      return NaN;
    }
  }

  function evaluateAt(expression, variable, value) {
    const pattern = new RegExp(`\\b${variable.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}\\b`, 'g');
    return numericNerdamer(expression.replace(pattern, `(${value})`));
  }

  function formatNumber(value) {
    if (!Number.isFinite(value)) return String(value);
    if (Math.abs(value - Math.round(value)) < 1e-10) return String(Math.round(value));
    return String(Number(value.toFixed(10)));
  }

  function polynomialCoefficients(left, right, variable) {
    const expression = `(${left})-(${right})`;
    const c = evaluateAt(expression, variable, 0);
    const plus = evaluateAt(expression, variable, 1);
    const minus = evaluateAt(expression, variable, -1);
    const two = evaluateAt(expression, variable, 2);
    if (![c, plus, minus, two].every(Number.isFinite)) return null;
    const a = (plus + minus - 2 * c) / 2;
    const b = (plus - minus) / 2;
    const residual = two - (4 * a + 2 * b + c);
    if (Math.abs(residual) > 1e-7) return null;
    return { a, b, c };
  }

  function polynomialText(a, b, c, variable) {
    const parts = [];
    if (Math.abs(a) > 1e-10) parts.push(`${formatNumber(a)}${variable}^2`);
    if (Math.abs(b) > 1e-10) parts.push(`${b >= 0 && parts.length ? '+' : ''}${formatNumber(b)}${variable}`);
    if (Math.abs(c) > 1e-10 || !parts.length) parts.push(`${c >= 0 && parts.length ? '+' : ''}${formatNumber(c)}`);
    return parts.join('');
  }

  function generateSteps(text, variable, left, right) {
    const steps = [];
    const hasParentheses = /\([^()]+\)/.test(text);
    const coefficients = polynomialCoefficients(left, right, variable);

    if (hasParentheses && window.nerdamer) {
      try {
        const expandedLeft = cleanNerdamerAnswer(window.nerdamer(left).expand());
        const expandedRight = cleanNerdamerAnswer(window.nerdamer(right).expand());
        if (expandedLeft !== left || expandedRight !== right) {
          steps.push(`Раскрываем скобки: ${expandedLeft} = ${expandedRight}`);
        }
      } catch {
        // Steps are optional; the answer remains valid if expansion is unavailable.
      }
    }

    if (!coefficients) return steps;
    const { a, b, c } = coefficients;
    if (Math.abs(a) < 1e-10 && Math.abs(b) > 1e-10) {
      steps.push(`${polynomialText(0, b, c, variable)} = 0`);
      if (Math.abs(c) > 1e-10) steps.push(`${formatNumber(b)}${variable} = ${formatNumber(-c)}`);
      steps.push(`${variable} = ${formatNumber(-c / b)}`);
    } else if (Math.abs(a) > 1e-10) {
      const discriminant = b * b - 4 * a * c;
      steps.push(`${polynomialText(a, b, c, variable)} = 0`);
      steps.push(`Дискриминант: D = b^2 - 4ac = ${formatNumber(discriminant)}`);
      if (discriminant >= 0) {
        steps.push(`${variable}_{1,2} = (-b ± √D) / (2a)`);
        steps.push(`${variable}_{1,2} = ${formatNumber((-b + Math.sqrt(discriminant)) / (2 * a))}, ${formatNumber((-b - Math.sqrt(discriminant)) / (2 * a))}`);
      } else {
        steps.push('D < 0, действительных корней нет.');
      }
    }
    return steps;
  }

  function solveWithNerdamer(text) {
    if (!window.nerdamer) return null;
    const normalized = normalizeMathText(text);
    const equationParts = normalized.split('=').map((part) => part.trim());
    try {
      if (equationParts.length === 2) {
        const [left, right] = equationParts;
        const variable = getVariables(normalized)[0];
        if (!variable) {
          const value = window.nerdamer(`(${left})-(${right})`).evaluate().text('decimal');
          return { status: Math.abs(Number(value)) < 1e-10 ? 'ok' : 'error', answer: Math.abs(Number(value)) < 1e-10 ? 'Верно' : 'Уравнение неверно', steps: [] };
        }
        const raw = window.nerdamer.solveEquations(`${left}=${right}`, variable);
        const answer = extractEquationAnswer(raw, variable);
        if (!answer) return null;
        return { status: 'ok', answer, steps: generateSteps(normalized, variable, left, right) };
      }

      const expression = normalized.replace(/^вычисли\s*/i, '').trim();
      const result = window.nerdamer(expression).evaluate();
      const answer = cleanNerdamerAnswer(result);
      if (!answer) return null;
      const expanded = /\([^()]+\)/.test(expression) ? cleanNerdamerAnswer(window.nerdamer(expression).expand()) : '';
      return {
        status: 'ok',
        answer,
        steps: expanded && expanded !== expression ? [`Раскрываем скобки: ${expanded}`] : []
      };
    } catch {
      return null;
    }
  }

  function solveOne(text) {
    const source = String(text || '').trim();
    if (!source) return { status: 'error', answer: 'Введите выражение или уравнение.', steps: [] };
    if (!window.nerdamer) {
      return { status: 'error', answer: 'Математический модуль ещё загружается. Повторите попытку через секунду.', steps: [] };
    }
    const result = solveWithNerdamer(source);
    return result || { status: 'error', answer: 'Не удалось распознать математическое выражение.', steps: [] };
  }

  function latexify(value) {
    let latex = String(value ?? '')
      .replace(/\\/g, '\\\\')
      .replace(/\*/g, ' \\cdot ')
      .replace(/sqrt\s*\(([^()]+)\)/gi, '\\sqrt{$1}')
      .replace(/√\s*([^\s,;]+)/g, '\\sqrt{$1}')
      .replace(/\b([+-]?(?:\d+(?:\.\d+)?|[a-zA-Z]))\/([+-]?(?:\d+(?:\.\d+)?|[a-zA-Z]))\b/g, '\\frac{$1}{$2}')
      .replace(/\bpi\b/gi, '\\pi')
      .replace(/\s\+\-/g, ' - ');
    latex = latex.replace(/([a-zA-Z0-9)])\^([a-zA-Z0-9]+)/g, '$1^{$2}');
    return latex;
  }

  function renderMath(target, value, displayMode = false) {
    if (!target) return;
    target.textContent = '';
    if (window.katex && !window.__katexFailed) {
      try {
        window.katex.render(latexify(value), target, { throwOnError: false, displayMode });
        return;
      } catch {
        // Plain text fallback below.
      }
    }
    target.textContent = String(value ?? '');
  }

  function renderSolution(task, result) {
    elements.solutionTask.textContent = '';
    const taskLabel = document.createElement('div');
    taskLabel.className = 'summary';
    taskLabel.textContent = 'Задача';
    const taskValue = document.createElement('div');
    taskValue.className = 'prob-task';
    taskValue.textContent = task;
    elements.solutionTask.append(taskLabel, taskValue);

    elements.solutionSteps.replaceChildren();
    const answerCard = document.createElement('div');
    answerCard.className = `card answer-box${result.status === 'ok' ? '' : ' err'}`;
    const answerLabel = document.createElement('div');
    answerLabel.className = 'answer-label';
    answerLabel.textContent = result.status === 'ok' ? 'Ответ' : 'Ошибка';
    const answer = document.createElement('div');
    answer.className = 'answer';
    renderMath(answer, result.answer);
    answerCard.append(answerLabel, answer);
    elements.solutionSteps.append(answerCard);

    if (result.steps?.length) {
      const stepsCard = document.createElement('div');
      stepsCard.className = 'card answer-steps';
      const title = document.createElement('div');
      title.className = 'answer-label';
      title.textContent = 'Шаги решения';
      stepsCard.append(title);
      result.steps.forEach((step, index) => {
        const line = document.createElement('div');
        line.className = 'step';
        const number = document.createElement('span');
        number.textContent = `${index + 1}. `;
        const formula = document.createElement('span');
        renderMath(formula, step);
        line.append(number, formula);
        stepsCard.append(line);
      });
      elements.solutionSteps.append(stepsCard);
    }
  }

  function getHistory() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEYS.history) || '[]');
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  function saveHistory(task, result) {
    if (result.status !== 'ok') return;
    const item = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      task,
      answer: result.answer,
      steps: Array.isArray(result.steps) ? result.steps : [],
      date: new Date().toISOString()
    };
    const history = [item, ...getHistory()].slice(0, 100);
    localStorage.setItem(STORAGE_KEYS.history, JSON.stringify(history));
  }

  function formatHistoryDate(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return new Intl.DateTimeFormat('ru-RU', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
  }

  function renderHistory() {
    if (!elements.historyList) return;
    const history = getHistory();
    elements.historyList.replaceChildren();
    if (!history.length) {
      const empty = document.createElement('div');
      empty.className = 'card status';
      empty.textContent = 'История пока пуста.';
      elements.historyList.append(empty);
      return;
    }
    history.forEach((item) => {
      const card = document.createElement('article');
      card.className = 'card history-item';
      const date = document.createElement('div');
      date.className = 'history-date';
      date.textContent = formatHistoryDate(item.date);
      const task = document.createElement('div');
      task.className = 'history-task';
      task.textContent = item.task || '';
      const answer = document.createElement('div');
      answer.className = 'history-answer';
      renderMath(answer, item.answer || '');
      const deleteButton = document.createElement('button');
      deleteButton.className = 'history-del';
      deleteButton.type = 'button';
      deleteButton.dataset.historyId = item.id;
      deleteButton.setAttribute('aria-label', 'Удалить запись');
      deleteButton.innerHTML = '<svg class="icon" aria-hidden="true"><use href="#i-trash"></use></svg>';
      card.append(date, task, answer, deleteButton);
      elements.historyList.append(card);
    });
  }

  function deleteHistoryItem(id) {
    const next = getHistory().filter((item) => item.id !== id);
    localStorage.setItem(STORAGE_KEYS.history, JSON.stringify(next));
    renderHistory();
  }

  async function clearCachesAndServiceWorkers() {
    if ('caches' in window) {
      const names = await caches.keys();
      await Promise.all(names.map((name) => caches.delete(name)));
    }
    if ('serviceWorker' in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map((registration) => registration.unregister()));
    }
  }

  async function resetData() {
    const confirmed = window.confirm('Удалить всю историю и настройки?');
    if (!confirmed) return;
    localStorage.clear();
    try {
      await clearCachesAndServiceWorkers();
    } finally {
      window.location.reload();
    }
  }

  async function solveAndShow(text) {
    const source = String(text || '').trim();
    if (!source) {
      showToast('Введите задачу.');
      return;
    }
    if (!window.nerdamer) {
      setStatus('Загружаю математический модуль…', true);
      try {
        await ensureNerdamer();
      } catch {
        showToast('Не удалось загрузить математический модуль.');
        return;
      }
    }
    const result = solveOne(source);
    renderSolution(source, result);
    if (result.status === 'ok') saveHistory(source, result);
    navigate('solution');
  }

  async function applyCropAndRecognize() {
    const button = $('#btn-crop-apply');
    if (!button || !state.items.length) return;
    button.disabled = true;
    try {
      setProgress(1, 'Подготавливаю изображение…');
      const item = state.items[state.cropIndex];
      const blob = await cropCurrentImage();
      setProgress(10, 'Запускаю OCR…');
      const recognized = await recognizeBlob(blob);
      item.text = recognized.text;
      item.confidence = recognized.confidence;
      if (state.cropIndex < state.items.length - 1) {
        state.cropIndex += 1;
        setProgress((state.cropIndex / state.items.length) * 100, `Фото ${state.cropIndex + 1} из ${state.items.length}`);
        showCropScreen(state.cropIndex);
      } else {
        setProgress(100);
        state.ocrIndex = 0;
        renderOcrReview();
        navigate('ocr-review');
      }
    } catch (error) {
      showToast(error.message || 'Не удалось распознать изображение.');
      setStatus('', false);
    } finally {
      button.disabled = false;
      setTimeout(() => setProgress(0), 400);
    }
  }

  function renderOcrReview() {
    const item = state.items[state.ocrIndex];
    if (!item) return;
    elements.ocrPager.hidden = state.items.length < 2;
    elements.ocrPageLabel.textContent = `Фото ${state.ocrIndex + 1} из ${state.items.length}`;
    elements.ocrPrevious.disabled = state.ocrIndex <= 0;
    elements.ocrNext.disabled = state.ocrIndex >= state.items.length - 1;
    elements.ocrPhoto.replaceChildren();
    if (item.cropDataUrl) {
      const image = document.createElement('img');
      image.src = item.cropDataUrl;
      image.alt = `Обрезанное фото ${state.ocrIndex + 1}`;
      elements.ocrPhoto.append(image);
    }
    elements.ocrText.disabled = false;
    elements.ocrText.value = item.text || '';
    elements.ocrConfidence.textContent = item.confidence == null
      ? ''
      : `Уверенность распознавания: ${Math.round(item.confidence)}%`;
    elements.ocrWarning.hidden = Boolean(item.text);
    elements.ocrWarning.textContent = item.text ? '' : 'Текст не распознан. Введите его вручную перед решением.';
  }

  async function handleFiles(files) {
    const selected = Array.from(files || []).filter((file) => file.type.startsWith('image/')).slice(0, 20);
    if (!selected.length) {
      showToast('Выберите изображение.');
      return;
    }
    createWorkflowItems(selected);
    showCropScreen(0);
  }

  function bindEvents() {
    $$('[data-nav]').forEach((button) => button.addEventListener('click', () => navigate(button.dataset.nav)));
    $('#btn-manual-toggle')?.addEventListener('click', toggleManualInput);
    $('#btn-show-math')?.addEventListener('click', showKeyboard);
    $('#btn-hide-math')?.addEventListener('click', hideKeyboard);
    $$('.key').forEach((key) => key.addEventListener('click', () => insertAtCursor(key.dataset.key || '')));
    $('#btn-solve-manual')?.addEventListener('click', () => solveAndShow(elements.mathInput.value));
    $('#btn-camera')?.addEventListener('click', () => openFilePicker('input-camera'));
    $('#btn-upload')?.addEventListener('click', () => openFilePicker('input-upload'));
    $('#input-camera')?.addEventListener('change', (event) => handleFiles(event.target.files));
    $('#input-upload')?.addEventListener('change', (event) => handleFiles(event.target.files));
    elements.cropBox?.addEventListener('pointerdown', beginCropPointer);
    elements.cropBox?.addEventListener('pointermove', moveCropPointer);
    elements.cropBox?.addEventListener('pointerup', endCropPointer);
    elements.cropBox?.addEventListener('pointercancel', endCropPointer);
    $('#btn-crop-cancel')?.addEventListener('click', () => {
      navigate('home');
      state.items.forEach((item) => item.objectUrl && URL.revokeObjectURL(item.objectUrl));
      state.items = [];
    });
    $('#btn-crop-apply')?.addEventListener('click', applyCropAndRecognize);
    $('#btn-ocr-back')?.addEventListener('click', () => showCropScreen(state.cropIndex));
    $('#btn-solve')?.addEventListener('click', () => {
      state.items[state.ocrIndex].text = elements.ocrText.value;
      const source = state.items.map((item) => item.text.trim()).filter(Boolean).join('\n');
      solveAndShow(source);
    });
    elements.ocrPrevious?.addEventListener('click', () => {
      if (state.ocrIndex <= 0) return;
      state.items[state.ocrIndex].text = elements.ocrText.value;
      state.ocrIndex -= 1;
      renderOcrReview();
    });
    elements.ocrNext?.addEventListener('click', () => {
      if (state.ocrIndex >= state.items.length - 1) return;
      state.items[state.ocrIndex].text = elements.ocrText.value;
      state.ocrIndex += 1;
      renderOcrReview();
    });
    $('#btn-new-task')?.addEventListener('click', () => navigate('home'));
    $('#btn-clear-history')?.addEventListener('click', () => {
      if (!getHistory().length) return;
      if (window.confirm('Очистить всю историю?')) {
        localStorage.removeItem(STORAGE_KEYS.history);
        renderHistory();
      }
    });
    elements.historyList?.addEventListener('click', (event) => {
      const button = event.target.closest('[data-history-id]');
      if (button) deleteHistoryItem(button.dataset.historyId);
    });
    elements.themeSelect?.addEventListener('change', (event) => applyTheme(event.target.value));
    $('#btn-reset-data')?.addEventListener('click', resetData);
    window.addEventListener('beforeunload', () => {
      state.items.forEach((item) => item.objectUrl && URL.revokeObjectURL(item.objectUrl));
      state.tesseractWorker?.terminate?.();
    });
  }

  function init() {
    cacheElements();
    applyTheme(getSavedTheme(), false);
    elements.keyboard.setAttribute('aria-hidden', 'true');
    elements.ocrText.disabled = false;
    navigate('home');
    bindEvents();
    renderHistory();
    ensureNerdamer().catch(() => setStatus('Математический модуль будет повторно загружен при решении.', true));
  }

  window.solveOne = solveOne;
  window.latexify = latexify;
  window.StudyAI = Object.freeze({ navigate, solveOne, latexify, renderHistory });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
