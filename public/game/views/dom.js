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
  if (window.__gameForceMotion === true) return false;
  if (window.happyDOM) return true;
  return window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function moodClassForGenre(genre) {
  const text = typeof genre === "string" ? genre : "";
  if (text.includes("호러") || text.includes("미스터리")) return "mood-horror";
  if (text.includes("코미디")) return "mood-comedy";
  return "mood-fantasy";
}

export function hueForId(id) {
  const text = String(id == null ? "" : id);
  let sum = 0;
  for (const ch of text) sum = (sum + ch.charCodeAt(0)) % 360;
  return sum;
}

export const fsign = (n) => (n > 0 ? "+" + n : String(n));
export const frand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

export const ATTR_LABELS = { Might: "힘", Agility: "민첩", Wits: "지혜", Spirit: "정신", Sneaky: "은밀함", Fast: "재빠름", Tenacious: "집요함" };
export const DIFF_LABELS = { Trivial: "사소", Easy: "쉬움", Average: "보통", Hard: "어려움", Formidable: "지난" };
export const OUTCOME_LABELS = {
  "Failure": "실패",
  "Partial Success": "부분 성공",
  "Success": "성공",
  "Critical Success": "대성공",
};
