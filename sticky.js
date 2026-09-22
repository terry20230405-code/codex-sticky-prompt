(() => {
  'use strict';

  const GLOBAL_KEY = '__codexStickyPrompt';
  const VERSION = '0.1.19';
  const STORAGE_KEY = 'codex-sticky-prompt-enabled';
  const SCROLLER_SELECTOR = '.thread-scroll-container';
  const UNIT_SELECTOR = '[data-content-search-unit-key]';
  const BUBBLE_SELECTOR = '[data-user-message-bubble]';
  const ATTACHMENT_SELECTOR = '[aria-label="用户附件"], [aria-label="User attachment"], ' +
    '[aria-label="应用程序截图附件"], [aria-label="Appshot attachment"]';
  const FILE_PILL_SELECTOR = '[data-composer-attachment-pill]';
  const PIN_PX = 0.5;
  const RELEASE_PX = 8;
  const SWITCH_MS = 220;
  const ZOOM_DELAY_MS = 120;
  const ZOOM_LEAVE_MS = 220;
  const VIRTUALIZATION_GRACE_MS = 160;

  const prior = window[GLOBAL_KEY];
  if (prior?.version === VERSION && prior.active) return;
  prior?.destroy?.();

  const style = document.createElement('style');
  style.id = 'codex-sticky-prompt-style';
  style.textContent = `
    #codex-sticky-prompt-host {
      position: fixed;
      z-index: 35;
      box-sizing: border-box;
      pointer-events: none;
      display: none;
      padding: 0;
      justify-content: flex-start;
    }
    #codex-sticky-prompt-host[data-visible="true"] { display: flex; }
    .thread-scroll-container.codex-sticky-prompt-masked {
      -webkit-mask-image: linear-gradient(to bottom, transparent 0px,
        transparent var(--codex-sticky-mask-clear), black var(--codex-sticky-mask-full));
      mask-image: linear-gradient(to bottom, transparent 0px,
        transparent var(--codex-sticky-mask-clear), black var(--codex-sticky-mask-full));
    }
    #codex-sticky-prompt-toggle {
      -webkit-app-region: no-drag;
    }
    #codex-sticky-prompt-toggle[data-unavailable="true"]::after {
      content: '';
      position: absolute;
      top: 3px;
      right: 3px;
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: #d97706;
    }
    #codex-sticky-prompt-button {
      position: relative;
      box-sizing: border-box;
      width: 100%;
      max-width: 748px;
      border: 0;
      border-radius: 16px;
      padding: 7px 12px;
      font: inherit;
      font-size: 13px;
      line-height: 20px;
      text-align: left;
      color: var(--codex-sticky-text);
      background: var(--codex-sticky-bubble);
      cursor: pointer;
      pointer-events: auto;
    }
    #codex-sticky-prompt-button:focus-visible {
      outline: 2px solid currentColor;
      outline-offset: 2px;
    }
    #codex-sticky-prompt-visual,
    .codex-sticky-prompt-outgoing {
      display: flex;
      align-items: center;
      gap: 8px;
      min-width: 0;
    }
    #codex-sticky-prompt-preview,
    .codex-sticky-prompt-outgoing img {
      width: 24px;
      height: 24px;
      flex: none;
      border-radius: 5px;
      object-fit: cover;
    }
    #codex-sticky-prompt-preview[hidden] { display: none; }
    #codex-sticky-prompt-text,
    .codex-sticky-prompt-outgoing .codex-sticky-prompt-label {
      display: -webkit-box;
      flex: 1;
      min-width: 0;
      overflow: hidden;
      overflow-wrap: anywhere;
      white-space: normal;
      -webkit-box-orient: vertical;
      -webkit-line-clamp: 2;
    }
    .codex-sticky-prompt-outgoing {
      position: absolute;
      top: 7px;
      right: 12px;
      left: 12px;
      pointer-events: none;
    }
    #codex-sticky-prompt-zoom {
      position: fixed;
      z-index: 36;
      box-sizing: border-box;
      pointer-events: none;
      visibility: hidden;
      opacity: 0;
      transform: translateY(-5px);
      transition: opacity 160ms ease, transform 160ms ease, visibility 160ms;
      padding: 6px;
      border: 1px solid var(--color-token-border-default, rgba(0, 0, 0, .12));
      border-radius: 12px;
      background: var(--color-surface-elevated, #fff);
      box-shadow: 0 12px 32px rgba(0, 0, 0, .2);
    }
    #codex-sticky-prompt-zoom[data-visible="true"] {
      visibility: visible;
      opacity: 1;
      transform: translateY(0);
      pointer-events: auto;
    }
    #codex-sticky-prompt-zoom img {
      display: block;
      object-fit: contain;
      border-radius: 6px;
    }
    #codex-sticky-prompt-zoom-nav {
      position: absolute;
      inset: 6px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      pointer-events: none;
    }
    #codex-sticky-prompt-zoom-nav[hidden] { display: none; }
    .codex-sticky-prompt-zoom-arrow {
      display: grid;
      place-items: center;
      width: 32px;
      height: 32px;
      padding: 0;
      border: 0;
      border-radius: 50%;
      color: #fff;
      background: rgba(0, 0, 0, .68);
      cursor: pointer;
      pointer-events: auto;
    }
    .codex-sticky-prompt-zoom-arrow:hover:not(:disabled) { background: rgba(0, 0, 0, .82); }
    .codex-sticky-prompt-zoom-arrow:disabled { opacity: .35; cursor: default; }
    .codex-sticky-prompt-zoom-arrow:focus-visible { outline: 2px solid #fff; outline-offset: 2px; }
    #codex-sticky-prompt-zoom-count {
      position: absolute;
      bottom: 8px;
      left: 50%;
      transform: translateX(-50%);
      padding: 3px 9px;
      border-radius: 999px;
      color: #fff;
      background: rgba(0, 0, 0, .68);
      font: 12px/18px system-ui, sans-serif;
      white-space: nowrap;
    }
    @media (prefers-reduced-motion: reduce) {
      #codex-sticky-prompt-zoom { transition: none; transform: none; }
    }
  `;
  document.head.append(style);

  const host = document.createElement('div');
  host.id = 'codex-sticky-prompt-host';
  host.setAttribute('aria-label', '当前提问');
  const button = document.createElement('button');
  button.id = 'codex-sticky-prompt-button';
  button.type = 'button';
  button.title = '点击返回原提问';
  const visual = document.createElement('span');
  visual.id = 'codex-sticky-prompt-visual';
  const preview = document.createElement('img');
  preview.id = 'codex-sticky-prompt-preview';
  preview.alt = '';
  preview.setAttribute('aria-hidden', 'true');
  preview.hidden = true;
  preview.addEventListener('error', () => { preview.hidden = true; schedule(); });
  const label = document.createElement('span');
  label.id = 'codex-sticky-prompt-text';
  label.className = 'codex-sticky-prompt-label';
  visual.append(preview, label);
  button.append(visual);
  host.append(button);
  document.body.append(host);

  const zoom = document.createElement('div');
  zoom.id = 'codex-sticky-prompt-zoom';
  zoom.setAttribute('aria-hidden', 'true');
  const zoomImage = document.createElement('img');
  zoomImage.alt = '';
  const zoomNav = document.createElement('div');
  zoomNav.id = 'codex-sticky-prompt-zoom-nav';
  zoomNav.hidden = true;
  const previousImage = document.createElement('button');
  previousImage.type = 'button';
  previousImage.className = 'codex-sticky-prompt-zoom-arrow';
  previousImage.setAttribute('aria-label', '上一张图片');
  previousImage.innerHTML = '<svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true"><path d="m11 4-5 5 5 5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const nextImage = document.createElement('button');
  nextImage.type = 'button';
  nextImage.className = 'codex-sticky-prompt-zoom-arrow';
  nextImage.setAttribute('aria-label', '下一张图片');
  nextImage.innerHTML = '<svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true"><path d="m7 4 5 5-5 5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const zoomCount = document.createElement('span');
  zoomCount.id = 'codex-sticky-prompt-zoom-count';
  zoomNav.append(previousImage, zoomCount, nextImage);
  zoom.append(zoomImage, zoomNav);
  zoom.inert = true;
  document.body.append(zoom);

  const toggle = document.createElement('button');
  toggle.id = 'codex-sticky-prompt-toggle';
  toggle.className = 'no-drag cursor-interaction';
  toggle.type = 'button';
  toggle.innerHTML = `<svg width="21" height="21" viewBox="0 0 21 21" fill="none"
      xmlns="http://www.w3.org/2000/svg" class="icon-sm" aria-hidden="true">
      <path data-pin-head d="M7 3.75h7l-.9 4.15 2.2 2.2v1.15H5.7V10.1l2.2-2.2L7 3.75Z"
        stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>
      <path d="M10.5 11.25v6" stroke="currentColor" stroke-width="1.4"
        stroke-linecap="round"/>
    </svg>`;
  const pinHead = toggle.querySelector('[data-pin-head]');

  let enabled = true;
  try { enabled = localStorage.getItem(STORAGE_KEY) !== 'false'; } catch { /* unavailable storage */ }

  let scroller = null;
  let currentKey = null;
  let currentUnit = null;
  let frame = 0;
  let active = true;
  let resizeObserver = null;
  let switchAnimations = [];
  let outgoingLabel = null;
  let switchToken = 0;
  let lastScrollTop = null;
  let scrollDirection = 1;
  let rowCandidates = null;
  let textCache = new WeakMap();
  let emptyRowsSince = null;
  let emptyRowsTimer = 0;
  let toolbarAction = null;
  let unavailableSince = null;
  let unavailableTimer = 0;
  let unavailable = false;
  let maskHeight = null;
  let imageSources = [];
  let sourceImages = [];
  let currentImageIndex = 0;
  let previewSrc = null;
  let zoomTimer = 0;
  let zoomCloseTimer = 0;

  function hideZoom() {
    clearTimeout(zoomTimer);
    clearTimeout(zoomCloseTimer);
    zoomTimer = 0;
    zoomCloseTimer = 0;
    if (zoom.contains(document.activeElement)) document.activeElement.blur();
    zoom.removeAttribute('data-visible');
    zoom.setAttribute('aria-hidden', 'true');
    zoom.inert = true;
  }

  function scheduleHideZoom() {
    clearTimeout(zoomTimer);
    clearTimeout(zoomCloseTimer);
    zoomTimer = 0;
    zoomCloseTimer = setTimeout(hideZoom, ZOOM_LEAVE_MS);
  }

  function updateZoomNavigation() {
    zoomNav.hidden = imageSources.length < 2;
    zoomCount.textContent = `${currentImageIndex + 1} / ${imageSources.length}`;
    previousImage.disabled = currentImageIndex === 0;
    nextImage.disabled = currentImageIndex >= imageSources.length - 1;
  }

  function selectImage(index) {
    if (index < 0 || index >= imageSources.length) return;
    currentImageIndex = index;
    previewSrc = imageSources[index];
    preview.src = previewSrc;
    preview.hidden = false;
    zoomImage.src = previewSrc;
    updateZoomNavigation();
    if (zoom.hasAttribute('data-visible')) positionZoom();
  }

  function positionZoom() {
    const thumb = preview.getBoundingClientRect();
    const margin = 12;
    const frame = 14;
    const gap = 10;
    const maxWidth = Math.max(1, Math.min(585, window.innerWidth - margin * 2 - frame));
    const below = thumb.bottom + gap;
    const above = thumb.top - gap;
    const belowSpace = Math.max(0, window.innerHeight - margin - below - frame);
    const aboveSpace = Math.max(0, above - margin - frame);
    const original = sourceImages[currentImageIndex];
    const dimensions = [original, zoomImage, preview]
      .find((image) => image?.naturalWidth > 0 && image?.naturalHeight > 0);
    const naturalWidth = dimensions?.naturalWidth ?? 585;
    const naturalHeight = dimensions?.naturalHeight ?? 429;
    const desiredHeight = Math.min(429, maxWidth * naturalHeight / naturalWidth);
    const placeBelow = belowSpace >= desiredHeight || belowSpace >= aboveSpace;
    const maxHeight = Math.max(1, Math.min(429, placeBelow ? belowSpace : aboveSpace));
    const scale = Math.min(maxWidth / naturalWidth, maxHeight / naturalHeight);
    const width = naturalWidth * scale;
    const height = naturalHeight * scale;
    const popupWidth = width + frame;
    const popupHeight = height + frame;
    const left = Math.max(margin, Math.min(thumb.left, window.innerWidth - popupWidth - margin));
    const wantedTop = placeBelow ? below : above - popupHeight;
    const top = Math.max(margin, Math.min(wantedTop, window.innerHeight - popupHeight - margin));
    zoom.style.left = `${left}px`;
    zoom.style.top = `${top}px`;
    zoomImage.style.width = `${width}px`;
    zoomImage.style.height = `${height}px`;
  }

  function showZoom() {
    zoomTimer = 0;
    if (!enabled || !host.hasAttribute('data-visible') || preview.hidden || !previewSrc) return;
    if (zoomImage.getAttribute('src') !== previewSrc) zoomImage.src = previewSrc;
    positionZoom();
    zoom.removeAttribute('aria-hidden');
    zoom.inert = false;
    zoom.setAttribute('data-visible', 'true');
  }

  function onZoomImageLoad() {
    if (zoom.hasAttribute('data-visible')) positionZoom();
  }

  function onPreviewEnter() {
    if (preview.hidden || !previewSrc) return;
    button.removeAttribute('title');
    clearTimeout(zoomTimer);
    clearTimeout(zoomCloseTimer);
    zoomCloseTimer = 0;
    zoomTimer = setTimeout(showZoom, ZOOM_DELAY_MS);
  }

  function onPreviewLeave() {
    button.title = '点击返回原提问';
    if (zoom.hasAttribute('data-visible')) scheduleHideZoom();
    else hideZoom();
  }

  function onZoomEnter() {
    clearTimeout(zoomCloseTimer);
    zoomCloseTimer = 0;
  }

  function onZoomLeave() {
    scheduleHideZoom();
  }

  function updateToggle() {
    toggle.setAttribute('aria-pressed', String(enabled));
    toggle.setAttribute('aria-label', unavailable ? '提问吸顶暂不可用：未找到聊天滚动区' :
      enabled ? '提问吸顶已开启，点击关闭' : '提问吸顶已关闭，点击开启');
    toggle.title = unavailable ? '未找到聊天滚动区，Codex 界面可能已更新' :
      enabled ? '关闭提问吸顶' : '开启提问吸顶';
    toggle.toggleAttribute('data-unavailable', unavailable);
    pinHead.setAttribute('fill', enabled ? 'currentColor' : 'none');
  }

  function ensureToggle() {
    const action = (toolbarAction?.isConnected ? toolbarAction : null) ??
      document.querySelector('button[aria-label="聊天操作"]') ??
      [...document.querySelectorAll('button.button-toolbar[aria-haspopup="menu"]')]
        .find((candidate) => candidate.parentElement?.classList.contains('ms-auto'));
    toolbarAction = action ?? null;
    if (!action?.parentElement) {
      toggle.remove();
      return;
    }
    toggle.className = action.className;
    toggle.classList.add('no-drag');
    if (enabled) {
      toggle.classList.remove('text-tertiary',
        'not-disabled:not-aria-disabled:hover:bg-primary-ghost-hover',
        'data-[state=open]:bg-primary-ghost-hover');
      toggle.classList.add('text-default', 'bg-text/5',
        'not-disabled:not-aria-disabled:hover:bg-text/10',
        'data-[state=open]:bg-text/10');
    }
    if (toggle.parentElement !== action.parentElement || toggle.nextElementSibling !== action) {
      action.parentElement.insertBefore(toggle, action);
    }
  }

  updateToggle();

  function schedule() {
    if (!active || frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      refresh();
    });
  }

  function getScroller() {
    if (scroller?.isConnected) {
      const rect = scroller.getBoundingClientRect();
      if (rect.width > 100 && rect.height > 100) return scroller;
    }
    const matches = [...document.querySelectorAll(SCROLLER_SELECTOR)];
    return matches.find((element) => {
      const rect = element.getBoundingClientRect();
      return rect.width > 100 && rect.height > 100;
    }) ?? null;
  }

  function collectRows(container) {
    if (!rowCandidates) {
      rowCandidates = [];
      for (const unit of container.querySelectorAll(UNIT_SELECTOR)) {
        const bubble = unit.querySelector(BUBBLE_SELECTOR);
        const attachment = unit.querySelector(ATTACHMENT_SELECTOR);
        const filePill = unit.querySelector(FILE_PILL_SELECTOR);
        if (bubble?.closest(UNIT_SELECTOR) !== unit && attachment?.closest(UNIT_SELECTOR) !== unit &&
            filePill?.closest(UNIT_SELECTOR) !== unit) continue;
        let content = bubble ?? attachment ?? filePill;
        while (content.parentElement && content.parentElement !== unit) content = content.parentElement;
        rowCandidates.push({ unit, bubble, content });
      }
    }
    const rows = [];
    for (const { unit, bubble, content } of rowCandidates) {
      if (!content.isConnected) continue;
      const rect = content.getBoundingClientRect();
      if (!rect.width || !rect.height) continue;
      rows.push({
        key: unit.getAttribute('data-content-search-unit-key'),
        unit,
        bubble,
        content,
        top: rect.top,
      });
    }
    rows.sort((a, b) => a.top - b.top);
    return rows;
  }

  // Ported from dsh-oil-sticky-prompt's pickPinnedRow, using Codex's DOM markers.
  function pickPinnedRow(rows, viewportTop, selectedKey) {
    let lastPast = null;
    let lastPastIndex = -1;
    for (let index = 0; index < rows.length; index += 1) {
      if (rows[index].top <= viewportTop + PIN_PX) {
        lastPast = rows[index];
        lastPastIndex = index;
      }
    }
    if (selectedKey !== null) {
      const currentIndex = rows.findIndex((row) => row.key === selectedKey);
      const current = rows[currentIndex];
      if (lastPastIndex > currentIndex) return lastPast;
      if (current && current.top <= viewportTop + RELEASE_PX) return current;
    }
    return lastPast;
  }

  function promptText(bubble) {
    if (!bubble) return '';
    if (textCache.has(bubble)) return textCache.get(bubble);
    const copy = bubble.cloneNode(true);
    for (const element of copy.querySelectorAll('button, svg, [aria-hidden="true"], .sr-only, textarea, input')) {
      element.remove();
    }
    const text = (copy.textContent ?? '').replace(/\s+/g, ' ').trim();
    textCache.set(bubble, text);
    return text;
  }

  function promptSummary(row) {
    const counts = { image: 0, video: 0, audio: 0, file: 0 };
    const images = [];
    const imageElements = [];
    const addImage = (image) => {
      const src = image?.currentSrc || image?.src;
      if (src) {
        images.push(src);
        imageElements.push(image);
      }
    };
    let firstFileName = '';
    const attachments = [
      ...(row.content.matches(ATTACHMENT_SELECTOR) ? [row.content] : []),
      ...row.content.querySelectorAll(ATTACHMENT_SELECTOR),
    ]
      .filter((item) => item.closest(UNIT_SELECTOR) === row.unit && !item.closest(BUBBLE_SELECTOR));
    for (const item of attachments) {
      if (item.querySelector('video')) counts.video += 1;
      else if (item.querySelector('audio')) counts.audio += 1;
      else {
        counts.image += 1;
        addImage(item.querySelector('img'));
      }
    }
    const filePills = [
      ...(row.content.matches(FILE_PILL_SELECTOR) ? [row.content] : []),
      ...row.content.querySelectorAll(FILE_PILL_SELECTOR),
    ].filter((item) => item.closest(UNIT_SELECTOR) === row.unit &&
      !item.closest(BUBBLE_SELECTOR) && !item.closest(ATTACHMENT_SELECTOR));
    for (const item of filePills) {
      const image = item.querySelector('img');
      if (image) {
        counts.image += 1;
        addImage(image);
      } else {
        counts.file += 1;
        if (!firstFileName) {
          const raw = item.querySelector('.truncate')?.textContent?.trim() ?? '';
          const name = raw.replace(/\s+/g, ' ').split(/[\\/]/).pop();
          firstFileName = name.length > 64 ? `${name.slice(0, 32)}…${name.slice(-28)}` : name;
        }
      }
    }
    if (row.bubble) {
      const inlineImages = row.bubble.querySelectorAll('img');
      counts.image += inlineImages.length;
      for (const image of inlineImages) addImage(image);
      counts.video += row.bubble.querySelectorAll('video').length;
      counts.audio += row.bubble.querySelectorAll('audio').length;
    }
    const parts = [];
    for (const [kind, label] of [['image', '图片'], ['video', '视频'], ['audio', '音频'], ['file', '文件']]) {
      if (counts[kind]) {
        const count = counts[kind] > 1 ? ` ×${counts[kind]}` : kind === 'file' && firstFileName ? '' : ' ×1';
        parts.push(kind === 'file' && firstFileName ? `${label}${count}：${firstFileName}` : `${label}${count}`);
      }
    }
    const text = promptText(row.bubble);
    const hasMedia = Object.values(counts).some((count) => count > 0);
    if (text && !(hasMedia && /^(?:（无内容）|\(No content\))$/.test(text))) parts.push(text);
    return { text: parts.join(' · '), images, imageElements };
  }

  function updateCompatibility() {
    const suspect = enabled && toolbarAction?.isConnected && !scroller;
    if (suspect && unavailableSince === null) {
      unavailableSince = performance.now();
      unavailableTimer = setTimeout(schedule, 5000);
    } else if (!suspect) {
      unavailableSince = null;
      clearTimeout(unavailableTimer);
      unavailableTimer = 0;
    }
    const nextUnavailable = suspect && performance.now() - unavailableSince >= 5000;
    if (unavailable !== nextUnavailable) {
      unavailable = nextUnavailable;
      updateToggle();
    }
  }

  function stopSwitchAnimation() {
    switchToken += 1;
    for (const animation of switchAnimations) animation.cancel();
    switchAnimations = [];
    outgoingLabel?.remove();
    outgoingLabel = null;
    button.style.overflow = '';
  }

  function setPromptContent(text, images, imageElements, promptKey, animateSwitch, direction) {
    const sameImages = imageSources.length === images.length &&
      imageSources.every((src, index) => src === images[index]);
    sourceImages = imageElements;
    if (label.textContent === text && sameImages && currentKey === promptKey) return;
    const restoreZoom = zoom.hasAttribute('data-visible');
    hideZoom();
    const canAnimate = animateSwitch && typeof visual.animate === 'function' &&
      !matchMedia('(prefers-reduced-motion: reduce)').matches;
    const oldHeight = canAnimate ? button.getBoundingClientRect().height : 0;
    stopSwitchAnimation();
    if (canAnimate) {
      const outgoing = visual.cloneNode(true);
      outgoing.removeAttribute('id');
      outgoing.querySelector('#codex-sticky-prompt-preview')?.removeAttribute('id');
      outgoing.querySelector('#codex-sticky-prompt-text')?.removeAttribute('id');
      outgoing.className = 'codex-sticky-prompt-outgoing';
      outgoing.setAttribute('aria-hidden', 'true');
      button.append(outgoing);
      outgoingLabel = outgoing;
    }
    label.textContent = text;
    if (!sameImages || currentKey !== promptKey) currentImageIndex = 0;
    imageSources = images;
    previewSrc = imageSources[currentImageIndex] ?? null;
    updateZoomNavigation();
    if (previewSrc) {
      if (preview.getAttribute('src') !== previewSrc) preview.src = previewSrc;
      preview.hidden = false;
    } else {
      preview.hidden = true;
      preview.removeAttribute('src');
      button.title = '点击返回原提问';
    }
    if (restoreZoom && previewSrc) zoomTimer = setTimeout(showZoom, ZOOM_DELAY_MS);
    if (!canAnimate) return;
    const newHeight = button.getBoundingClientRect().height;
    button.style.overflow = 'hidden';
    const options = { duration: SWITCH_MS, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' };
    const enterOffset = direction < 0 ? -6 : 6;
    switchAnimations = [
      outgoingLabel.animate([
        { opacity: 1, transform: 'translateY(0)' },
        { opacity: 0, transform: `translateY(${-enterOffset}px)` },
      ], options),
      visual.animate([
        { opacity: 0, transform: `translateY(${enterOffset}px)` },
        { opacity: 1, transform: 'translateY(0)' },
      ], options),
    ];
    if (Math.abs(newHeight - oldHeight) > 0.5) {
      switchAnimations.push(button.animate([
        { height: `${oldHeight}px` },
        { height: `${newHeight}px` },
      ], options));
    }
    const token = switchToken;
    Promise.allSettled(switchAnimations.map((animation) => animation.finished)).then(() => {
      if (token === switchToken) {
        stopSwitchAnimation();
        schedule();
      }
    });
  }

  function clearScrollerMask(container = scroller) {
    if (!container) return;
    maskHeight = null;
    container.classList.remove('codex-sticky-prompt-masked');
    container.style.removeProperty('--codex-sticky-mask-clear');
    container.style.removeProperty('--codex-sticky-mask-full');
  }

  function syncScrollerMask() {
    const height = button.getBoundingClientRect().height;
    if (maskHeight === height && scroller.classList.contains('codex-sticky-prompt-masked')) return;
    maskHeight = height;
    scroller.style.setProperty('--codex-sticky-mask-clear', `${height + 4}px`);
    scroller.style.setProperty('--codex-sticky-mask-full', `${height + 20}px`);
    scroller.classList.add('codex-sticky-prompt-masked');
  }

  function hide() {
    hideZoom();
    button.title = '点击返回原提问';
    stopSwitchAnimation();
    clearScrollerMask();
    host.removeAttribute('data-visible');
    currentKey = null;
    currentUnit = null;
    label.textContent = '';
    preview.hidden = true;
    preview.removeAttribute('src');
    imageSources = [];
    sourceImages = [];
    currentImageIndex = 0;
    previewSrc = null;
    updateZoomNavigation();
    emptyRowsSince = null;
    clearTimeout(emptyRowsTimer);
    emptyRowsTimer = 0;
  }

  function refresh() {
    ensureToggle();
    if (!enabled) {
      updateCompatibility();
      hide();
      return;
    }
    const nextScroller = getScroller();
    if (nextScroller !== scroller) {
      clearScrollerMask();
      resizeObserver?.disconnect();
      scroller = nextScroller;
      rowCandidates = null;
      currentKey = null;
      currentUnit = null;
      lastScrollTop = scroller?.scrollTop ?? null;
      scrollDirection = 1;
      if (scroller && typeof ResizeObserver !== 'undefined') {
        resizeObserver = new ResizeObserver(schedule);
        resizeObserver.observe(scroller);
      }
    }
    updateCompatibility();
    if (!scroller) {
      hide();
      return;
    }

    // In Codex's reversed column, scrollTop rises toward zero while scrolling down.
    const scrollTop = scroller.scrollTop;
    if (lastScrollTop !== null && Math.abs(scrollTop - lastScrollTop) > 0.5) {
      scrollDirection = scrollTop > lastScrollTop ? 1 : -1;
    }
    lastScrollTop = scrollTop;

    const rect = scroller.getBoundingClientRect();

    const rows = collectRows(scroller);
    const chosen = pickPinnedRow(rows, rect.top, currentKey);
    if (!chosen) {
      if (rows.length === 0 && currentKey !== null && host.hasAttribute('data-visible')) {
        if (emptyRowsSince === null) {
          emptyRowsSince = performance.now();
          emptyRowsTimer = setTimeout(schedule, VIRTUALIZATION_GRACE_MS);
        }
        if (performance.now() - emptyRowsSince < VIRTUALIZATION_GRACE_MS) return;
      }
      hide();
      return;
    }
    emptyRowsSince = null;
    clearTimeout(emptyRowsTimer);
    emptyRowsTimer = 0;
    const { text, images, imageElements } = promptSummary(chosen);
    if (!text) {
      hide();
      return;
    }

    const animateSwitch = currentKey !== null && currentKey !== chosen.key &&
      host.hasAttribute('data-visible');
    // The user bubble's full-width row shares its left edge with the reply's duration label.
    const contentRect = (chosen.bubble?.parentElement ?? chosen.content).getBoundingClientRect();
    const contentFits = contentRect && contentRect.width > 0 &&
      contentRect.left >= rect.left && contentRect.right <= rect.right;
    host.style.left = `${contentFits ? contentRect.left : rect.left + 18}px`;
    host.style.top = `${rect.top}px`;
    host.style.width = `${Math.min(748, contentFits ? contentRect.width : rect.width - 36)}px`;
    setPromptContent(text, images, imageElements, chosen.key, animateSwitch, scrollDirection);
    currentKey = chosen.key;
    currentUnit = chosen.unit;
    const styleSource = chosen.bubble ?? scroller.querySelector(BUBBLE_SELECTOR);
    const bubbleStyle = styleSource ? getComputedStyle(styleSource) : null;
    host.style.setProperty('--codex-sticky-bubble', bubbleStyle?.backgroundColor ??
      'var(--color-background-user-message, color-mix(in srgb, currentColor 8%, transparent))');
    host.style.setProperty('--codex-sticky-text', bubbleStyle?.color ??
      'var(--color-text-user-message, inherit)');
    host.setAttribute('data-visible', 'true');
    syncScrollerMask();
    if (zoom.hasAttribute('data-visible')) positionZoom();
    if (switchAnimations.length) schedule();
  }

  function onScroll(event) {
    if (scroller && event.target instanceof Node &&
        (event.target === scroller || scroller.contains(event.target))) schedule();
  }

  function onClick() {
    hideZoom();
    if (!currentUnit?.isConnected) {
      schedule();
      return;
    }
    const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
    currentUnit.scrollIntoView({ block: 'start', behavior: reduceMotion ? 'instant' : 'smooth' });
  }

  function onToggleClick(event) {
    event.stopPropagation();
    enabled = !enabled;
    try { localStorage.setItem(STORAGE_KEY, String(enabled)); } catch { /* session only */ }
    updateToggle();
    ensureToggle();
    if (enabled) schedule();
    else hide();
  }

  function onStorage(event) {
    if (event.key !== STORAGE_KEY) return;
    enabled = event.newValue !== 'false';
    updateToggle();
    ensureToggle();
    if (enabled) schedule();
    else hide();
  }

  const mutationObserver = new MutationObserver((mutations) => {
    let relevant = false;
    const structuralSelector = `${SCROLLER_SELECTOR}, ${UNIT_SELECTOR}, ${BUBBLE_SELECTOR}, ${ATTACHMENT_SELECTOR}, ${FILE_PILL_SELECTOR}, button[aria-label="聊天操作"]`;
    for (const mutation of mutations) {
      const target = mutation.target.nodeType === Node.ELEMENT_NODE ? mutation.target : mutation.target.parentElement;
      if (target === host || host.contains(target) || target === toggle || toggle.contains(target)) continue;
      if (mutation.type === 'attributes') {
        rowCandidates = null;
        relevant = true;
        continue;
      }
      const bubble = target?.closest?.(BUBBLE_SELECTOR);
      if (bubble) {
        textCache.delete(bubble);
        relevant = true;
        continue;
      }
      if (target?.closest?.(ATTACHMENT_SELECTOR)) {
        relevant = true;
        continue;
      }
      if (target?.closest?.(FILE_PILL_SELECTOR)) {
        relevant = true;
        continue;
      }
      if (mutation.type !== 'childList') continue;
      const changed = [...mutation.addedNodes, ...mutation.removedNodes].some((node) =>
        node.nodeType === Node.ELEMENT_NODE &&
        (node.matches(structuralSelector) || node.querySelector(structuralSelector)));
      if (changed) {
        rowCandidates = null;
        relevant = true;
      }
    }
    if (relevant) schedule();
  });
  mutationObserver.observe(document.body, {
    subtree: true, childList: true, characterData: true, attributes: true,
    attributeFilter: ['data-user-message-bubble', 'data-content-search-unit-key', 'data-composer-attachment-pill'],
  });
  document.addEventListener('scroll', onScroll, { capture: true, passive: true });
  window.addEventListener('resize', schedule);
  window.addEventListener('storage', onStorage);
  button.addEventListener('click', onClick);
  preview.addEventListener('mouseenter', onPreviewEnter);
  preview.addEventListener('mouseleave', onPreviewLeave);
  zoom.addEventListener('mouseenter', onZoomEnter);
  zoom.addEventListener('mouseleave', onZoomLeave);
  previousImage.addEventListener('click', () => selectImage(currentImageIndex - 1));
  nextImage.addEventListener('click', () => selectImage(currentImageIndex + 1));
  zoomImage.addEventListener('load', onZoomImageLoad);
  zoomImage.addEventListener('error', hideZoom);
  toggle.addEventListener('click', onToggleClick);
  schedule();

  window[GLOBAL_KEY] = {
    version: VERSION,
    get active() { return active; },
    get unavailable() { return unavailable; },
    destroy() {
      if (!active) return;
      active = false;
      stopSwitchAnimation();
      clearScrollerMask();
      if (frame) cancelAnimationFrame(frame);
      clearTimeout(emptyRowsTimer);
      clearTimeout(unavailableTimer);
      hideZoom();
      mutationObserver.disconnect();
      resizeObserver?.disconnect();
      document.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', schedule);
      window.removeEventListener('storage', onStorage);
      button.removeEventListener('click', onClick);
      preview.removeEventListener('mouseenter', onPreviewEnter);
      preview.removeEventListener('mouseleave', onPreviewLeave);
      zoom.removeEventListener('mouseenter', onZoomEnter);
      zoom.removeEventListener('mouseleave', onZoomLeave);
      zoomImage.removeEventListener('load', onZoomImageLoad);
      zoomImage.removeEventListener('error', hideZoom);
      toggle.removeEventListener('click', onToggleClick);
      toggle.remove();
      host.remove();
      zoom.remove();
      style.remove();
      delete window[GLOBAL_KEY];
    },
  };
})();
