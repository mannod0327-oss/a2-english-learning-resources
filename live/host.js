"use strict";
/* Teacher / projector screen of the live quiz. One scene per game state; the server sends a full
   snapshot after every change and this file only draws it. */

(async function () {
  const app = $("#app");
  const setLink = linkBanner();
  let info, game = LS.get("live-host", null);
  let stopFollow = null, scene = null, sceneKey = "", count = null;
  const seen = new Set();            // player ids already shown, so only newcomers pop in

  try {
    info = await api("/api/info");
  } catch (e) {
    app.replaceChildren(h("p", { class: "err" }, e.message));
    return;
  }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname);
  const joinUrls = info.join.length ? info.join : (local ? [] : [location.origin + "/play"]);

  /* ---------- helpers ---------- */
  const forget = () => { game = null; LS.del("live-host"); };
  const reset = () => {
    if (stopFollow) stopFollow();
    if (count) count.stop();
    stopFollow = scene = count = null;
    sceneKey = "";
    seen.clear();
  };
  const mount = (key, build, s) => {
    if (key !== sceneKey) {
      if (count) { count.stop(); count = null; }
      scene = build(s);
      sceneKey = key;
      app.replaceChildren(scene.el);
    }
    if (scene.update) scene.update(s);
  };
  const topbar = s => h("div", { class: "top" },
    h("span", { class: "brand" }, "🎯 Live quiz"),
    s ? h("span", { class: "muted" }, "PIN " + fmtPin(s.pin)) : null,
    h("span", { class: "spacer" }),
    s ? h("button", { class: "btn ghost small", onclick: endGame }, "End game") : null);
  const post = (action, body) => api(`/api/games/${game.pin}/${action}`, { key: game.key, ...body });
  const quiet = promise => promise.catch(() => {});      // a double tap can arrive late: ignore 409s

  async function endGame() {
    if (!confirm("End this game for everyone?")) return;
    try { await post("end"); } catch (e) { /* already gone */ }
    forget();
    setup();
  }

  /* ---------- setup ---------- */
  function setup(message) {
    reset();
    const prefs = LS.get("live-setup", {});
    const asked = (new URLSearchParams(location.search).get("units") || "").split(",").map(Number)
      .filter(n => info.units.some(u => u.n === n));
    const chosen = new Set(asked.length ? asked : (prefs.units || []).filter(n => info.units.some(u => u.n === n)));
    const [cMin, cMax, cDef] = info.count;

    const boxes = info.units.map(u => {
      const input = h("input", { type: "checkbox", value: u.n });
      input.checked = chosen.has(u.n);
      input.addEventListener("change", refresh);
      return { u, input, el: h("label", { class: "unit" }, input, h("b", {}, u.n), h("span", { title: u.title }, u.title)) };
    });
    const pickRange = (from, to) => { boxes.forEach(b => (b.input.checked = b.u.n >= from && b.u.n <= to)); refresh(); };
    const slider = h("input", { type: "range", min: cMin, max: cMax, value: Math.min(cMax, Math.max(cMin, prefs.count || cDef)), oninput: refresh });
    const secs = h("select", { class: "input" }, info.secs.map(n => h("option", { value: n }, n + " seconds")));
    secs.value = info.secs.includes(prefs.secs) ? prefs.secs : 20;
    const teams = h("select", { class: "input" }, info.teams.map(n => h("option", { value: n }, n ? n + " teams" : "No teams (everyone alone)")));
    teams.value = info.teams.includes(prefs.teams) ? prefs.teams : 0;
    const summary = h("p", { class: "muted" }), error = h("p", { class: "err hidden" });
    const create = h("button", { class: "btn go", onclick: make }, "Create game");

    function selected() { return boxes.filter(b => b.input.checked).map(b => b.u.n); }
    function refresh() {
      const units = selected(), pool = boxes.filter(b => b.input.checked).reduce((t, b) => t + b.u.count, 0);
      const n = Math.min(Number(slider.value), pool);
      summary.textContent = units.length
        ? `${n} questions from ${units.length} unit${units.length > 1 ? "s" : ""} (${pool} available)`
        : "Pick at least one unit.";
      create.disabled = !units.length;
    }
    async function make() {
      const units = selected(), body = { units, count: Number(slider.value), secs: Number(secs.value), teams: Number(teams.value) };
      create.disabled = true;
      error.classList.add("hidden");
      try {
        const made = await api("/api/games", body);
        LS.set("live-setup", body);
        game = { pin: made.pin, key: made.key };
        LS.set("live-host", game);
        connect();
      } catch (e) {
        error.textContent = e.message;
        error.classList.remove("hidden");
        create.disabled = false;
      }
    }

    const el = h("div", { class: "stack" },
      topbar(null),
      h("h1", {}, "New live game ", h("small", { class: "muted", style: "font-size:.5em" }, "Yangi o'yin")),
      message ? h("p", { class: "err" }, message) : null,
      h("section", { class: "card" },
        h("div", { class: "row" }, h("h2", {}, "1 · Units ", h("small", { class: "muted" }, "Unitlarni tanlang")), h("span", { class: "spacer" }),
          h("button", { class: "btn small", onclick: () => pickRange(1, 42) }, "All"),
          h("button", { class: "btn small", onclick: () => pickRange(0, 0) }, "None"),
          h("button", { class: "btn small", onclick: () => pickRange(1, 14) }, "1–14"),
          h("button", { class: "btn small", onclick: () => pickRange(15, 28) }, "15–28"),
          h("button", { class: "btn small", onclick: () => pickRange(29, 42) }, "29–42")),
        h("div", { class: "units", style: "margin-top:12px" }, boxes.map(b => b.el))),
      h("section", { class: "card" }, h("h2", {}, "2 · Game ", h("small", { class: "muted" }, "Sozlamalar")),
        h("div", { class: "settings", style: "margin-top:12px" },
          h("div", { class: "field" }, h("label", {}, "Questions · Savollar soni"), slider, summary),
          h("div", { class: "field" }, h("label", {}, "Time per question · Vaqt"), secs),
          h("div", { class: "field" }, h("label", {}, "Teams · Jamoalar"), teams))),
      error,
      h("div", { class: "row" }, create,
        h("span", { class: "muted note" }, "Students join with their phones. Questions come from the units you pick (right answer at a random place).")));
    scene = { el, primary: () => !create.disabled && make() };
    sceneKey = "setup";
    app.replaceChildren(el);
    refresh();
  }

  /* ---------- connecting ---------- */
  function connect() {
    reset();
    app.replaceChildren(h("p", { class: "muted" }, "Connecting…"));
    const key = encodeURIComponent(game.key);
    stopFollow = follow(`/api/games/${game.pin}/host/events?key=${key}`, {
      check: `/api/games/${game.pin}/check?key=${key}`,
      onSnap: show,
      onLink: setLink,
      onGone: () => { forget(); setup("That game is no longer running."); },
    });
  }

  function show(s) {
    if (s.state === "ended") { forget(); setup("The game was ended."); return; }
    if (s.state === "lobby") return mount("lobby", lobbyScene, s);
    if (s.state === "final") return mount("final", finalScene, s);
    const key = (s.state === "question" ? "q:" : "r:") + s.question.index;
    mount(key, s.state === "question" ? questionScene : revealScene, s);
  }

  /* ---------- lobby ---------- */
  function qrBox(text) {
    const box = h("div", { class: "qr", role: "img", "aria-label": "QR code: scan to join" });
    try {
      const qr = qrcode(0, "M");
      qr.addData(text);
      qr.make();
      box.innerHTML = qr.createSvgTag({ cellSize: 4, margin: 0, scalable: true });   // numbers and our own URL only
    } catch (e) {
      box.hidden = true;
    }
    return box;
  }

  function lobbyScene(s) {
    const url = joinUrls[0];
    const start = h("button", { class: "btn go", onclick: () => quiet(post("start")) }, "Start ▶");
    const people = h("div", {}), total = h("span", {});
    const chip = p => {
      const c = h("span", { class: "chip" + (seen.has(p.id) ? "" : " new") }, p.name,
        h("button", { class: "x", title: "Remove " + p.name, "aria-label": "Remove " + p.name, onclick: () => quiet(post("kick", { pid: p.id })) }, "×"));
      seen.add(p.id);
      return c;
    };
    const el = h("div", { class: "stack" },
      topbar(s),
      h("div", { class: "lobby-grid" },
        h("div", {},
          url ? h("p", { class: "lbl" }, "Join on your phone:") : null,
          url ? h("p", { class: "join-url" }, url.replace(/^http:\/\//, ""))
            : h("p", { class: "err" }, "No network address found. Turn on the hotspot on your phone, connect this computer to it and start live.py again. (Telefonda hotspot yoqing, kompyuterni ulang.)"),
          joinUrls.length > 1 ? h("p", { class: "muted note" }, "Other addresses of this computer: " + joinUrls.slice(1).map(u => u.replace(/^http:\/\//, "")).join("  ·  ")) : null,
          h("p", { class: "pin-label" }, "Game PIN"),
          h("div", { class: "pin" }, fmtPin(s.pin))),
        url ? qrBox(`${url}?pin=${s.pin}`) : null),
      h("section", { class: "card" },
        h("div", { class: "row" }, h("h2", {}, "Players ", total), h("span", { class: "spacer" }),
          h("span", { class: "muted note" }, `${s.total} questions · ${s.secs} s each` + (s.teams.length ? ` · ${s.teams.length} teams` : "")),
          start),
        h("div", { style: "margin-top:12px" }, people)));
    return {
      el,
      primary: () => !start.disabled && start.click(),
      update(snap) {
        total.textContent = "(" + snap.players.length + ")";
        start.disabled = !snap.players.length;
        if (!snap.players.length) { people.replaceChildren(h("p", { class: "muted" }, "Waiting for players…")); return; }
        if (!snap.teams.length) { people.replaceChildren(h("div", { class: "chips" }, snap.players.map(chip))); return; }
        people.replaceChildren(h("div", { class: "teams" }, snap.teams.map((name, t) => {
          const members = snap.players.filter(p => p.team === t);
          return h("div", { class: "team-col", style: `--tc:${TEAM_COLORS[t]}` }, h("h3", {}, `${name} · ${members.length}`),
            h("div", { class: "chips" }, members.map(chip)));
        })));
      },
    };
  }

  /* ---------- question ---------- */
  const optionTiles = (q, extra) => q.options.map((text, i) => h("div", { class: "opt o" + i + (extra ? extra(i) : "") },
    h("span", { class: "shape" }, SHAPES[i]), h("span", {}, text)));

  function questionScene(s) {
    const q = s.question, bar = h("i"), num = h("span", { class: "timer" }), answered = h("span", {});
    const skip = h("button", { class: "btn small", onclick: () => quiet(post("next", { state: "question", index: q.index })) }, "Show answer ⏭");
    count = startCountdown(bar, num, s.remaining_ms, s.secs);
    const el = h("div", { class: "stack" },
      topbar(s),
      h("div", { class: "qhead" }, h("span", {}, `Question ${q.index + 1} / ${q.total}`), num, answered, h("span", { class: "spacer" }), skip),
      h("div", { class: "bar" }, bar),
      h("div", { class: "qtext" }, withBlanks(q.text)),
      h("div", { class: "opts" }, optionTiles(q)));
    return {
      el, primary: () => skip.click(),
      update(snap) {
        answered.textContent = `${snap.answered} / ${snap.players.length} answered`;
        if (count) count.sync(snap.remaining_ms);
      },
    };
  }

  /* ---------- reveal ---------- */
  function boardRows(rows) {
    return rows.map(r => h("div", { class: "brow" },
      r.team != null ? h("span", { class: "tag", style: `--tc:${TEAM_COLORS[r.team]}` }) : null,
      h("span", { class: "n" }, r.name),
      r.gained ? h("span", { class: "gain" }, "+" + r.gained) : null,
      r.streak >= 2 ? h("span", { class: "fire", title: r.streak + " in a row" }, "🔥" + r.streak) : null,
      h("span", {}, r.score)));
  }
  const teamRows = teams => teams.map(t => h("div", { class: "brow" },
    h("span", { class: "tag", style: `--tc:${TEAM_COLORS[t.team]}` }), h("span", { class: "n" }, t.name),
    h("span", { class: "muted", style: "font-size:.9rem" }, t.players + " players"), h("span", {}, t.score)));

  function revealScene(s) {
    const q = s.question, top = Math.max(1, ...s.counts);
    const next = h("button", { class: "btn go", onclick: () => quiet(post("next", { state: "reveal", index: q.index })) },
      s.last ? "Show podium 🏆" : "Next question ▶");
    const tiles = q.options.map((text, i) => h("div", { class: "opt o" + i + (i === q.correct ? " right" : " dim") },
      h("div", { class: "fill", style: `width:${Math.round(100 * s.counts[i] / top)}%` }),
      h("span", { class: "shape" }, SHAPES[i]), h("span", {}, text), h("span", { class: "count" }, s.counts[i])));
    const el = h("div", { class: "stack" },
      topbar(s),
      h("div", { class: "qhead" }, h("span", {}, `Question ${q.index + 1} / ${q.total}`), h("span", { class: "spacer" }), next),
      h("div", { class: "qtext" }, withBlanks(q.text, q.options[q.correct])),
      h("div", { class: "opts" }, tiles),
      h("div", { class: "reveal-cols" },
        h("section", { class: "card" }, h("h2", { style: "margin-bottom:10px" }, "Leaderboard"), h("div", { class: "board" }, boardRows(s.board))),
        s.teams.length ? h("section", { class: "card" }, h("h2", { style: "margin-bottom:10px" }, "Teams"), h("div", { class: "board" }, teamRows(s.team_board))) : null));
    return { el, primary: () => next.click() };
  }

  /* ---------- podium ---------- */
  async function download() {
    try {
      const res = await fetch(`/api/games/${game.pin}/results.csv?key=${encodeURIComponent(game.key)}`);
      if (!res.ok) throw new Error(res.status);
      const url = URL.createObjectURL(await res.blob());
      const a = h("a", { href: url, download: `live-results-${game.pin}.csv` });
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (e) {
      alert("The results file could not be downloaded. It is also saved in the live-results folder.");
    }
  }

  function finalScene(s) {
    const medal = ["🥇", "🥈", "🥉"];
    const order = [1, 0, 2].filter(i => s.board[i]);                   // 2nd, 1st, 3rd
    const step = i => {
      const r = s.board[i];
      return h("div", { class: "step p" + (i + 1) }, h("div", { class: "who" }, r.name), h("div", { class: "pts" }, r.score + " pts"),
        h("div", { class: "block" }, medal[i]));
    };
    const finish = h("button", { class: "btn go", onclick: () => { forget(); setup(); } }, "New game");
    const el = h("div", { class: "stack" },
      topbar(s),
      h("h1", { style: "text-align:center" }, "🏆 Final results"),
      h("div", { class: "podium" }, order.map(step)),
      s.teams.length ? h("section", { class: "card" }, h("h2", { style: "margin-bottom:10px" }, "Teams"),
        h("div", { class: "board" }, teamRows(s.team_board))) : null,
      s.board.length > 3 ? h("section", { class: "card" }, h("table", { class: "table" },
        h("thead", {}, h("tr", {}, h("th", {}, "#"), h("th", {}, "Name"), h("th", { class: "num" }, "Correct"), h("th", { class: "num" }, "Score"))),
        h("tbody", {}, s.board.slice(3).map(r => h("tr", {}, h("td", {}, r.rank), h("td", {}, r.name),
          h("td", { class: "num" }, r.correct + " / " + s.total), h("td", { class: "num" }, r.score)))))) : null,
      h("div", { class: "row" }, h("button", { class: "btn", onclick: download }, "⬇ Results (.csv)"), finish),
      h("p", { class: "muted note" }, "The CSV has every player's score and answers, and for each question how many got it right: the low ones are what to teach again."),
      h("p", { class: "muted note", id: "saved" }));
    return {
      el, primary: () => finish.click(),
      update(snap) { $("#saved").textContent = snap.saved ? "Also saved on this computer: " + snap.saved : ""; },
    };
  }

  /* ---------- keyboard: Space / Enter = the big button ---------- */
  document.addEventListener("keydown", e => {
    if (!scene || !scene.primary || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target.closest && e.target.closest("input, select, textarea, button, a")) return;
    if (e.key === " " || e.key === "Enter") { e.preventDefault(); scene.primary(); }
  });

  if (game) connect(); else setup();
})();
