/* Destination A2 practice - shared client code, inlined into every page by build.py.
   Progress is kept in this browser's localStorage only (per device). */

const Store = {
  get(k, d) { try { const v = localStorage.getItem("dA2:" + k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem("dA2:" + k, JSON.stringify(v)); } catch (e) {} },
};
const norm = s => s.toLowerCase().replace(/[’‘`]/g, "'").replace(/\s+/g, " ").trim().replace(/[.!?]+$/, "");
const loose = s => s.toLowerCase().replace(/[’‘`]/g, "'").replace(/[^a-z0-9' ]+/g, " ").replace(/\s+/g, " ").trim();
const esc = s => s.replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const pick = (a, k) => shuffle(a).slice(0, k);
const pct = s => (s ? Math.round(s.ok * 100 / s.n) : 0);
const starsFor = s => { const p = pct(s); return !s ? 0 : p >= 90 ? 3 : p >= 70 ? 2 : p >= 50 ? 1 : 0; };
const starText = k => "★".repeat(k) + "☆".repeat(3 - k);
function el(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") e.className = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v);
  }
  for (const c of kids.flat()) if (c != null) e.append(c.nodeType ? c : document.createTextNode(c));
  return e;
}
const PAGE = document.body.dataset.page || "";
const dayKey = d => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");

/* ---------- mistakes notebook (Leitner boxes 0-2; right answer in box 2 = mastered) ---------- */
const addDays = (k, n) => { const [y, m, d] = k.split("-").map(Number); return dayKey(new Date(y, m - 1, d + n)); };
const INTERVAL = [1, 3, 7];            // days until the next review after a right answer in box 0 / 1 / 2
function logMistake(id) {
  if (!id) return;
  const m = Store.get("mistakes", {}), old = m[id];
  m[id] = { b: 0, d: dayKey(new Date()), w: (old ? old.w : 0) + 1 };
  Store.set("mistakes", m);
}
function logSection(sec) {
  sec.querySelectorAll("li.q.bad[data-id]").forEach(q => {
    const t = q.querySelector("input[type=text]");
    if (t ? t.value.trim() : q.querySelector("input:checked")) logMistake(q.dataset.id);
  });
}

/* ---------- progress ---------- */
function record(section, ok, n, byCount) {
  if (!PAGE || !n) return;
  const all = Store.get("scores", {}), p = all[PAGE] || (all[PAGE] = {}), prev = p[section];
  const better = !prev || (byCount ? ok > prev.ok : ok / n > prev.ok / prev.n || (ok / n === prev.ok / prev.n && ok > prev.ok));
  if (better) p[section] = { ok, n };
  Store.set("scores", all);
  const days = Store.get("days", []), t = dayKey(new Date());
  if (!days.includes(t)) { days.push(t); Store.set("days", days); }
  updateHero();
}
function pageScores() { return Store.get("scores", {})[PAGE] || {}; }
function updateHero() {
  const p = pageScores();
  const st = document.getElementById("hero-stars");
  if (st) st.textContent = starText(starsFor(p.test || p.p1));
  const xp = document.getElementById("hero-xp");
  if (xp) xp.textContent = "⚡ " + Object.values(p).reduce((a, s) => a + s.ok * 10, 0) + " XP";
  document.querySelectorAll(".tabs button").forEach(b => {
    const box = document.querySelector('[data-tab="' + b.dataset.go + '"]');
    const secs = box ? [...box.querySelectorAll("section[id]")].concat(box.matches("section[id]") ? [box] : []) : [];
    b.classList.toggle("done", secs.some(s => p[s.id]));
  });
}

/* ---------- sound, speech, confetti ---------- */
let AC;
function beep(good) {
  if (!Store.get("sound", true)) return;
  try {
    AC = AC || new (window.AudioContext || window.webkitAudioContext)();
    const t = AC.currentTime;
    (good ? [660, 880] : [220, 170]).forEach((f, i) => {
      const o = AC.createOscillator(), g = AC.createGain();
      o.type = good ? "sine" : "square"; o.frequency.value = f;
      g.gain.setValueAtTime(0.07, t + i * 0.12); g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.12 + 0.2);
      o.connect(g).connect(AC.destination); o.start(t + i * 0.12); o.stop(t + i * 0.12 + 0.22);
    });
  } catch (e) {}
}
function toggleSound(btn) { const on = !Store.get("sound", true); Store.set("sound", on); btn.textContent = on ? "🔊" : "🔇"; }
function say(text, rate) {
  try {
    const u = new SpeechSynthesisUtterance(text.replace(/\s*\/\s*/g, ", "));
    const vs = speechSynthesis.getVoices();
    const v = vs.find(x => /en[-_]GB/i.test(x.lang)) || vs.find(x => /^en/i.test(x.lang));
    if (v) u.voice = v;
    u.lang = v ? v.lang : "en-GB"; u.rate = rate || 0.9;
    speechSynthesis.cancel(); speechSynthesis.speak(u);
  } catch (e) {}
}
const EMBEDDED = window.top !== window.self; // inside the published viewer: no microphone, no print dialog
const SR = EMBEDDED ? null : window.SpeechRecognition || window.webkitSpeechRecognition;
function confetti() {
  const c = el("canvas", { style: "position:fixed;inset:0;pointer-events:none;z-index:99" });
  document.body.append(c);
  const x = c.getContext("2d"); c.width = innerWidth; c.height = innerHeight;
  const cols = ["#f5a524", "#e2445c", "#1f6feb", "#00a86b", "#a855f7"];
  const ps = Array.from({ length: 140 }, () => ({ x: Math.random() * c.width, y: -20 - Math.random() * c.height / 2,
    vx: Math.random() * 4 - 2, vy: 2 + Math.random() * 4, r: 4 + Math.random() * 5, c: cols[Math.floor(Math.random() * 5)], a: Math.random() * 6 }));
  let f = 0;
  (function frame() {
    x.clearRect(0, 0, c.width, c.height);
    for (const p of ps) { p.x += p.vx; p.y += p.vy; p.a += 0.1; x.fillStyle = p.c; x.fillRect(p.x, p.y, p.r, p.r * Math.abs(Math.sin(p.a)) + 2); }
    if (++f < 150) requestAnimationFrame(frame); else c.remove();
  })();
}

/* ---------- server-rendered exercises ---------- */
function check(btn, silent) {
  const sec = btn.closest("section"); let ok = 0, n = 0;
  sec.querySelectorAll("li.q").forEach(q => {
    n++; const t = q.querySelector("input[type=text]"); let good;
    if (t) good = JSON.parse(t.dataset.a).some(a => norm(a) === norm(t.value));
    else { const r = q.querySelector("input:checked"); good = !!r && r.value === "1"; }
    q.classList.remove("ok", "bad"); void q.offsetWidth; q.classList.add(good ? "ok" : "bad"); ok += good;
  });
  sec.querySelector(".score").textContent = ok + " / " + n;
  if (!silent) { beep(ok === n); record(sec.id, ok, n); logSection(sec); if (ok === n) confetti(); }
  return [ok, n];
}
function finish(btn) {
  const sec = btn.closest("section"), [ok, n] = check(btn, true), p = Math.round(ok * 100 / n), st = starsFor({ ok, n });
  const msg = p >= 90 ? "Excellent!" : p >= 70 ? "Good job!" : p >= 50 ? "Not bad — review the lesson." : "Study the lesson again and retry.";
  sec.querySelector(".score").textContent = ok + " / " + n + " (" + p + "%) " + starText(st) + " " + msg;
  record(sec.id, ok, n); logSection(sec); beep(p >= 50); if (p >= 90) confetti();
  sec.querySelector(".hidden")?.classList.remove("hidden");
  return [ok, n];
}

/* ---------- reading ---------- */
function readAloud(btn, rate) {
  const box = btn.closest("section").querySelector(".rtext");
  try {
    speechSynthesis.cancel();
    [...box.querySelectorAll("p")].forEach(p => {
      const u = new SpeechSynthesisUtterance(p.innerText);
      const vs = speechSynthesis.getVoices(), v = vs.find(x => /en[-_]GB/i.test(x.lang)) || vs.find(x => /^en/i.test(x.lang));
      if (v) u.voice = v;
      u.lang = v ? v.lang : "en-GB"; u.rate = rate || 0.9;
      u.onstart = () => { box.querySelectorAll("p").forEach(x => x.classList.remove("speaking")); p.classList.add("speaking"); };
      u.onend = () => p.classList.remove("speaking");
      speechSynthesis.speak(u);    // one utterance per paragraph: long single utterances get cut off in Chrome
    });
  } catch (e) {}
}
function toggleText(btn) {
  const box = btn.closest("section").querySelector(".rtext"), hide = !box.classList.contains("hidden");
  box.classList.toggle("hidden", hide);
  btn.textContent = hide ? "👁 Show text" : "🎧 Listening mode";
}

/* ---------- placement test ---------- */
function placement(btn) {
  const sec = btn.closest("section"), items = [...sec.querySelectorAll("li.q")];
  const missing = items.filter(q => !q.querySelector("input:checked")).length;
  if (missing && !btn.dataset.sure) {
    btn.dataset.sure = "1"; btn.textContent = "Show my plan anyway";
    sec.querySelector(".score").textContent = missing + " questions have no answer. Answer them, or press again.";
    return;
  }
  const [ok, n] = finish(btn);
  const byUnit = {}; items.forEach(q => (byUnit[q.dataset.u] = q.classList.contains("ok")));
  const blocks = [];
  for (let s = 1; s <= 42; s += 3) {
    const us = [s, s + 1, s + 2], got = us.filter(u => byUnit[u]).length;
    blocks.push({ us, got });
  }
  const start = blocks.find(b => b.got < 2);
  const link = u => el("a", { href: "unit-" + String(u).padStart(2, "0") + ".html" }, u + ". " + TITLES[u]);
  const plan = el("section", { class: "card" }, el("h2", {}, "🧭 Your study plan"),
    el("p", { class: "big" }, ok + " / " + n + " correct"),
    el("p", {}, start ? el("span", {}, "Start with ", link(start.us[0]), ". ", "Units with 🔴 need the most work.")
      : "Excellent! You know most of the book. Do the reviews and progress tests to check."),
    el("div", { class: "plan" }, ...blocks.map(b => el("div", { class: "plan-row" },
      el("b", {}, b.got === 3 ? "✅" : b.got === 2 ? "🟡" : "🔴"),
      el("span", {}, ...b.us.flatMap((u, i) => [i ? " · " : "", link(u), byUnit[u] ? " ✓" : " ✗"]))))),
    el("p", { class: "inst" }, "✅ you know it — quick review · 🟡 revise · 🔴 study these units"));
  document.getElementById("plan").replaceChildren(plan);
  plan.scrollIntoView({ behavior: "smooth" });
}

/* ---------- mistakes page ---------- */
function initMistakes() {
  const root = document.getElementById("mistakes");
  if (!root || typeof BANK === "undefined") return;
  const load = () => {
    const m = Store.get("mistakes", {});
    for (const id of Object.keys(m)) if (!BANK[id]) delete m[id];   // question removed from the site
    return m;
  };
  const home = () => {
    const m = load(), today = dayKey(new Date()), ids = Object.keys(m);
    const due = ids.filter(id => m[id].d <= today);
    const byUnit = {};
    ids.forEach(id => (byUnit[BANK[id].u] = byUnit[BANK[id].u] || []).push(id));
    root.replaceChildren(
      el("div", { class: "dash" },
        el("div", { class: "stat" }, el("span", {}, "📒 Saved mistakes"), el("b", {}, String(ids.length))),
        el("div", { class: "stat" }, el("span", {}, "⏰ Due today"), el("b", {}, String(due.length))),
        el("div", { class: "stat" }, el("span", {}, "🏆 Mastered"), el("b", {}, String(Store.get("mastered", 0))))),
      el("section", { class: "card", style: "text-align:center" },
        ids.length ? el("p", { class: "big" }, due.length ? "You have " + due.length + " questions to review today." : "Nothing due today. Come back tomorrow!")
          : el("p", { class: "big" }, "No mistakes yet. Wrong answers from any unit, review or test appear here."),
        due.length ? el("button", { class: "big-btn", onclick: () => session(shuffle(due).slice(0, 15)) }, "▶ Start today's review") : null,
        ids.length && !due.length ? el("button", { class: "ghost", onclick: () => session(pick(ids, 10)) }, "Practise anyway") : null),
      ids.length ? el("section", { class: "card" }, el("h2", {}, "By unit"),
        ...Object.entries(byUnit).map(([u, list]) => el("div", { class: "plan-row" },
          el("b", {}, String(list.length)), el("a", { href: BANK[list[0]].h }, u),
          el("span", { class: "inst" }, list.filter(id => m[id].d <= today).length + " due")))) : null);
  };
  const session = list => {
    let i = 0, right = 0;
    const next = () => {
      if (i >= list.length) {
        if (right === list.length) confetti();
        root.replaceChildren(el("section", { class: "card", style: "text-align:center" },
          el("p", { class: "big" }, "Done! " + right + " / " + list.length + " right."),
          el("button", { class: "big-btn", onclick: home }, "Back to my mistakes")));
        return;
      }
      const id = list[i], it = BANK[id], fb = el("p", { class: "fb" });
      const answer = good => {
        const m = load(), today = dayKey(new Date()), cur = m[id] || { b: 0, w: 0 };
        if (good) {
          right++;
          if (cur.b >= 2) { delete m[id]; Store.set("mastered", Store.get("mastered", 0) + 1); }
          else m[id] = { b: cur.b + 1, d: addDays(today, INTERVAL[cur.b]), w: cur.w };
        } else m[id] = { b: 0, d: addDays(today, 1), w: cur.w + 1 };
        Store.set("mistakes", m); beep(good);
        fb.className = "fb " + (good ? "good" : "bad");
        fb.textContent = good ? "✔ Correct!" : "✘ Answer: " + it.a[0];
        i++;
        root.querySelectorAll("button.tile, .dict button, .dict input").forEach(b => (b.disabled = true));
        setTimeout(next, good ? 900 : 2200);
      };
      const qEl = el("p", { class: "q-big" });
      qEl.innerHTML = esc(it.q).replace("___", '<span class="blank">______</span>');
      let body;
      if (it.t === "mc") body = el("div", { class: "opts-big" }, ...shuffle(it.a).map(o => el("button", { class: "tile", onclick: e => {
        e.currentTarget.classList.add(o === it.a[0] ? "matched" : "wrong"); answer(o === it.a[0]);
      } }, o)));
      else {
        const inp = el("input", { type: "text", autocomplete: "off", spellcheck: "false" });
        const go = () => answer(it.a.some(a => norm(a) === norm(inp.value)));
        inp.onkeydown = e => { if (e.key === "Enter") go(); };
        body = el("div", { class: "dict" }, inp, el("button", { onclick: go }, "Check"));
        setTimeout(() => inp.focus(), 50);
      }
      root.replaceChildren(el("section", { class: "card" },
        el("div", { class: "actions", style: "justify-content:space-between" }, el("b", {}, (i + 1) + " / " + list.length),
          el("a", { href: it.h }, it.u)), qEl, body, fb));
    };
    next();
  };
  home();
}

/* ---------- teacher downloads (index) ---------- */
function initDownloads() {
  const sel = document.getElementById("xl-unit");
  if (!sel) return;
  const links = [...document.querySelectorAll("a.dl")], msg = document.getElementById("dl-msg");
  sel.onchange = () => links.forEach(a => { if (a.dataset.dir) a.href = a.dataset.dir + "/unit-" + sel.value + ".xlsx"; });
  if (!EMBEDDED) return;                     // local files: the plain download links just work
  let packed = null;                         // online the files come base64-packed in xlsx-files.json
  links.forEach(a => a.addEventListener("click", async e => {
    e.preventDefault();
    const href = a.getAttribute("href"), name = (a.dataset.dir ? a.dataset.dir + "-" : "") + href.split("/").pop();
    try {
      const dl = window.claude && (await window.claude.use("downloads"));
      if (!dl) { msg.textContent = "Downloading is not available here. Open the page in your browser."; return; }
      packed = packed || (await (await fetch("xlsx-files.json")).json());
      const bin = atob(packed[href]), bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      await dl.save({ filename: name, data: bytes });
      msg.textContent = "Saved " + name; msg.className = "fb good";
    } catch (err) {
      if (err && err.code === "declined") return;
      msg.textContent = "Could not download " + name + "."; msg.className = "fb bad";
    }
  }));
}
function reveal(btn) {
  const sec = btn.closest("section");
  sec.querySelectorAll("input[type=text]").forEach(t => (t.value = JSON.parse(t.dataset.a)[0]));
  sec.querySelectorAll('input[type=radio][value="1"]').forEach(r => (r.checked = true));
  check(btn, true);
}
function reset(btn) {
  const sec = btn.closest("section");
  sec.querySelectorAll("input").forEach(i => (i.type === "text" ? (i.value = "") : (i.checked = false)));
  sec.querySelectorAll("li.q").forEach(q => q.classList.remove("ok", "bad"));
  sec.querySelector(".score").textContent = "";
}

/* ---------- tabs ---------- */
function initTabs() {
  const tabs = [...document.querySelectorAll(".tabs button")];
  if (!tabs.length) return;
  const show = (id, scroll) => {
    document.querySelectorAll("[data-tab]").forEach(s => (s.hidden = s.dataset.tab !== id));
    tabs.forEach(b => b.classList.toggle("on", b.dataset.go === id));
    try { history.replaceState(null, "", "#" + id); } catch (e) {}
    if (scroll) window.scrollTo({ top: document.querySelector(".tabs").offsetTop - 4, behavior: "smooth" });
  };
  tabs.forEach(b => (b.onclick = () => show(b.dataset.go, true)));
  const h = location.hash.slice(1);
  show(tabs.some(b => b.dataset.go === h) ? h : tabs[0].dataset.go, false);
}

/* ---------- games (need UNIT data) ---------- */
function gameCard(id, tab, title, intro) {
  const body = el("div");
  document.getElementById(tab + "-area").append(el("section", { id, class: "card game" }, el("h2", {}, title), el("p", { class: "inst" }, intro), body));
  return body;
}
const shortSentences = (min, max) => UNIT.sentences.filter(x => { const k = x.split(" ").length; return k >= min && k <= max; });

function flashcards() {
  const words = UNIT.words, body = gameCard("flash", "games", "🗂️ Flashcards", "Tap the card to see the meaning. Mark the words you know.");
  const known = new Set(Store.get("known:" + PAGE, []));
  let i = 0;
  const front = el("div", { class: "face front" }), back = el("div", { class: "face back" });
  const card = el("div", { class: "flash", tabindex: "0" }, el("div", { class: "inner" }, front, back));
  const count = el("span", { class: "score" });
  const draw = () => {
    const [en, uz, ex] = words[i];
    card.classList.remove("flipped"); card.classList.toggle("known", known.has(en));
    front.replaceChildren(el("b", {}, en), el("small", {}, i + 1 + " / " + words.length));
    back.replaceChildren(el("b", {}, uz), el("i", {}, ex));
    count.textContent = "Known: " + known.size + " / " + words.length;
  };
  const save = () => { Store.set("known:" + PAGE, [...known]); record("flash", known.size, words.length); };
  const go = d => { i = (i + d + words.length) % words.length; draw(); };
  card.onclick = () => card.classList.toggle("flipped");
  card.onkeydown = e => { if (e.key === " " || e.key === "Enter") { e.preventDefault(); card.classList.toggle("flipped"); } };
  body.append(card, el("div", { class: "actions" },
    el("button", { class: "ghost", onclick: () => go(-1) }, "◀"),
    el("button", { class: "ghost", onclick: () => say(words[i][0]) }, "🔊"),
    el("button", { class: "ghost", onclick: () => go(1) }, "▶"),
    el("button", { onclick: () => { known.add(words[i][0]); save(); beep(true); if (known.size === words.length) confetti(); go(1); } }, "✓ I know it"),
    el("button", { class: "ghost", onclick: () => { known.delete(words[i][0]); save(); go(1); } }, "✗ Again"), count));
  draw();
}

function matchGame() {
  const vocab = UNIT.kind === "vocab";
  const body = gameCard("match", "games", "🧩 Match the pairs",
    vocab ? "Tap an English word, then its Uzbek meaning." : "Tap the beginning of a sentence, then its correct ending.");
  const board = el("div", { class: "match" }), info = el("span", { class: "score" });
  const pairsFor = () => vocab ? pick(UNIT.words, 6).map(w => [w[0], w[1]])
    : pick(shortSentences(5, 14), 5).map(x => { const w = x.split(" "), h = Math.ceil(w.length / 2); return [w.slice(0, h).join(" ") + " …", "… " + w.slice(h).join(" ")]; });
  const round = () => {
    const pairs = pairsFor(); let sel = null, done = 0, miss = 0;
    const L = el("div", { class: "col" }), R = el("div", { class: "col" });
    const nudge = b => { b.classList.add("shake"); setTimeout(() => b.classList.remove("shake"), 400); };
    const tile = (txt, key, left) => {
      const b = el("button", { class: "tile" }, txt);
      b.onclick = () => {
        if (left) { L.querySelectorAll(".tile").forEach(x => x.classList.remove("sel")); sel = b; b.classList.add("sel"); b.dataset.key = key; return; }
        if (!sel) return nudge(b);
        if (+sel.dataset.key === key) {
          [sel, b].forEach(x => { x.disabled = true; x.classList.remove("sel"); x.classList.add("matched"); });
          sel = null; done++; beep(true);
          if (done === pairs.length) { info.textContent = "Done! Mistakes: " + miss; record("match", Math.max(0, pairs.length - miss), pairs.length); if (!miss) confetti(); }
        } else { miss++; beep(false); nudge(b); }
      };
      return b;
    };
    pairs.forEach((p, k) => L.append(tile(p[0], k, true)));
    shuffle(pairs.map((p, k) => [p[1], k])).forEach(([t, k]) => R.append(tile(t, k, false)));
    board.replaceChildren(L, R); info.textContent = "";
  };
  body.append(board, el("div", { class: "actions" }, el("button", { class: "ghost", onclick: round }, "🔄 New round"), info));
  round();
}

function memoryGame() {
  const body = gameCard("memory", "games", "🃏 Memory", "Find the pairs: an English word and its Uzbek meaning.");
  const grid = el("div", { class: "memory" }), info = el("span", { class: "score" });
  const round = () => {
    const pairs = pick(UNIT.words, 6);
    const cards = shuffle(pairs.flatMap((w, k) => [[w[0], k, true], [w[1], k, false]]));
    let open = [], found = 0, moves = 0, lock = false;
    grid.replaceChildren(...cards.map(([t, k, en]) => {
      const c = el("button", { class: "mem" }, el("span", {}, t));
      c.onclick = () => {
        if (lock || c.classList.contains("up")) return;
        c.classList.add("up"); if (en) say(t); open.push([c, k]);
        if (open.length < 2) return;
        moves++; const [[a, ka], [b, kb]] = open; open = [];
        if (ka === kb) {
          a.classList.add("found"); b.classList.add("found"); found++; beep(true);
          if (found === pairs.length) { info.textContent = "Done in " + moves + " moves!"; record("memory", pairs.length, moves); if (moves <= 9) confetti(); return; }
        } else { lock = true; setTimeout(() => { a.classList.remove("up"); b.classList.remove("up"); lock = false; }, 900); }
        info.textContent = "Moves: " + moves;
      };
      return c;
    }));
    info.textContent = "Moves: 0";
  };
  body.append(grid, el("div", { class: "actions" }, el("button", { class: "ghost", onclick: round }, "🔄 New game"), info));
  round();
}

function orderGame() {
  const pool = shortSentences(4, 11);
  if (pool.length < 3) return;
  const body = gameCard("order", "games", "🔀 Word order", "Tap the words in the right order to make a sentence.");
  const box = el("div");
  let list = [], i = 0, ok = 0;
  const start = () => { list = pick(pool, 5); i = 0; ok = 0; draw(); };
  const draw = () => {
    if (i >= list.length) {
      box.replaceChildren(el("p", { class: "big" }, "Result: " + ok + " / " + list.length + " " + starText(starsFor({ ok, n: list.length }))));
      record("order", ok, list.length); if (ok === list.length) confetti(); return;
    }
    const target = list[i], words = target.split(" "), ans = el("div", { class: "answer" }), bank = el("div", { class: "chips" }), fb = el("p", { class: "fb" });
    let tries = 0, sh = shuffle(words);
    if (sh.join(" ") === target) sh = sh.reverse();
    sh.forEach(w => { const b = el("button", { class: "chip" }, w); b.onclick = () => (b.parentNode === bank ? ans : bank).append(b); bank.append(b); });
    const next = ms => { chk.disabled = true; setTimeout(() => { i++; draw(); }, ms); };
    const chk = el("button", { onclick: () => {
      const got = [...ans.children].map(c => c.textContent).join(" ");
      if (loose(got) === loose(target)) { if (!tries) ok++; beep(true); fb.textContent = "✔ Correct!"; fb.className = "fb good"; say(target); next(1300); }
      else {
        tries++; beep(false); ans.classList.add("shake"); setTimeout(() => ans.classList.remove("shake"), 400);
        fb.className = "fb bad"; fb.textContent = tries >= 2 ? "✘ Answer: " + target : "✘ Not quite — try again.";
        if (tries >= 2) next(2600);
      } } }, "Check");
    box.replaceChildren(el("p", { class: "inst" }, "Sentence " + (i + 1) + " / " + list.length), ans, bank,
      el("div", { class: "actions" }, chk, el("button", { class: "ghost", onclick: () => say(target) }, "🔊 Hint"), fb));
  };
  body.append(box, el("div", { class: "actions" }, el("button", { class: "ghost", onclick: start }, "🔄 Restart")));
  start();
}

function speedQuiz() {
  const body = gameCard("speed", "games", "⚡ Speed quiz", "Answer as many questions as you can in 60 seconds!");
  const idle = () => body.replaceChildren(el("p", { class: "big" }, "🏆 Best score: " + ((pageScores().speed || {}).ok || 0)),
    el("button", { class: "big-btn", onclick: run }, "▶ Start"));
  const run = () => {
    let score = 0, answered = 0, streak = 0, left = 60, q = 0;
    const qs = shuffle(UNIT.mc), bar = el("i"), head = el("p", { class: "big" }), qEl = el("p", { class: "q-big" }), opts = el("div", { class: "opts-big" });
    body.replaceChildren(el("div", { class: "timer" }, bar), head, qEl, opts);
    const status = () => (head.textContent = "⏱ " + left + "s · Score " + score + " · 🔥 " + streak);
    const tick = setInterval(() => { left--; bar.style.width = (left / 60) * 100 + "%"; status(); if (left <= 0) { clearInterval(tick); end(); } }, 1000);
    const next = () => {
      if (left <= 0) return;
      const [question, options, id] = qs[q++ % qs.length];
      qEl.innerHTML = esc(question).replace("___", '<span class="blank">______</span>'); status();
      opts.replaceChildren(...shuffle(options).map(o => el("button", { class: "tile", onclick: e => {
        if (left <= 0) return;
        answered++; const good = o === options[0];
        if (good) { score++; streak++; } else { streak = 0; logMistake(id); }
        beep(good);
        e.currentTarget.classList.add(good ? "matched" : "wrong");
        opts.querySelectorAll("button").forEach(b => { b.disabled = true; if (b.textContent === options[0]) b.classList.add("matched"); });
        setTimeout(next, good ? 350 : 1000);
      } }, o)));
    };
    const end = () => {
      const best = (pageScores().speed || {}).ok || 0;
      record("speed", score, Math.max(answered, 1), true);
      if (score > best) confetti();
      body.replaceChildren(el("p", { class: "big" }, "⏰ Time's up! Score: " + score + " (" + answered + " answered)" + (score > best ? " — new record! 🎉" : "")),
        el("button", { class: "big-btn", onclick: run }, "🔄 Play again"));
    };
    next();
  };
  idle();
}

function dictation() {
  const pool = shortSentences(3, 9).filter(x => !/\d/.test(x));
  if (!("speechSynthesis" in window) || pool.length < 3) return;
  const body = gameCard("dictation", "listen", "🎧 Dictation", "Listen and write the sentence. Press 🔊 as many times as you need (🐢 = slowly).");
  const round = () => {
    const list = pick(pool, 5), ol = el("ol"), info = el("span", { class: "score" });
    list.forEach(t => {
      const inp = el("input", { type: "text", autocomplete: "off", spellcheck: "false" });
      ol.append(el("li", { class: "q" }, el("div", { class: "dict" },
        el("button", { class: "ghost", onclick: () => say(t) }, "🔊"), el("button", { class: "ghost", onclick: () => say(t, 0.55) }, "🐢"), inp), el("p", { class: "fb bad" })));
    });
    body.replaceChildren(ol, el("div", { class: "actions" }, el("button", { onclick: () => {
      let ok = 0;
      [...ol.children].forEach((li, k) => {
        const good = loose(li.querySelector("input").value) === loose(list[k]); ok += good;
        li.classList.remove("ok", "bad"); void li.offsetWidth; li.classList.add(good ? "ok" : "bad");
        li.querySelector(".fb").textContent = good ? "" : "→ " + list[k];
      });
      info.textContent = ok + " / " + list.length; beep(ok === list.length); record("dictation", ok, list.length); if (ok === list.length) confetti();
    } }, "Check"), el("button", { class: "ghost", onclick: round }, "🔄 New sentences"), info));
  };
  round();
}

function similarity(heard, target) {
  const h = new Set(loose(heard).split(" ")), t = loose(target).split(" ").filter(Boolean);
  return t.filter(w => h.has(w)).length / t.length;
}
function speaking() {
  const items = UNIT.kind === "vocab" ? UNIT.words.map(w => w[0].split(" / ")[0]) : shortSentences(3, 8).filter(x => !/\d/.test(x));
  if (items.length < 3) return;
  const body = gameCard("speak", "listen", "🎤 Say it!", SR ? "Press 🔊 to listen, then 🎤 and say it. The computer checks your pronunciation."
    : "Press 🔊 to listen and repeat aloud. (Microphone checking works when you open the downloaded file in Google Chrome.)");
  const round = () => {
    const list = pick(items, 6), passed = new Set(), info = el("span", { class: "score" });
    const rows = list.map(t => {
      const res = el("span", { class: "fb" }), row = el("div", { class: "speak-row" }, el("b", {}, t), el("button", { class: "ghost", onclick: () => say(t) }, "🔊"));
      if (SR) {
        const mic = el("button", { class: "ghost", onclick: () => {
          try {
            const r = new SR(); r.lang = "en-GB"; r.maxAlternatives = 3;
            r.onresult = e => {
              const alts = [...e.results[0]].map(a => a.transcript), good = Math.max(...alts.map(a => similarity(a, t))) >= 0.75;
              res.textContent = (good ? "✔ " : "✘ ") + "I heard: \"" + alts[0] + "\""; res.className = "fb " + (good ? "good" : "bad"); beep(good);
              row.style.background = good ? "var(--gbg)" : "var(--rbg)";
              if (good) { passed.add(t); info.textContent = passed.size + " / " + list.length; record("speak", passed.size, list.length); if (passed.size === list.length) confetti(); }
            };
            r.onerror = () => { res.textContent = "🎤 Microphone is not available."; res.className = "fb bad"; };
            r.onend = () => mic.classList.remove("rec");
            mic.classList.add("rec"); r.start();
          } catch (e) { res.textContent = "🎤 Microphone is not available."; }
        } }, "🎤");
        row.append(mic);
      }
      row.append(res);
      return row;
    });
    body.replaceChildren(...rows, el("div", { class: "actions" }, el("button", { class: "ghost", onclick: round }, "🔄 New words"), info));
  };
  round();
}

function initUnit() {
  if (typeof UNIT === "undefined") return;
  if (UNIT.kind === "vocab") flashcards();
  matchGame();
  if (UNIT.kind === "vocab") memoryGame();
  orderGame();
  speedQuiz();
  dictation();
  speaking();
  const area = document.getElementById("listen-area");
  if (area && !area.children.length) area.append(el("p", { class: "card" }, "Your browser does not support speech. Try Google Chrome."));
}

/* ---------- index dashboard ---------- */
const LEVELS = ["Beginner", "Explorer", "Learner", "Achiever", "Rising star", "Champion", "Master", "Legend"];
function streak(days) {
  const set = new Set(days), d = new Date();
  if (!set.has(dayKey(d))) d.setDate(d.getDate() - 1);
  let k = 0;
  while (set.has(dayKey(d))) { k++; d.setDate(d.getDate() - 1); }
  return k;
}
function initIndex() {
  if (!document.getElementById("dash")) return;
  const all = Store.get("scores", {});
  let xp = 0, stars = 0, tests = 0, reviews = 0, perfect = false, speed = 0, ears = false;
  for (const [page, secs] of Object.entries(all)) for (const [sec, s] of Object.entries(secs)) {
    xp += s.ok * 10;
    if (sec === "speed") speed = Math.max(speed, s.ok);
    if (sec === "dictation" && s.ok === s.n) ears = true;
    if (sec === "test" && s.ok === s.n) perfect = true;
    if (sec === "p1" && page.startsWith("review")) reviews++;
  }
  const g = [], v = [];
  document.querySelectorAll("a.unit").forEach(c => {
    const p = all[c.dataset.page] || {}, s = p.test || p.p1, k = starsFor(s);
    stars += k; c.querySelector(".stars").textContent = starText(k); c.classList.toggle("done", !!s);
    if (c.dataset.kind === "grammar" || c.dataset.kind === "vocab") { if (p.test) tests++; (c.dataset.kind === "grammar" ? g : v).push(pct(p.test) >= 70); }
  });
  const lv = Math.floor(xp / 500), days = streak(Store.get("days", []));
  const set = (id, t) => (document.getElementById(id).textContent = t);
  set("st-xp", xp); set("st-level", "Level " + (lv + 1));
  set("st-level-name", LEVELS[Math.min(lv, LEVELS.length - 1)] + " · " + (500 - (xp % 500)) + " XP to next level");
  set("st-stars", stars); set("st-streak", days); set("st-units", tests + " / 42");
  const mist = Store.get("mistakes", {}), today = dayKey(new Date()), n = Object.keys(mist).length;
  const due = Object.values(mist).filter(x => x.d <= today).length;
  if (n) set("st-due", due ? "⏰ " + due + " questions to review today" : n + " saved · nothing due today");
  setTimeout(() => (document.getElementById("bar-units").style.width = (tests / 42) * 100 + "%"), 50);
  const badges = [
    ["🚀", "First steps", "Finish any exercise", xp > 0],
    ["🎯", "Perfect 10", "Get 10/10 in a unit test", perfect],
    ["📘", "Grammar guru", "70%+ in all grammar tests", g.length > 0 && g.every(Boolean)],
    ["📗", "Word wizard", "70%+ in all vocabulary tests", v.length > 0 && v.every(Boolean)],
    ["🔁", "Reviewer", "Finish 5 reviews", reviews >= 5],
    ["🏁", "Halfway", "Finish 21 unit tests", tests >= 21],
    ["👑", "Champion", "Finish all 42 unit tests", tests >= 42],
    ["🔥", "On fire", "Study 3 days in a row", days >= 3],
    ["⚡", "Speedster", "15+ in a speed quiz", speed >= 15],
    ["🎧", "Good ears", "Perfect dictation", ears],
  ];
  document.getElementById("badges").replaceChildren(...badges.map(([e, t, d, on]) =>
    el("div", { class: "badge" + (on ? "" : " off"), title: d }, el("em", {}, e), el("div", {}, el("b", {}, t), el("br"), el("small", {}, d)))));
  const rb = document.getElementById("reset");
  rb.onclick = () => {
    if (!rb.dataset.armed) { rb.dataset.armed = "1"; rb.textContent = "Click again to delete all progress"; return; }
    Store.set("scores", {}); Store.set("days", []); location.reload();
  };
}

/* ---------- classroom quiz ---------- */
function initQuiz() {
  const root = document.getElementById("quiz");
  if (!root) return;
  const pre = new URLSearchParams(location.search).get("units");
  const preset = pre ? pre.split(",").map(Number) : null;
  let timer = null;
  const setup = () => {
    clearInterval(timer); document.onkeydown = null;
    const boxes = QUIZ.map(u => el("label", {}, el("input", Object.assign({ type: "checkbox", value: u.n }, !preset || preset.includes(u.n) ? { checked: "" } : {})), " " + u.n + ". " + u.title));
    const count = el("select", {}, ...[10, 15, 20, 30].map(k => el("option", k === 15 ? { value: k, selected: "" } : { value: k }, k + " questions")));
    const secs = el("select", {}, ...[10, 20, 30, 45].map(k => el("option", k === 20 ? { value: k, selected: "" } : { value: k }, k + " seconds")));
    const teamsBox = el("div", { class: "actions" });
    const teamN = el("select", {}, ...[2, 3, 4].map(k => el("option", { value: k }, k + " teams")));
    const drawTeams = () => teamsBox.replaceChildren(...Array.from({ length: +teamN.value }, (_, i) => el("input", { type: "text", value: ["Lions", "Eagles", "Tigers", "Wolves"][i] })));
    teamN.onchange = drawTeams; drawTeams();
    const all = on => boxes.forEach(b => (b.firstChild.checked = on));
    const warn = el("p", { class: "fb bad" });
    root.replaceChildren(el("section", { class: "card" }, el("h2", {}, "1. Choose units"),
      el("div", { class: "actions" }, el("button", { class: "ghost", onclick: () => all(true) }, "All"), el("button", { class: "ghost", onclick: () => all(false) }, "None")),
      el("div", { class: "qz-units" }, ...boxes),
      el("h2", { style: "margin-top:14px" }, "2. Settings"), el("div", { class: "actions" }, count, secs, teamN), teamsBox,
      el("div", { class: "actions" }, el("button", { class: "big-btn", onclick: () => {
        const units = boxes.filter(b => b.firstChild.checked).map(b => +b.firstChild.value);
        const pool = QUIZ.filter(u => units.includes(u.n)).flatMap(u => u.items);
        if (!pool.length) { warn.textContent = "Choose at least one unit."; return; }
        const teams = [...teamsBox.querySelectorAll("input")].map((t, i) => ({ name: t.value.trim() || "Team " + (i + 1), score: 0, got: false }));
        play(pick(pool, Math.min(+count.value, pool.length)), teams, +secs.value);
      } }, "▶ Start the quiz"), warn)));
  };
  const play = (qs, teams, secs) => {
    let i = 0;
    const board = () => el("div", { class: "qz-teams" }, ...teams.map(t => el("span", { class: "pill", style: "background:var(--accent)" }, t.name + ": " + t.score)));
    const show = () => {
      clearInterval(timer);
      if (i >= qs.length) return end(teams);
      const [q, options] = qs[i], opts = shuffle(options);
      let left = secs, revealed = false;
      const bar = el("i"), clock = el("b", {}, "⏱ " + left);
      const tiles = opts.map((o, k) => el("button", { class: "qz-opt c" + k }, "ABC"[k] + ")  " + o));
      const teamBtns = el("div", { class: "qz-teams" }), act = el("div", { class: "actions", style: "justify-content:center" });
      const qEl = el("div", { class: "qz-q" });
      qEl.innerHTML = esc(q).replace("___", '<span class="blank">______</span>');
      const nextQ = () => { teams.forEach(t => { if (t.got) t.score++; t.got = false; }); i++; show(); };
      const doReveal = () => {
        if (revealed) return;
        revealed = true; clearInterval(timer); beep(true);
        tiles.forEach((t, k) => t.classList.add(opts[k] === options[0] ? "win" : "dim"));
        teamBtns.replaceChildren(el("span", { class: "inst" }, "Who got it right? (keys 1–" + teams.length + ")"), ...teams.map(t => {
          const b = el("button", { class: "qz-team ghost", onclick: () => { t.got = !t.got; b.classList.toggle("got", t.got); } }, "+1 " + t.name);
          return b;
        }));
        act.replaceChildren(el("button", { class: "big-btn", onclick: nextQ }, i + 1 < qs.length ? "Next ▶" : "🏆 Results"));
      };
      act.append(el("button", { class: "big-btn", onclick: doReveal }, "Show answer"));
      root.replaceChildren(el("section", { class: "card" },
        el("div", { class: "actions", style: "justify-content:space-between" }, el("b", {}, "Question " + (i + 1) + " / " + qs.length), clock),
        el("div", { class: "timer" }, bar), qEl, el("div", { class: "qz-opts" }, ...tiles), act, teamBtns, board()));
      timer = setInterval(() => { left--; clock.textContent = "⏱ " + left; bar.style.width = (left / secs) * 100 + "%"; if (left <= 0) doReveal(); }, 1000);
      document.onkeydown = e => {
        if (e.key === " " || e.key === "Enter") { e.preventDefault(); revealed ? nextQ() : doReveal(); }
        const k = +e.key;
        if (revealed && k >= 1 && k <= teams.length) teamBtns.querySelectorAll("button")[k - 1].click();
      };
    };
    show();
  };
  const end = teams => {
    document.onkeydown = null; confetti(); beep(true);
    const sorted = teams.slice().sort((a, b) => b.score - a.score), medals = ["🥇", "🥈", "🥉", "🏅"];
    root.replaceChildren(el("section", { class: "card", style: "text-align:center" }, el("h2", {}, "🏆 Results"),
      el("div", { class: "podium" }, ...sorted.map((t, k) => el("div", {}, medals[k] + " " + t.name + " — " + t.score))),
      el("button", { class: "big-btn", onclick: setup }, "🔄 New quiz")));
  };
  setup();
}

document.addEventListener("click", e => { const b = e.target.closest("button.say"); if (b) say(b.dataset.say); });
document.addEventListener("DOMContentLoaded", () => {
  const snd = document.getElementById("sound");
  if (snd) snd.textContent = Store.get("sound", true) ? "🔊" : "🔇";
  if (EMBEDDED) document.querySelectorAll(".noprint button").forEach(b => b.replaceWith(el("span", { class: "inst" }, "To print, download this page and open it in your browser.")));
  initTabs(); initUnit(); updateHero(); initIndex(); initQuiz(); initMistakes(); initDownloads();
});
if ("speechSynthesis" in window) speechSynthesis.getVoices();
