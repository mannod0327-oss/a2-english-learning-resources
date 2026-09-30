"use strict";
/* Student screen of the live quiz (a phone, most of the time). The server sends a full snapshot
   after every change; this file draws it and sends the one thing a student does: an answer. */

(function () {
  const app = $("#app");
  const setLink = linkBanner();
  let session = LS.get("live-session", null);
  let stopFollow = null, scene = null, sceneKey = "", count = null, score = 0;

  /* ---------- helpers ---------- */
  const forget = () => { session = null; LS.del("live-session"); };
  const reset = () => {
    if (stopFollow) stopFollow();
    if (count) count.stop();
    stopFollow = scene = count = null;
    sceneKey = "";
  };
  const mount = (key, build, s) => {
    if (key !== sceneKey) {
      if (count) { count.stop(); count = null; }
      scene = build(s);
      sceneKey = key;
      app.replaceChildren(scene.el);
      window.scrollTo(0, 0);
    }
    if (scene.update) scene.update(s);
  };
  const buzz = pattern => { try { if (navigator.vibrate) navigator.vibrate(pattern); } catch (e) { /* not supported */ } };
  const dayKey = d => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");

  /* The practice site's "My mistakes" notebook lives in this same origin (the server serves the site
     at "/"), under the key dA2:mistakes with this exact shape. */
  function logMistake(id) {
    const all = LS.get("dA2:mistakes", {});
    const old = all[id];
    all[id] = { b: 0, d: dayKey(new Date()), w: (old ? old.w : 0) + 1 };
    LS.set("dA2:mistakes", all);
  }
  const loggedFor = pin => LS.get("live-logged", []).filter(k => k.startsWith(pin + ":")).length;
  function saveIfWrong(s) {
    if (s.result.right !== false || !LS.get("live-save", true)) return false;
    const mark = s.pin + ":" + s.question.index, done = LS.get("live-logged", []);
    if (!done.includes(mark)) {
      logMistake(s.question.id);
      LS.set("live-logged", done.concat(mark).slice(-400));
    }
    return true;
  }

  const teamBadge = s => s.team ? h("span", { class: "team-badge" + (s.team_index === 2 ? " gold" : ""), style: `--tc:${TEAM_COLORS[s.team_index]}` }, s.team) : null;
  const head = s => h("div", { class: "pbar" }, h("span", { class: "who" }, s.name), teamBadge(s), h("span", { class: "spacer" }), h("span", {}, score + " pts"));
  const goJoin = message => { forget(); join(message); };

  /* ---------- join ---------- */
  function join(message) {
    reset();
    const params = new URLSearchParams(location.search);
    const pin = h("input", { class: "input pin-input", inputmode: "numeric", pattern: "[0-9]*", maxlength: 6, autocomplete: "off", placeholder: "Game PIN", "aria-label": "Game PIN" });
    pin.value = params.get("pin") || "";
    pin.addEventListener("input", () => { pin.value = pin.value.replace(/\D/g, "").slice(0, 6); });
    const name = h("input", { class: "input", maxlength: 16, autocomplete: "off", placeholder: "Your nickname", "aria-label": "Your nickname" });
    name.value = LS.get("live-name", "");
    const save = h("input", { type: "checkbox", id: "save" });
    save.checked = LS.get("live-save", true);
    const err = h("p", { class: "err" + (message ? "" : " hidden"), role: "alert" }, message || "");
    const go = h("button", { class: "btn go", type: "submit" }, "Join");
    const fail = text => { err.textContent = text; err.classList.remove("hidden"); go.disabled = false; };

    async function submit(e) {
      e.preventDefault();
      const code = pin.value, nick = name.value.trim();
      if (code.length !== 6) return fail("Type the 6-digit PIN from the big screen.");
      if (!nick) return fail("Type a nickname.");
      go.disabled = true;
      err.classList.add("hidden");
      try {
        await api("/api/games/" + code);
        const me = await api(`/api/games/${code}/join`, { name: nick });
        session = { pin: code, pid: me.pid, token: me.token, name: me.name };
        LS.set("live-session", session);
        LS.set("live-name", me.name);
        LS.set("live-save", save.checked);
        connect();
      } catch (ex) {
        fail(ex.message);
      }
    }

    const el = h("form", { class: "stack", onsubmit: submit, novalidate: true },
      h("h1", {}, "🎯 Live quiz"),
      h("p", { class: "muted", style: "text-align:center" }, "Type the PIN you see on the big screen."),
      pin, name,
      h("label", { class: "checkbox" }, save, h("span", {}, "Save my wrong answers to “My mistakes”")),
      err, go);
    scene = { el };
    app.replaceChildren(el);
    (params.get("pin") && !message ? name : pin).focus();
  }

  /* ---------- connecting ---------- */
  function connect() {
    reset();
    app.replaceChildren(h("p", { class: "muted", style: "text-align:center" }, "Connecting…"));
    const q = `pid=${encodeURIComponent(session.pid)}&token=${encodeURIComponent(session.token)}`;
    stopFollow = follow(`/api/games/${session.pin}/events?${q}`, {
      check: `/api/games/${session.pin}/check?${q}`,
      onSnap: show,
      onLink: setLink,
      onGone: () => goJoin("This game is over, or you were removed. Join again."),
    });
  }

  function show(s) {
    if (s.state === "ended") return goJoin("The game has ended.");
    if (s.state === "kicked") return goJoin("The teacher removed you from the game.");
    if (s.state === "lobby") return mount("wait", waitScene, s);
    if (s.state === "final") return mount("final", finalScene, s);
    if (s.state === "question") return mount("q:" + s.question.index, questionScene, s);
    mount("r:" + s.question.index, revealScene, s);
  }

  /* ---------- lobby ---------- */
  function waitScene(s) {
    return {
      el: h("div", { class: "stack" }, head(s),
        h("div", { class: "big-emoji" }, "🎉"),
        h("h1", {}, "You're in!"),
        h("p", { class: "muted", style: "text-align:center;font-size:1.15rem" }, "Look for your name, " + s.name + ", on the big screen. The game starts soon."),
        s.team ? h("p", { style: "text-align:center" }, "Your team: ", teamBadge(s)) : null),
    };
  }

  /* ---------- question ---------- */
  function questionScene(s) {
    const q = s.question;
    let locked = s.chosen != null, chosen = s.chosen;
    const bar = h("i"), num = h("span", { class: "timer" });
    count = startCountdown(bar, num, s.remaining_ms, s.secs);
    const msg = h("p", { class: "muted", style: "text-align:center;font-weight:700;min-height:1.4em", "aria-live": "polite" });
    const buttons = q.options.map((text, i) => h("button", { class: "opt o" + i, type: "button", onclick: () => pick(i) },
      h("span", { class: "shape" }, SHAPES[i]), h("span", {}, text)));

    function paint() {
      buttons.forEach((b, i) => {
        b.disabled = locked;
        b.classList.toggle("chosen", chosen === i);
        b.classList.toggle("dim", locked && chosen !== i);
      });
      msg.textContent = locked ? "Answer sent ✓  Waiting for the others…" : "";
    }
    async function pick(i) {
      if (locked) return;
      locked = true;
      chosen = i;
      buzz(25);
      paint();
      try {
        await api(`/api/games/${session.pin}/answer`, { pid: session.pid, token: session.token, q: q.index, choice: i });
      } catch (e) {
        if (e.status === 409) { msg.textContent = e.message; return; }      // too late / already answered
        locked = false;
        chosen = null;
        paint();
        msg.textContent = e.message;                                        // network trouble: tap again
      }
    }
    paint();
    return {
      el: h("div", { class: "stack" }, head(s),
        h("div", { class: "pbar" }, h("span", {}, `Question ${q.index + 1} / ${q.total}`), num),
        h("div", { class: "bar" }, bar),
        h("div", { class: "qtext" }, withBlanks(q.text)),
        h("div", { class: "opts" }, buttons), msg),
      update(snap) {
        if (snap.chosen != null && !locked) { locked = true; chosen = snap.chosen; paint(); }
        if (count) count.sync(snap.remaining_ms);
      },
    };
  }

  /* ---------- answer ---------- */
  function revealScene(s) {
    const r = s.result, q = s.question;
    score = r.score;
    const kind = r.right === true ? "good" : r.right === false ? "bad" : "none";
    const saved = saveIfWrong(s);
    buzz(r.right ? 60 : [70, 50, 70]);
    const verdict = h("div", { class: "verdict " + kind },
      h("div", { class: "big-emoji" }, r.right === true ? "✅" : r.right === false ? "❌" : "⏱"),
      h("h2", {}, r.right === true ? "Correct!" : r.right === false ? "Not this time" : "Time's up"),
      r.right ? h("p", { class: "pts" }, "+" + r.points) : null,
      r.right && r.streak >= 2 ? h("p", {}, "🔥 " + r.streak + " in a row") : null,
      !r.right ? h("p", {}, "Right answer: ", h("b", {}, q.options[q.correct])) : null,
      r.right === false ? h("p", { class: "note" }, "You chose: " + q.options[r.chosen]) : null);
    const sentence = h("div", { class: "qtext sentence" }, withBlanks(q.text, q.options[q.correct]));
    const standing = r.rank === 1 ? (r.players > 1 ? "You're in the lead! 🏆" : "You're the only player so far")
      : `${r.behind.gap} points behind ${r.behind.name}`;
    return {
      el: h("div", { class: "stack" }, head(s), verdict, sentence,
        h("div", { class: "kv" }, h("div", {}, h("span", { class: "muted" }, "Score"), h("b", {}, r.score)),
          h("div", {}, h("span", { class: "muted" }, "Place"), h("b", {}, ordinal(r.rank)), h("span", { class: "muted note" }, "of " + r.players))),
        h("p", { class: "muted", style: "text-align:center;font-weight:700" }, standing),
        saved ? h("p", { class: "muted note", style: "text-align:center" }, "📒 Saved to “My mistakes”.") : null,
        h("p", { class: "muted note", style: "text-align:center" }, "Next question coming up…")),
    };
  }

  /* ---------- final ---------- */
  function finalScene(s) {
    const r = s.result;
    score = r.score;
    const saved = loggedFor(s.pin);
    const place = r.rank <= 3 ? ["🥇", "🥈", "🥉"][r.rank - 1] : "🎯";
    let teamLine = null;
    if (s.team && s.team_board) {
      const at = s.team_board.findIndex(t => t.name === s.team);
      if (at >= 0) teamLine = h("p", { style: "text-align:center;font-weight:700" }, `Team ${s.team}: ${ordinal(at + 1)} place (${s.team_board[at].score} pts)`);
    }
    return {
      el: h("div", { class: "stack" }, head(s),
        h("div", { class: "big-emoji" }, place),
        h("h1", {}, r.rank === 1 ? "You won!" : `You finished ${ordinal(r.rank)}`),
        h("p", { class: "muted", style: "text-align:center" }, `out of ${r.players} players`),
        h("div", { class: "kv" }, h("div", {}, h("span", { class: "muted" }, "Score"), h("b", {}, r.score)),
          h("div", {}, h("span", { class: "muted" }, "Correct"), h("b", {}, `${r.correct} / ${s.total}`))),
        teamLine,
        saved ? h("p", { style: "text-align:center" }, h("a", { href: "/mistakes.html" }, `📒 ${saved} wrong answer${saved > 1 ? "s" : ""} saved: review them in “My mistakes”`)) : null,
        h("button", { class: "btn", type: "button", onclick: () => goJoin() }, "Join another game")),
    };
  }

  /* ---------- start ---------- */
  const wanted = new URLSearchParams(location.search).get("pin");
  if (session && wanted && wanted !== session.pin) forget();       // a QR code for a different game
  if (session) connect(); else join();
})();
