// Native-position wheel easing. No virtual scroll, no dependencies, and the page scrolls the same without it.
const root: HTMLElement = document.documentElement;
const reduced: MediaQueryList = matchMedia("(prefers-reduced-motion: reduce)");
const pointer: MediaQueryList = matchMedia("(any-pointer: fine)");

let frame = 0;
let target = 0;
let position = 0;
let lastWritten = 0;
let lastTime = 0;
let timeConstant = 145;

const maxY = (): number => Math.max(0, (document.scrollingElement ?? root).scrollHeight - root.clientHeight);
const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

function stop(): void {
  if (frame) cancelAnimationFrame(frame);
  frame = 0;
  root.classList.remove("forma-wheel-active");
}

function write(y: number): void {
  // The real document scrolls, so sticky positioning and CSS view timelines stay native.
  window.scrollTo({ top: y, left: window.scrollX, behavior: "instant" });
  lastWritten = window.scrollY;
}

function tick(now: number): void {
  if (reduced.matches || !pointer.matches || document.hidden || Math.abs(window.scrollY - lastWritten) > 2) {
    stop();
    return;
  }
  target = clamp(target, 0, maxY());
  const elapsed = clamp(now - lastTime, 1, 48);
  lastTime = now;
  // Frame-rate-independent exponential easing, including high-refresh displays.
  position += (target - position) * (1 - Math.exp(-elapsed / timeConstant));
  if (Math.abs(target - position) <= 0.65) {
    write(target);
    stop();
    return;
  }
  write(position);
  frame = requestAnimationFrame(tick);
}

function insideNestedScroller(event: WheelEvent): boolean {
  for (const node of event.composedPath()) {
    if (!(node instanceof Element) || node === document.body || node === root) continue;
    if (node.matches('textarea, select, input, [contenteditable]:not([contenteditable="false"])')) return true;
    if (node.scrollHeight > node.clientHeight + 1 && /^(auto|scroll|overlay)$/.test(getComputedStyle(node).overflowY)) return true;
  }
  return false;
}

function onWheel(event: WheelEvent): void {
  // Zoom gestures, horizontal gestures, controls and nested scrolling stay native.
  if (
    reduced.matches || !pointer.matches || event.defaultPrevented || !event.cancelable ||
    event.ctrlKey || event.metaKey || event.shiftKey || event.altKey ||
    !event.deltaY || Math.abs(event.deltaX) >= Math.abs(event.deltaY) || insideNestedScroller(event)
  ) {
    stop();
    return;
  }
  const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? root.clientHeight : 1;
  const delta = event.deltaY * unit;
  const currentY = window.scrollY;
  if (frame && Math.abs(currentY - lastWritten) > 2) stop();
  if (!frame) target = position = lastWritten = currentY;
  // Bound the queued travel so a long wheel burst cannot create a runaway animation.
  const queue = Math.max(360, root.clientHeight * 1.6);
  const next = clamp(clamp(target + delta, currentY - queue, currentY + queue), 0, maxY());
  if (!frame && Math.abs(next - currentY) < 0.5) return;
  event.preventDefault();
  // High-resolution wheel and trackpad input gets a slightly faster response.
  timeConstant = Math.abs(delta) < 45 ? 95 : 145;
  target = next;
  if (!frame) {
    root.classList.add("forma-wheel-active");
    lastTime = performance.now();
    frame = requestAnimationFrame(tick);
  }
}

window.addEventListener("wheel", onWheel, { passive: false });
// Never compete with touch, keyboard, scrollbar dragging or fragment navigation.
for (const type of ["keydown", "pointerdown", "touchstart", "hashchange", "popstate", "resize", "blur", "pagehide"]) {
  window.addEventListener(type, stop, { passive: true, capture: true });
}
document.addEventListener("focusin", stop);
document.addEventListener("visibilitychange", stop);
reduced.addEventListener("change", stop);
pointer.addEventListener("change", stop);
