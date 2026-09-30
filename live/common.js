"use strict";
/* Shared by the host and player pages of the live quiz. Everything a player types is shown with
   textContent, never innerHTML. */

const SHAPES = ["▲", "◆", "●", "■"];
const TEAM_COLORS = ["#e21b3c", "#1368ce", "#ffa602", "#26890c", "#8e24aa", "#00897b"];
const $ = sel => document.querySelector(sel);

function h(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === "class") e.className = v;
    else if (k === "style") e.style.cssText = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? "" : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) e.append(c.nodeType ? c : document.createTextNode(c));
  return e;
}

function storage(kind) {
  const get = (k, d) => { try { const v = window[kind].getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } };
  const set = (k, v) => { try { window[kind].setItem(k, JSON.stringify(v)); } catch (e) { /* private mode: carry on */ } };
  const del = k => { try { window[kind].removeItem(k); } catch (e) { /* ignore */ } };
  return { get, set, del };
}
const LS = storage("localStorage"), SS = storage("sessionStorage");

/* POST JSON (or GET when no body). Rejects with an Error that has .status (0 = network). */
async function api(path, body) {
  let res;
  try {
    res = await fetch(path, body === undefined ? {} : {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
  } catch (e) {
    throw Object.assign(new Error("Can't reach the game. Check the Wi-Fi and try again."), { status: 0 });
  }
  let data = {};
  try { data = await res.json(); } catch (e) { /* not JSON */ }
  if (!res.ok) throw Object.assign(new Error(data.error || "Something went wrong."), { status: res.status });
  return data;
}

/* "Choose ___ now" -> text with a visible gap; `fill` writes the answer into it */
function withBlanks(text, fill) {
  const out = document.createDocumentFragment();
  text.split("___").forEach((part, i) => {
    if (i) out.append(fill ? h("span", { class: "blank filled" }, fill) : h("span", { class: "blank", role: "img", "aria-label": "blank" }));
    out.append(document.createTextNode(part));
  });
  return out;
}

/* Animate a bar and a number down to zero. stop() ends it; sync(ms) re-aims it after a fresh snapshot. */
function startCountdown(barEl, numEl, remainingMs, totalSecs) {
  let end = performance.now() + remainingMs, frame = 0, stopped = false;
  const tick = () => {
    if (stopped) return;
    const left = Math.max(0, end - performance.now());
    barEl.style.transform = "scaleX(" + Math.min(1, left / (totalSecs * 1000)) + ")";
    const secs = Math.ceil(left / 1000);
    if (numEl.textContent !== String(secs)) numEl.textContent = secs;
    frame = left > 0 ? requestAnimationFrame(tick) : 0;
  };
  tick();
  return {
    stop() { stopped = true; cancelAnimationFrame(frame); },
    sync(ms) {
      const target = performance.now() + ms;
      if (stopped || Math.abs(target - end) < 600) return;
      end = target;
      cancelAnimationFrame(frame);
      tick();
    },
  };
}

/* Follow a server-sent event stream. The server sends a full snapshot on every change, so a
   dropped connection heals itself: the browser reconnects and the first message is the truth.
   `check` is a URL that answers 200 while the game and this person are still valid (403/404 when
   not): when the browser gives up on the stream we ask it before believing the game is gone, because
   a page reload or a dead network also ends an EventSource. */
function follow(url, { check, onSnap, onGone, onLink }) {
  let es = null, last = 0, closed = false, leaving = false, watchdog = 0, retry = 0;
  const link = up => onLink && onLink(up);
  const open = () => {
    if (closed || leaving) return;
    if (es) es.close();
    last = Date.now();
    es = new EventSource(url);
    es.onmessage = e => {
      last = Date.now();
      link(true);
      let snap;
      try { snap = JSON.parse(e.data); } catch (err) { return; }
      if (snap.state === "ended" || snap.state === "kicked") stop();
      onSnap(snap);
    };
    es.onerror = () => {
      if (closed || leaving) return;
      link(false);
      if (es.readyState !== EventSource.CLOSED) return;        // the browser is already retrying
      clearTimeout(retry);
      retry = setTimeout(verify, 1500);
    };
  };
  const verify = async () => {
    if (closed || leaving) return;
    try {
      const res = await fetch(check, { cache: "no-store" });
      if (res.status === 403 || res.status === 404) { stop(); onGone(); return; }
    } catch (e) { /* offline: try again below */ }
    retry = setTimeout(open, 1000);
  };
  const stop = () => { closed = true; clearInterval(watchdog); clearTimeout(retry); if (es) es.close(); };
  /* phones can freeze a connection without any error event: the server pings every 15 s */
  watchdog = setInterval(() => { if (!closed && !leaving && Date.now() - last > 40000) { link(false); open(); } }, 5000);
  document.addEventListener("visibilitychange", () => { if (!closed && !document.hidden && Date.now() - last > 20000) open(); });
  window.addEventListener("pagehide", () => { leaving = true; });
  window.addEventListener("pageshow", e => { if (e.persisted && leaving) { leaving = false; open(); } });
  open();
  return stop;
}

function linkBanner() {
  const el = h("div", { class: "status hidden", role: "status" }, "Reconnecting…");
  document.body.append(el);
  return up => el.classList.toggle("hidden", up);
}

const ordinal = n => {
  const s = ["th", "st", "nd", "rd"], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
};
const fmtPin = pin => pin.slice(0, 3) + " " + pin.slice(3);
