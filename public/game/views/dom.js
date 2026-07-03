export function textSpan(className, text) {
  const span = document.createElement("span");
  span.className = className;
  span.textContent = text;
  return span;
}

export function appendText(parent, text) {
  parent.appendChild(document.createTextNode(text));
}

export const STICK_THRESHOLD_PX = 40;
export function isNearBottom(el) {
  return el.scrollHeight - el.scrollTop - el.clientHeight < STICK_THRESHOLD_PX;
}
export function stickToBottom(el, wasNearBottom) {
  if (wasNearBottom) el.scrollTop = el.scrollHeight;
}
export function prefersReducedMotion() {
  if (window.happyDOM) return true;
  return window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export const fsign = (n) => (n > 0 ? "+" + n : String(n));
export const frand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
