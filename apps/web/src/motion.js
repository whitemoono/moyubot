const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const activeSprings = new WeakMap();
export function stopSpring(element) {
  const active = activeSprings.get(element);
  if (active) cancelAnimationFrame(active.frame);
  activeSprings.delete(element);
}

// Capture the complete screen so the header, messages, composer and dock travel together.
export function captureNavigation() {
  const page = document.querySelector('.screen-content');
  if (!page || reduced()) return null;
  const style = getComputedStyle(page);
  const snapshot = { page, top: page.offsetTop, transform: style.transform, opacity: style.opacity };
  page.getAnimations().forEach(animation => animation.cancel());
  return snapshot;
}

export function animateNavigation(back, outgoing, complete = () => {}) {
  const page = document.querySelector('.screen-content');
  if (!page || !outgoing || reduced()) { complete(); return; }
  const previous = outgoing.page, host = page.parentElement, width = page.clientWidth;
  previous.classList.add('navigation-outgoing');
  previous.style.top = `${outgoing.top}px`;
  previous.inert = true; previous.setAttribute('aria-hidden', 'true');
  previous.querySelectorAll('[id]').forEach(el => el.removeAttribute('id'));
  host.append(previous);
  page.classList.add('navigation-moving');
  const shade = document.createElement('div'); shade.className = 'navigation-shade';
  (back ? page : previous).append(shade);
  page.style.zIndex = back ? '1' : '3'; previous.style.zIndex = back ? '3' : '1';
  const timing = { duration: 430, easing: 'cubic-bezier(.22,.72,.2,1)', fill: 'both' };
  const exit = previous.animate([
    { transform: outgoing.transform, opacity: outgoing.opacity },
    { transform: `translate3d(${back ? width : -width * .23}px,0,0)`, opacity: 1 },
  ], timing);
  const enter = page.animate([
    { transform: `translate3d(${back ? -width * .23 : width}px,0,0)` },
    { transform: 'translate3d(0,0,0)' },
  ], timing);
  shade.animate([{opacity:back ? .14 : 0},{opacity:back ? 0 : .14}],timing);
  Promise.allSettled([enter.finished,exit.finished]).then(() => {
    previous.remove(); shade.remove(); enter.cancel();
    page.classList.remove('navigation-moving'); page.style.zIndex = '';
    complete();
  });
}

export function animateSheet(sheet, backdrop, closing = false, complete = () => {}) {
  // Read before cancellation so reversing a partly open sheet starts at its visible position.
  const transform = getComputedStyle(sheet).transform;
  const opacity = getComputedStyle(backdrop).opacity;
  stopSpring(sheet);
  sheet.getAnimations().forEach(a => a.cancel());
  backdrop.getAnimations().forEach(a => a.cancel());
  if (reduced()) { if (closing) complete(); return; }
  const animation = sheet.animate([
    { transform: closing ? transform : 'translate3d(0,100%,0)' },
    { transform: closing ? 'translate3d(0,100%,0)' : 'translate3d(0,0,0)' },
  ], { duration: closing ? 260 : 380, easing: closing ? 'cubic-bezier(.4,0,.8,.3)' : 'cubic-bezier(.2,.78,.22,1)', fill: 'both' });
  const fade = backdrop.animate([{opacity:closing?opacity:0},{opacity:closing?0:1}],{duration:closing?260:300,fill:'both'});
  animation.finished.then(() => { if (closing) complete(); else { sheet.style.transform = ''; animation.cancel(); fade.cancel(); } }, () => {});
}

// Time-based springs retain velocity when interrupted by a new target.
export function spring(element, target, paint, options = {}) {
  const previous = activeSprings.get(element);
  if (previous) cancelAnimationFrame(previous.frame);
  const state = { x: previous?.x ?? options.from ?? target, velocity: previous?.velocity ?? 0, frame: 0 };
  const stiffness = options.stiffness ?? 330;
  const damping = options.damping ?? 29;
  let last = performance.now();
  const step = now => {
    const dt = Math.min((now - last) / 1000, .032);
    last = now;
    // Small integration steps keep the response stable on slower screens.
    for (let elapsed = 0; elapsed < dt; elapsed += .004) {
      const h = Math.min(.004, dt - elapsed);
      state.velocity += ((target - state.x) * stiffness - state.velocity * damping) * h;
      state.x += state.velocity * h;
    }
    paint(state.x, state.velocity);
    if (Math.abs(target - state.x) > .025 || Math.abs(state.velocity) > .1) state.frame = requestAnimationFrame(step);
    else { state.x = target; state.velocity = 0; paint(target, 0); activeSprings.delete(element); }
  };
  activeSprings.set(element, state);
  if (reduced()) { state.x = target; paint(target, 0); activeSprings.delete(element); }
  else state.frame = requestAnimationFrame(step);
}

export function captureTabPage() {
  const page = document.querySelector('.tab-page:not(.tab-page-outgoing)');
  if (!page || reduced()) return null;
  const style = getComputedStyle(page);
  const snapshot = { page, transform: style.transform, opacity: style.opacity };
  page.getAnimations().forEach(animation => animation.cancel());
  return snapshot;
}

export function animatePage(direction = 1, chat = false, outgoing = null) {
  if (reduced()) return;
  const page = document.querySelector('.tab-page');
  if (!chat && page && outgoing) {
    const host = page.parentElement;
    const width = host.clientWidth;
    const previous = outgoing.page;
    previous.classList.add('tab-page-outgoing');
    previous.inert = true;
    previous.setAttribute('aria-hidden', 'true');
    previous.removeAttribute('id');
    previous.querySelectorAll('[id]').forEach(el => el.removeAttribute('id'));
    host.append(previous);
    const timing = { duration: 420, easing: 'cubic-bezier(.22,.74,.22,1)', fill: 'both' };
    const exit = previous.animate([
      { transform: outgoing.transform, opacity: outgoing.opacity },
      { transform: `translate3d(${-direction * width}px,0,0)`, opacity: 1 },
    ], timing);
    const enter = page.animate([
      { transform: `translate3d(${direction * width}px,0,0)` },
      { transform: 'translate3d(0,0,0)' },
    ], timing);
    // Remove both the old page and compositor hints after settling/cancellation.
    exit.finished.then(() => previous.remove(), () => previous.remove());
    enter.finished.then(() => enter.cancel(), () => {});
    return;
  }
  const elements = document.querySelectorAll('.page-header,.page-scroll,.chat-header,.chat-model-bar');
  elements.forEach((el, i) => el.animate([
    { opacity: .12, transform: `translate3d(${direction * (chat ? 34 : 14)}px,${chat ? 0 : 5}px,0)` },
    { opacity: 1, transform: 'translate3d(0,0,0)' },
  ], { duration: chat ? 390 : 320, delay: i * 12, easing: 'cubic-bezier(.18,.8,.22,1)', fill: 'backwards' }));
}

export function positionLens(nav, animate = true) {
  if (!nav) return;
  const lens = nav.querySelector('.nav-lens');
  const active = nav.querySelector('[aria-current="page"]');
  if (!lens || !active) return;
  const target = active.offsetLeft;
  lens.style.width = `${active.offsetWidth}px`;
  const paint = (x, velocity) => {
    const stretch = 1 + Math.min(Math.abs(velocity) / 8500, .1);
    lens.style.transform = `translate3d(${x}px,0,0) scaleX(${stretch}) scaleY(${1 / Math.sqrt(stretch)})`;
  };
  if (!animate || reduced()) { lens.style.transform = `translate3d(${target}px,0,0)`; lens.dataset.x = target; }
  else spring(lens, target, paint, { from: Number(lens.dataset.x ?? target) });
  lens.dataset.x = target;
}

export function installMotion() {
  let pressed;
  document.addEventListener('pointerdown', event => {
    const button = event.target.closest('button');
    if (!button || button.matches('[role="switch"]') || reduced()) return;
    pressed = button;
    spring(button, .94, scale => { button.style.scale = scale; }, { from: 1, stiffness: 600, damping: 38 });
  }, { passive: true });
  const release = () => {
    if (!pressed) return;
    const button = pressed;
    pressed = null;
    spring(button, 1, scale => { button.style.scale = scale; }, { from: .94, stiffness: 430, damping: 22 });
  };
  document.addEventListener('pointerup', release, { passive: true });
  document.addEventListener('pointercancel', release, { passive: true });
  window.addEventListener('resize', () => positionLens(document.querySelector('.bottom-nav'), false));

  // Drag the highlight across the dock; only a completed drag changes tabs.
  let drag;
  document.addEventListener('pointerdown', event => {
    const nav = event.target.closest('.bottom-nav');
    if (!nav) return;
    drag = { nav, start: event.clientX, id: event.pointerId, moved: false, item: null };
  }, { passive: true });
  document.addEventListener('pointermove', event => {
    if (!drag || drag.id !== event.pointerId || reduced()) return;
    if (Math.abs(event.clientX - drag.start) > 9) drag.moved = true;
    if (!drag.moved) return;
    const rect = drag.nav.getBoundingClientRect();
    const items = [...drag.nav.querySelectorAll('.nav-item')];
    drag.item = items.reduce((best, item) => Math.abs(event.clientX - (rect.left + item.offsetLeft + item.offsetWidth / 2)) < Math.abs(event.clientX - (rect.left + best.offsetLeft + best.offsetWidth / 2)) ? item : best);
    const lens = drag.nav.querySelector('.nav-lens');
    const x = Math.max(6, Math.min(rect.width - lens.offsetWidth - 6, event.clientX - rect.left - lens.offsetWidth / 2));
    spring(lens, x, value => { lens.style.transform = `translate3d(${value}px,0,0) scale(1.06,.96)`; }, { from: Number(lens.dataset.x), stiffness: 650, damping: 43 });
  }, { passive: true });
  document.addEventListener('pointerup', () => {
    if (drag?.moved && drag.item) {
      const item = drag.item;
      const suppress = e => { e.preventDefault(); e.stopImmediatePropagation(); };
      document.addEventListener('click', suppress, { capture: true, once: true });
      setTimeout(() => document.removeEventListener('click', suppress, true), 80);
      item.dispatchEvent(new CustomEvent('dock-select', { bubbles: true }));
    } else if (drag) positionLens(drag.nav);
    drag = null;
  }, { passive: true });
  document.addEventListener('pointercancel', () => { if (drag) positionLens(drag.nav); drag = null; }, { passive: true });

  let sheetDrag;
  document.addEventListener('pointerdown', event => {
    const handle = event.target.closest('.sheet-handle,.sheet-heading');
    if (!handle || event.target.closest('button,input')) return;
    const sheet = handle.closest('.bottom-sheet');
    sheetDrag = { sheet, start: event.clientY, y: 0, previous: event.clientY, time: performance.now(), velocity: 0 };
    const transform = getComputedStyle(sheet).transform;
    sheet.getAnimations().forEach(a => a.cancel());
    stopSpring(sheet);
    const initialY = new DOMMatrixReadOnly(transform).m42;
    sheetDrag.start -= initialY;
    sheetDrag.y = initialY;
    sheet.style.transform = `translate3d(0,${initialY}px,0)`;
    sheet.style.animation = 'none';
    handle.setPointerCapture(event.pointerId);
  });
  document.addEventListener('pointermove', event => {
    if (!sheetDrag) return;
    const now = performance.now();
    sheetDrag.velocity = (event.clientY - sheetDrag.previous) / Math.max(now - sheetDrag.time, 1);
    sheetDrag.previous = event.clientY;
    sheetDrag.time = now;
    sheetDrag.y = Math.max(-12, event.clientY - sheetDrag.start);
    sheetDrag.sheet.style.transform = `translate3d(0,${sheetDrag.y}px,0)`;
  }, { passive: true });
  const endSheetDrag = cancel => {
    if (!sheetDrag) return;
    const { sheet, y, velocity } = sheetDrag;
    sheetDrag = null;
    if (!cancel && (y > 100 || (y > 25 && velocity > .55))) {
      sheet.querySelector('[data-action="dismiss"]').click();
    } else spring(sheet, 0, value => { sheet.style.transform = `translate3d(0,${value}px,0)`; }, { from: y, stiffness: 370, damping: 30 });
  };
  document.addEventListener('pointerup', () => endSheetDrag(false));
  document.addEventListener('pointercancel', () => endSheetDrag(true));
}
