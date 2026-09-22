import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import { JSDOM } from 'jsdom';

const source = await fs.readFile(new URL('../sticky.js', import.meta.url), 'utf8');

function createFixture({ animate = false, reduceMotion = false } = {}) {
  const dom = new JSDOM(`<!doctype html><html><head></head><body>
    <div class="sidebar-item"><div role="presentation"><button aria-label="聊天操作">Sidebar menu</button></div></div>
    <div class="ms-auto"><button class="button-toolbar text-tertiary aspect-square not-disabled:not-aria-disabled:hover:bg-primary-ghost-hover" aria-label="聊天操作">Menu</button></div>
    <div class="thread-scroll-container">
      <div data-content-search-unit-key="first"><div data-user-message-bubble>First question\nwith detail</div></div>
      <div data-content-search-unit-key="second"><div data-user-message-bubble>Second question</div></div>
    </div>
  </body></html>`, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://codex.test/' });
  const { window } = dom;
  const scroller = window.document.querySelector('.thread-scroll-container');
  scroller.scrollTop = -100;
  const first = window.document.querySelector('[data-content-search-unit-key="first"]');
  const second = window.document.querySelector('[data-content-search-unit-key="second"]');
  const tops = { first: 130, second: 350 };
  scroller.getBoundingClientRect = () => ({ top: 100, left: 50, right: 850, width: 800, height: 600 });
  first.querySelector('[data-user-message-bubble]').getBoundingClientRect = () => ({
    top: tops.first, left: 300, width: 450, height: 50,
  });
  first.querySelector('[data-user-message-bubble]').parentElement.getBoundingClientRect = () => ({
    left: 100, right: 700, width: 600,
  });
  second.querySelector('[data-user-message-bubble]').getBoundingClientRect = () => ({
    top: tops.second, left: 300, width: 450, height: 50,
  });
  second.querySelector('[data-user-message-bubble]').parentElement.getBoundingClientRect = () => ({
    left: 100, right: 700, width: 600,
  });
  window.matchMedia = () => ({ matches: reduceMotion });
  const animationCalls = [];
  if (animate) {
    window.HTMLElement.prototype.animate = function (keyframes, options) {
      animationCalls.push({ element: this, keyframes, options });
      return { cancel() {}, finished: new Promise((resolve) => setTimeout(resolve, 100)) };
    };
  }
  let jumpedTo = null;
  first.scrollIntoView = () => { jumpedTo = 'first'; };
  second.scrollIntoView = () => { jumpedTo = 'second'; };
  window.eval(source);
  return { window, scroller, tops, animationCalls, get jumpedTo() { return jumpedTo; } };
}

async function nextFrame() {
  await new Promise((resolve) => setTimeout(resolve, 35));
}

test('pins the nearest preceding prompt, switches, and jumps back', async () => {
  const fixture = createFixture();
  const { window, scroller, tops } = fixture;
  try {
    await nextFrame();
    const host = window.document.querySelector('#codex-sticky-prompt-host');
    const label = window.document.querySelector('#codex-sticky-prompt-text');
    assert.equal(host.hasAttribute('data-visible'), false);

    tops.first = 70;
    scroller.dispatchEvent(new window.Event('scroll'));
    await nextFrame();
    assert.equal(host.getAttribute('data-visible'), 'true');
    assert.equal(scroller.classList.contains('codex-sticky-prompt-masked'), true);
    assert.equal(label.textContent, 'First question with detail');
    assert.equal(host.style.left, '100px');
    assert.equal(host.style.width, '600px');

    tops.second = 75;
    scroller.dispatchEvent(new window.Event('scroll'));
    await nextFrame();
    assert.equal(label.textContent, 'Second question');
    window.document.querySelector('#codex-sticky-prompt-button').click();
    assert.equal(fixture.jumpedTo, 'second');

    tops.second = 120;
    scroller.dispatchEvent(new window.Event('scroll'));
    await nextFrame();
    assert.equal(label.textContent, 'First question with detail');

    tops.first = 120;
    scroller.dispatchEvent(new window.Event('scroll'));
    await nextFrame();
    assert.equal(host.hasAttribute('data-visible'), false);
    assert.equal(scroller.classList.contains('codex-sticky-prompt-masked'), false);
  } finally {
    window.__codexStickyPrompt?.destroy();
    window.close();
  }
});

test('places the toggle beside the chat toolbar action, not the sidebar action', async () => {
  const { window } = createFixture();
  try {
    await nextFrame();
    const toggle = window.document.querySelector('#codex-sticky-prompt-toggle');
    const toolbarAction = window.document.querySelector('.ms-auto > button[aria-label="聊天操作"]');
    assert.equal(toggle.parentElement, toolbarAction.parentElement);
    assert.equal(toggle.nextElementSibling, toolbarAction);
    assert.equal(toggle.classList.contains('button-toolbar'), true);
  } finally {
    window.__codexStickyPrompt?.destroy();
    window.close();
  }
});

test('realigns a pinned prompt when the view moves without a scroll event', async () => {
  const { window, scroller, tops } = createFixture();
  try {
    tops.first = 70;
    scroller.dispatchEvent(new window.Event('scroll'));
    await nextFrame();
    const host = window.document.querySelector('#codex-sticky-prompt-host');
    assert.equal(host.style.left, '100px');
    assert.equal(host.style.top, '100px');
    const anchor = window.document.querySelector('[data-content-search-unit-key="first"] [data-user-message-bubble]').parentElement;
    anchor.getBoundingClientRect = () => ({ left: 200, right: 700, width: 500, top: 70 });
    scroller.getBoundingClientRect = () => ({ top: 120, left: 50, right: 850, width: 800, height: 600 });
    await new Promise((resolve) => setTimeout(resolve, 180));
    assert.equal(host.style.left, '200px');
    assert.equal(host.style.top, '120px');
    assert.equal(host.style.width, '500px');
  } finally {
    window.__codexStickyPrompt?.destroy();
    window.close();
  }
});

test('reacts to changed messages and cleans up fully', async () => {
  const fixture = createFixture();
  const { window, scroller, tops } = fixture;
  try {
    tops.first = 70;
    scroller.dispatchEvent(new window.Event('scroll'));
    await nextFrame();
    const firstBubble = window.document.querySelector('[data-content-search-unit-key="first"] [data-user-message-bubble]');
    let clones = 0;
    const cloneNode = firstBubble.cloneNode.bind(firstBubble);
    firstBubble.cloneNode = (...args) => { clones += 1; return cloneNode(...args); };
    scroller.dispatchEvent(new window.Event('scroll'));
    await nextFrame();
    assert.equal(clones, 0, 'scrolling an unchanged prompt uses the cached text');
    firstBubble.textContent = 'Edited question';
    await nextFrame();
    assert.equal(window.document.querySelector('#codex-sticky-prompt-text').textContent, 'Edited question');
    assert.equal(clones, 1, 'editing invalidates the cached text');
    firstBubble.removeAttribute('data-user-message-bubble');
    await nextFrame();
    assert.equal(window.document.querySelector('#codex-sticky-prompt-host').hasAttribute('data-visible'), false);
    firstBubble.setAttribute('data-user-message-bubble', '');
    await nextFrame();
    assert.equal(window.document.querySelector('#codex-sticky-prompt-text').textContent, 'Edited question');
    window.__codexStickyPrompt.destroy();
    assert.equal(window.document.querySelector('#codex-sticky-prompt-host'), null);
    assert.equal(window.document.querySelector('#codex-sticky-prompt-style'), null);
  } finally {
    window.close();
  }
});

test('keeps the prompt during a brief virtualized row replacement', async () => {
  const fixture = createFixture();
  const { window, scroller, tops } = fixture;
  try {
    tops.first = 70;
    scroller.dispatchEvent(new window.Event('scroll'));
    await nextFrame();
    const host = window.document.querySelector('#codex-sticky-prompt-host');
    const rows = [...scroller.querySelectorAll('[data-content-search-unit-key]')];
    rows.forEach((row) => row.remove());
    await nextFrame();
    assert.equal(host.getAttribute('data-visible'), 'true');
    scroller.append(...rows);
    await nextFrame();
    assert.equal(host.getAttribute('data-visible'), 'true');
    assert.equal(window.document.querySelector('#codex-sticky-prompt-text').textContent, 'First question with detail');
    rows.forEach((row) => row.remove());
    const deadline = Date.now() + 700;
    while (host.hasAttribute('data-visible') && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.equal(host.hasAttribute('data-visible'), false);
  } finally {
    window.__codexStickyPrompt?.destroy();
    window.close();
  }
});

test('summarizes image and file prompts from the whole user message', async () => {
  const dom = new JSDOM(`<!doctype html><html><head></head><body>
    <div class="ms-auto"><button class="button-toolbar" aria-label="聊天操作">Menu</button></div>
    <div class="thread-scroll-container">
      <div data-content-search-unit-key="image-only"><div class="content">
        <div aria-label="User attachment"><img alt="User attachment" src="https://codex.test/first.png"></div>
        <div aria-label="User attachment"><img alt="User attachment" src="https://codex.test/extra.png"></div>
      </div></div>
      <div data-content-search-unit-key="mixed"><div class="content">
        <div aria-label="用户附件"><img alt="用户附件" src="https://codex.test/second.png"></div>
        <div><div data-user-message-bubble>Explain this image</div></div>
      </div></div>
      <div data-content-search-unit-key="file-only"><div class="content">
        <button data-composer-attachment-pill><span class="truncate">report.pdf</span></button>
      </div></div>
    </div>
  </body></html>`, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://codex.test/' });
  const { window } = dom;
  const scroller = window.document.querySelector('.thread-scroll-container');
  for (const [name, width, height] of [['first', 1200, 600], ['extra', 600, 1200]]) {
    const image = scroller.querySelector(`img[src="https://codex.test/${name}.png"]`);
    Object.defineProperties(image, {
      naturalWidth: { configurable: true, value: width },
      naturalHeight: { configurable: true, value: height },
    });
  }
  const tops = { 'image-only': 70, mixed: 250, 'file-only': 400 };
  scroller.getBoundingClientRect = () => ({ top: 100, left: 50, right: 850, width: 800, height: 600 });
  for (const [key, top] of Object.entries(tops)) {
    const unit = scroller.querySelector(`[data-content-search-unit-key="${key}"]`);
    unit.querySelector('.content').getBoundingClientRect = () => ({
      top: tops[key], left: 100, right: 700, width: 600, height: 100,
    });
  }
  const mixedBubble = scroller.querySelector('[data-content-search-unit-key="mixed"] [data-user-message-bubble]');
  mixedBubble.getBoundingClientRect = () => ({ top: tops.mixed + 85, width: 450, height: 30 });
  window.matchMedia = () => ({ matches: false });
  let jumpedTo = null;
  for (const unit of scroller.querySelectorAll('[data-content-search-unit-key]')) {
    unit.scrollIntoView = () => { jumpedTo = unit.getAttribute('data-content-search-unit-key'); };
  }
  window.eval(source);
  try {
    await nextFrame();
    const label = window.document.querySelector('#codex-sticky-prompt-text');
    const preview = window.document.querySelector('#codex-sticky-prompt-preview');
    const zoom = window.document.querySelector('#codex-sticky-prompt-zoom');
    const zoomNav = window.document.querySelector('#codex-sticky-prompt-zoom-nav');
    const previousImage = zoom.querySelector('[aria-label="上一张图片"]');
    const nextImage = zoom.querySelector('[aria-label="下一张图片"]');
    const zoomCount = window.document.querySelector('#codex-sticky-prompt-zoom-count');
    assert.equal(label.textContent, '图片 ×2');
    assert.equal(preview.hidden, false);
    assert.equal(preview.src, 'https://codex.test/first.png');
    preview.dispatchEvent(new window.Event('mouseenter'));
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.equal(zoom.getAttribute('data-visible'), 'true');
    assert.equal(zoom.querySelector('img').src, 'https://codex.test/first.png');
    assert.equal(zoom.querySelector('img').style.width, '585px');
    assert.equal(zoom.querySelector('img').style.height, '292.5px');
    assert.equal(zoomNav.hidden, false);
    assert.equal(zoomCount.textContent, '1 / 2');
    assert.equal(previousImage.disabled, true);
    preview.dispatchEvent(new window.Event('mouseleave'));
    zoom.dispatchEvent(new window.Event('mouseenter'));
    await new Promise((resolve) => setTimeout(resolve, 240));
    assert.equal(zoom.getAttribute('data-visible'), 'true', 'moving to the enlarged image keeps it open');
    nextImage.click();
    assert.equal(zoomCount.textContent, '2 / 2');
    assert.equal(zoom.querySelector('img').src, 'https://codex.test/extra.png');
    assert.equal(preview.src, 'https://codex.test/extra.png');
    assert.equal(zoom.querySelector('img').style.width, '214.5px');
    assert.equal(zoom.querySelector('img').style.height, '429px');
    assert.equal(nextImage.disabled, true);
    assert.equal(jumpedTo, null, 'image navigation does not jump to the prompt');
    previousImage.click();
    assert.equal(zoomCount.textContent, '1 / 2');
    assert.equal(preview.src, 'https://codex.test/first.png');
    zoom.dispatchEvent(new window.Event('mouseleave'));
    await new Promise((resolve) => setTimeout(resolve, 240));
    assert.equal(zoom.hasAttribute('data-visible'), false);
    preview.dispatchEvent(new window.Event('mouseleave'));
    assert.equal(window.document.querySelector('#codex-sticky-prompt-button').title, '点击返回原提问');
    window.document.querySelector('#codex-sticky-prompt-button').click();
    assert.equal(jumpedTo, 'image-only');
    const placeholder = window.document.createElement('div');
    placeholder.setAttribute('data-user-message-bubble', '');
    placeholder.textContent = '（无内容）';
    scroller.querySelector('[data-content-search-unit-key="image-only"] .content').append(placeholder);
    await nextFrame();
    assert.equal(label.textContent, '图片 ×2');

    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 360 });
    preview.getBoundingClientRect = () => ({ left: 330, top: 100, bottom: 124 });
    preview.dispatchEvent(new window.Event('mouseenter'));
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.equal(zoom.getAttribute('data-visible'), 'true');
    assert.ok(Number.parseFloat(zoom.style.left) >= 12);
    assert.ok(Number.parseFloat(zoom.style.left) +
      Number.parseFloat(zoom.querySelector('img').style.width) + 14 <= window.innerWidth - 12,
    'the enlarged preview stays inside the window');
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 320 });
    window.dispatchEvent(new window.Event('resize'));
    await nextFrame();
    assert.equal(zoom.querySelector('img').style.width, '320px');
    assert.equal(zoom.querySelector('img').style.height, '160px');
    preview.getBoundingClientRect = () => ({ left: 330, top: 280, bottom: 304 });
    window.dispatchEvent(new window.Event('resize'));
    await nextFrame();
    assert.ok(Number.parseFloat(zoom.style.top) +
      Number.parseFloat(zoom.querySelector('img').style.height) + 14 <= 270,
    'the preview moves above the thumbnail when there is more space');
    tops.mixed = 75;
    scroller.dispatchEvent(new window.Event('scroll'));
    await nextFrame();
    assert.equal(label.textContent, '图片 ×1 · Explain this image');
    assert.equal(preview.src, 'https://codex.test/second.png');
    assert.equal(zoomNav.hidden, true);
    assert.equal(zoom.hasAttribute('data-visible'), false);
    await new Promise((resolve) => setTimeout(resolve, 135));
    assert.equal(zoom.querySelector('img').src, 'https://codex.test/second.png');
    assert.equal(zoom.getAttribute('data-visible'), 'true');
    Object.defineProperties(zoom.querySelector('img'), {
      naturalWidth: { configurable: true, value: 800 },
      naturalHeight: { configurable: true, value: 1600 },
    });
    zoom.querySelector('img').dispatchEvent(new window.Event('load'));
    assert.equal(zoom.querySelector('img').style.width, '122px');
    assert.equal(zoom.querySelector('img').style.height, '244px');
    assert.ok(mixedBubble.getBoundingClientRect().top > 100,
      'the attachment reaches the top before the text bubble');

    tops['file-only'] = 75;
    scroller.dispatchEvent(new window.Event('scroll'));
    await nextFrame();
    assert.equal(label.textContent, '文件：report.pdf');
    assert.equal(preview.hidden, true);
    assert.equal(zoom.hasAttribute('data-visible'), false);
    assert.equal(preview.hasAttribute('src'), false);
    window.document.querySelector('#codex-sticky-prompt-button').click();
    assert.equal(jumpedTo, 'file-only');

    const image = window.document.createElement('div');
    image.setAttribute('aria-label', '用户附件');
    image.innerHTML = '<img alt="用户附件" src="https://codex.test/third.png">';
    scroller.querySelector('[data-content-search-unit-key="file-only"] .content').append(image);
    await nextFrame();
    assert.equal(label.textContent, '图片 ×1 · 文件：report.pdf');
    assert.equal(preview.src, 'https://codex.test/third.png');
    preview.dispatchEvent(new window.Event('error'));
    assert.equal(preview.hidden, true, 'a failed thumbnail leaves the text summary visible');
  } finally {
    window.__codexStickyPrompt?.destroy();
    assert.equal(window.document.querySelector('#codex-sticky-prompt-zoom'), null);
    window.close();
  }
});

test('animates prompt switches and honors reduced motion', async () => {
  for (const reduceMotion of [false, true]) {
    const fixture = createFixture({ animate: true, reduceMotion });
    const { window, scroller, tops, animationCalls } = fixture;
    try {
      tops.first = 70;
      scroller.dispatchEvent(new window.Event('scroll'));
      await nextFrame();
      assert.equal(animationCalls.length, 0);

      tops.second = 75;
      scroller.scrollTop = -75;
      scroller.dispatchEvent(new window.Event('scroll'));
      await nextFrame();
      assert.equal(window.document.querySelector('#codex-sticky-prompt-text').textContent, 'Second question');
      assert.equal(animationCalls.length, reduceMotion ? 0 : 2);
      if (!reduceMotion) {
        assert.equal(animationCalls[0].options.duration, 220);
        assert.equal(animationCalls[0].keyframes[1].transform, 'translateY(-6px)');
        assert.equal(animationCalls[1].keyframes[0].transform, 'translateY(6px)');
        assert.equal(window.document.querySelectorAll('.codex-sticky-prompt-outgoing').length, 1);
        tops.second = 120;
        scroller.scrollTop = -100;
        scroller.dispatchEvent(new window.Event('scroll'));
        await nextFrame();
        assert.equal(window.document.querySelector('#codex-sticky-prompt-text').textContent, 'First question with detail');
        assert.equal(animationCalls[2].keyframes[1].transform, 'translateY(6px)');
        assert.equal(animationCalls[3].keyframes[0].transform, 'translateY(-6px)');
        assert.equal(window.document.querySelectorAll('.codex-sticky-prompt-outgoing').length, 1);
      }
    } finally {
      window.__codexStickyPrompt?.destroy();
      window.close();
    }
  }
});

test('clears the prompt when the conversation view changes', async () => {
  const fixture = createFixture();
  const { window, scroller, tops } = fixture;
  try {
    tops.first = 70;
    scroller.dispatchEvent(new window.Event('scroll'));
    await nextFrame();
    assert.equal(window.document.querySelector('#codex-sticky-prompt-text').textContent, 'First question with detail');
    scroller.remove();
    await nextFrame();
    assert.equal(window.document.querySelector('#codex-sticky-prompt-host').hasAttribute('data-visible'), false);
  } finally {
    window.__codexStickyPrompt?.destroy();
    window.close();
  }
});

test('toolbar button toggles sticky mode and saves the choice', async () => {
  const fixture = createFixture();
  const { window, scroller, tops } = fixture;
  try {
    tops.first = 70;
    scroller.dispatchEvent(new window.Event('scroll'));
    await nextFrame();
    const toggle = window.document.querySelector('#codex-sticky-prompt-toggle');
    const host = window.document.querySelector('#codex-sticky-prompt-host');
    assert.equal(toggle.nextElementSibling.getAttribute('aria-label'), '聊天操作');
    assert.equal(toggle.getAttribute('aria-pressed'), 'true');
    assert.equal(toggle.classList.contains('button-toolbar'), true);
    assert.equal(toggle.classList.contains('bg-text/5'), true);
    assert.equal(toggle.classList.contains('not-disabled:not-aria-disabled:hover:bg-text/10'), true);
    assert.equal(toggle.classList.contains('not-disabled:not-aria-disabled:hover:bg-primary-ghost-hover'), false);
    assert.equal(toggle.querySelector('[data-pin-head]').getAttribute('fill'), 'currentColor');
    assert.equal(host.getAttribute('data-visible'), 'true');

    const nextToolbar = window.document.createElement('div');
    nextToolbar.className = 'ms-auto';
    nextToolbar.innerHTML = '<button class="button-toolbar text-tertiary aspect-square not-disabled:not-aria-disabled:hover:bg-primary-ghost-hover" aria-label="聊天操作">Menu</button>';
    toggle.parentElement.replaceWith(nextToolbar);
    await nextFrame();
    assert.equal(toggle.parentElement, nextToolbar);

    toggle.click();
    assert.equal(toggle.getAttribute('aria-pressed'), 'false');
    assert.equal(toggle.classList.contains('text-tertiary'), true);
    assert.equal(toggle.classList.contains('not-disabled:not-aria-disabled:hover:bg-primary-ghost-hover'), true);
    assert.equal(toggle.querySelector('[data-pin-head]').getAttribute('fill'), 'none');
    assert.equal(host.hasAttribute('data-visible'), false);
    assert.equal(scroller.classList.contains('codex-sticky-prompt-masked'), false);
    assert.equal(window.localStorage.getItem('codex-sticky-prompt-enabled'), 'false');

    toggle.click();
    await nextFrame();
    assert.equal(toggle.getAttribute('aria-pressed'), 'true');
    assert.equal(host.getAttribute('data-visible'), 'true');

    toggle.click();
    window.__codexStickyPrompt.destroy();
    window.eval(source);
    await nextFrame();
    assert.equal(window.document.querySelector('#codex-sticky-prompt-toggle').getAttribute('aria-pressed'), 'false');
    assert.equal(window.document.querySelector('#codex-sticky-prompt-host').hasAttribute('data-visible'), false);
  } finally {
    window.__codexStickyPrompt?.destroy();
    window.close();
  }
});
