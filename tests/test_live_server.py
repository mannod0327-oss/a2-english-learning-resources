"""The live quiz over real HTTP: questions, static files, permissions, streams, a whole game."""
import csv
import http.client
import io
import json
import random
import sys
import threading
from pathlib import Path
from urllib.parse import quote as urllib_quote

import pytest

PROJECT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT))
import live  # noqa: E402
import live_game  # noqa: E402


class Clock:
    def __init__(self):
        self.now = 5000.0

    def __call__(self):
        return self.now

    def advance(self, seconds):
        self.now += seconds


@pytest.fixture(scope="module")
def bank():
    return live.load_bank()


@pytest.fixture
def env(bank, tmp_path):
    """A hub with a fake clock, a server on an ephemeral port, and a folder for the results files."""
    clock = Clock()
    hub = live.Hub(bank, tmp_path / "results", clock=clock, rng=random.Random(7))
    server = live.make_server(hub, "127.0.0.1", 0)
    thread = threading.Thread(target=server.serve_forever, kwargs={"poll_interval": 0.05}, daemon=True)
    thread.start()
    hub.local_ips = lambda: []          # no network lookups in tests
    try:
        yield type("Env", (), {"hub": hub, "clock": clock, "port": hub.port, "results": tmp_path / "results"})
    finally:
        hub.stop()
        server.shutdown()
        server.server_close()
        thread.join(5)


def call(env, method, path, body=None, raw=None, headers=None):
    conn = http.client.HTTPConnection("127.0.0.1", env.port, timeout=5)
    try:
        payload = raw if raw is not None else (None if body is None else json.dumps(body))
        sent = {"Content-Type": "application/json"} if payload is not None else {}
        conn.request(method, path, body=payload, headers={**sent, **(headers or {})})
        resp = conn.getresponse()
        data = resp.read()
        return resp.status, data, dict(resp.getheaders())
    finally:
        conn.close()


def jcall(env, method, path, body=None):
    status, data, _ = call(env, method, path, body)
    return status, json.loads(data)


class Stream:
    """A server-sent events connection, read one snapshot at a time."""

    def __init__(self, env, path):
        self.conn = http.client.HTTPConnection("127.0.0.1", env.port, timeout=5)
        self.conn.request("GET", path)
        self.resp = self.conn.getresponse()
        self.status = self.resp.status

    def next(self):
        while True:
            line = self.resp.readline()
            if not line:
                return None
            line = line.decode("utf-8").strip()
            if line.startswith("data:"):
                return json.loads(line[5:])

    def close(self):
        self.conn.close()


def new_game(env, units=(1,), count=3, secs=10, teams=0):
    status, game = jcall(env, "POST", "/api/games", {"units": list(units), "count": count, "secs": secs, "teams": teams})
    assert status == 200, game
    return game


def join(env, pin, name):
    status, data = jcall(env, "POST", f"/api/games/{pin}/join", {"name": name})
    assert status == 200, data
    return data


def host(env, game, action, **extra):
    return jcall(env, "POST", f"/api/games/{game['pin']}/{action}", {"key": game["key"], **extra})


# ---------- the question bank ----------
def test_bank_has_every_unit_with_unique_question_ids(bank):
    assert sorted(bank) == list(range(1, 43))
    ids = [item["id"] for unit in bank.values() for item in unit["items"]]
    assert len(ids) == len(set(ids))
    assert all(len(unit["items"]) >= 10 for unit in bank.values())
    for unit in bank.values():
        for item in unit["items"]:
            assert len(item["options"]) == 3 and len(set(item["options"])) == 3


def test_question_ids_are_the_ones_my_mistakes_knows(bank):
    """Wrong answers are written into the site's notebook by id, so every id must exist in its BANK."""
    text = (PROJECT / "html" / "mistakes.html").read_text(encoding="utf-8")
    start = text.index("const BANK=") + len("const BANK=")
    known, _ = json.JSONDecoder().raw_decode(text, start)
    missing = [item["id"] for unit in bank.values() for item in unit["items"] if item["id"] not in known]
    assert not missing, missing[:5]
    sample = bank[1]["items"][0]
    assert known[sample["id"]]["q"] == sample["q"] and known[sample["id"]]["a"][0] == sample["options"][0]


def test_drawn_questions_are_spread_over_units_with_shuffled_options(env):
    game = env.hub.create([1, 2, 3], 9, 20, 0)
    assert len(game.questions) == 9
    by_unit = {n: {item["id"] for item in env.hub.bank[n]["items"]} for n in (1, 2, 3)}
    assert [sum(1 for q in game.questions if q["id"] in by_unit[n]) for n in (1, 2, 3)] == [3, 3, 3]
    originals = {item["id"]: item for unit in env.hub.bank.values() for item in unit["items"]}
    for q in game.questions:
        original = originals[q["id"]]
        assert sorted(q["options"]) == sorted(original["options"])
        assert q["options"][q["correct"]] == original["options"][0]
    assert len({q["id"] for q in game.questions}) == 9
    assert any(q["correct"] != 0 for q in game.questions)       # the right answer is not always first


def test_asking_for_more_than_exists_gives_what_exists(env):
    game = env.hub.create([5], 50, 20, 0)
    assert len(game.questions) == len(env.hub.bank[5]["items"])


@pytest.mark.parametrize("body", [
    {"units": [], "count": 10, "secs": 20, "teams": 0},
    {"units": [0], "count": 10, "secs": 20, "teams": 0},
    {"units": [43], "count": 10, "secs": 20, "teams": 0},
    {"units": ["1"], "count": 10, "secs": 20, "teams": 0},
    {"units": [True], "count": 10, "secs": 20, "teams": 0},
    {"units": "1", "count": 10, "secs": 20, "teams": 0},
    {"count": 10, "secs": 20, "teams": 0},
    {"units": [1], "count": 2, "secs": 20, "teams": 0},
    {"units": [1], "count": 51, "secs": 20, "teams": 0},
    {"units": [1], "count": 10.5, "secs": 20, "teams": 0},
    {"units": [1], "count": True, "secs": 20, "teams": 0},
    {"units": [1], "count": 10, "secs": 7, "teams": 0},
    {"units": [1], "count": 10, "secs": 20.0, "teams": 0},
    {"units": [1], "count": 10, "secs": 20, "teams": 1},
    {"units": [1], "count": 10, "secs": 20, "teams": 7},
    {"units": [1], "count": 10, "secs": 20, "teams": False},
])
def test_bad_game_settings_are_refused(env, body):
    status, data = jcall(env, "POST", "/api/games", body)
    assert status == 400 and data["error"]
    assert env.hub.games == {}


# ---------- files ----------
def test_static_files_are_served_with_the_right_types(env):
    cases = {
        "/": "text/html", "/index.html": "text/html", "/live/host.html": "text/html", "/play": "text/html",
        "/live/play.html": "text/html", "/live/live.css": "text/css", "/live/common.js": "text/javascript",
        "/live/host.js": "text/javascript", "/live/play.js": "text/javascript", "/live/vendor/qrcode.js": "text/javascript",
        "/kahoot/unit-01.xlsx": "spreadsheetml", "/kahoot-all-units.zip": "application/zip",
        "/xlsx-files.json": "application/json", "/mistakes.html": "text/html", "/unit-01.html": "text/html",
    }
    for path, kind in cases.items():
        status, data, headers = call(env, "GET", path)
        assert status == 200, path
        assert kind in headers["Content-Type"], (path, headers["Content-Type"])
        assert data, path
        assert headers["X-Content-Type-Options"] == "nosniff"


def test_live_redirects_to_the_host_page(env):
    status, _, headers = call(env, "GET", "/live")
    assert status == 302 and headers["Location"] == "/live/host.html"


def test_pages_only_reference_files_that_exist(env):
    import re
    for page in ("host.html", "play.html"):
        text = (PROJECT / "live" / page).read_text(encoding="utf-8")
        for ref in re.findall(r'(?:src|href)="(/live/[^"]+)"', text):
            status, _, _ = call(env, "GET", ref)
            assert status == 200, (page, ref)


@pytest.mark.parametrize("path", [
    "/../live.py", "/live/../live.py", "/%2e%2e/live.py", "/live/%2e%2e/live.py", "/live/..%2flive.py",
    "/..%5clive.py", "/live/..%5c..%5clive.py", "//etc/passwd", "/live/../../etc/passwd", "/nope.html",
    "/live/missing.js", "/live/vendor/", "/live/%00", "/C:/Windows/win.ini", "/live/C:/Windows/win.ini",
])
def test_paths_outside_the_site_are_not_served(env, path):
    status, data, _ = call(env, "GET", path)
    assert status == 404, path
    assert b"import argparse" not in data and b"root:" not in data


def test_only_get_serves_files(env):
    assert call(env, "POST", "/index.html", body={})[0] == 404


# ---------- api basics ----------
def test_info_lists_units_and_choices(env):
    status, info = jcall(env, "GET", "/api/info")
    assert status == 200
    assert [u["n"] for u in info["units"]] == list(range(1, 43))
    assert info["secs"] == list(live.SECS_CHOICES) and info["teams"] == list(live.TEAM_CHOICES)
    assert info["port"] == env.port and info["join"] == []


def test_unknown_game_and_routes_are_404(env):
    for method, path in (("GET", "/api/games/000000"), ("POST", "/api/games/000000/join"), ("GET", "/api/games"),
                         ("GET", "/api/nothing"), ("GET", "/api/games/abc/def/ghi")):
        status, data, _ = call(env, method, path, raw=b"{}" if method == "POST" else None)
        assert status == 404 and json.loads(data)["error"], path


def test_bad_bodies_are_refused_and_the_connection_stays_usable(env):
    game = new_game(env)
    status, data = jcall(env, "POST", f"/api/games/{game['pin']}/join", {"name": ""})
    assert status == 400
    for raw in (b"not json", b"[1,2]", b'"x"', b"\xff\xfe"):
        status, _, _ = call(env, "POST", f"/api/games/{game['pin']}/join", raw=raw)
        assert status == 400, raw
    status, _, _ = call(env, "POST", f"/api/games/{game['pin']}/join", raw=b"x" * 5000)
    assert status == 413
    conn = http.client.HTTPConnection("127.0.0.1", env.port, timeout=5)
    try:                                            # keep-alive: a body nobody reads must not poison the next request
        conn.request("POST", "/api/nowhere", body=b'{"a": 1}')
        first = conn.getresponse()
        first.read()
        assert first.status == 404
        conn.request("GET", "/api/info")
        second = conn.getresponse()
        assert second.status == 200 and json.loads(second.read())["units"]
    finally:
        conn.close()


# ---------- permissions ----------
def test_only_the_teachers_computer_creates_games(env):
    assert env.hub.is_local("127.0.0.1") and env.hub.is_local("::1")
    assert not env.hub.is_local("192.168.43.77")
    env.hub.local_ips = lambda: ["192.168.43.1"]
    assert env.hub.is_local("192.168.43.1")
    env.hub.allow_remote_host = True
    assert env.hub.is_local("192.168.43.77")


def test_a_device_cannot_flood_a_game(env):
    game = env.hub.create([1], 5, 10, 0)
    for i in range(live.MAX_PER_IP):
        env.hub.join(game, f"p{i}", "10.1.1.9", False)
    with pytest.raises(live_game.GameError) as e:
        env.hub.join(game, "one-too-many", "10.1.1.9", False)
    assert e.value.status == 429
    env.hub.join(game, "someone-else", "10.1.1.10", False)
    for i in range(live.MAX_PER_IP + 3):            # the teacher's own computer may open as many tabs as needed
        env.hub.join(game, f"t{i}", "127.0.0.1", True)


def test_host_actions_need_the_host_key(env):
    game = new_game(env)
    join(env, game["pin"], "Ada")
    for action in ("start", "next", "kick", "end"):
        status, _ = jcall(env, "POST", f"/api/games/{game['pin']}/{action}", {"key": "guess"})
        assert status == 403, action
        status, _ = jcall(env, "POST", f"/api/games/{game['pin']}/{action}", {})
        assert status == 403, action
    assert call(env, "GET", f"/api/games/{game['pin']}/results.csv")[0] == 403
    assert call(env, "GET", f"/api/games/{game['pin']}/results.csv?key=guess")[0] == 403
    assert Stream(env, f"/api/games/{game['pin']}/host/events?key=guess").status == 403
    assert env.hub.games[game["pin"]].state == "lobby"


def test_player_streams_and_answers_need_the_token(env):
    game = new_game(env)
    me = join(env, game["pin"], "Ada")
    assert Stream(env, f"/api/games/{game['pin']}/events?pid={me['pid']}&token=nope").status == 403
    assert Stream(env, f"/api/games/{game['pin']}/events").status == 403
    host(env, game, "start")
    status, data = jcall(env, "POST", f"/api/games/{game['pin']}/answer", {"pid": me["pid"], "token": "nope", "q": 0, "choice": 0})
    assert status == 403
    status, data = jcall(env, "POST", f"/api/games/{game['pin']}/answer", {"pid": me["pid"], "token": me["token"], "q": 0, "choice": 9})
    assert status == 400


def test_check_endpoint_tells_valid_visitors_from_invalid_ones(env):
    """Pages ask this before believing a game is gone (a reload also ends an event stream)."""
    game = new_game(env)
    pin = game["pin"]
    me = join(env, pin, "Ada")
    assert call(env, "GET", f"/api/games/{pin}/check?key={game['key']}")[0] == 200
    assert call(env, "GET", f"/api/games/{pin}/check?key=wrong")[0] == 403
    assert call(env, "GET", f"/api/games/{pin}/check?pid={me['pid']}&token={me['token']}")[0] == 200
    assert call(env, "GET", f"/api/games/{pin}/check?pid={me['pid']}&token=wrong")[0] == 403
    assert call(env, "GET", f"/api/games/{pin}/check")[0] == 403
    assert host(env, game, "kick", pid=me["pid"])[0] == 200
    assert call(env, "GET", f"/api/games/{pin}/check?pid={me['pid']}&token={me['token']}")[0] == 403
    assert host(env, game, "end")[0] == 200
    assert call(env, "GET", f"/api/games/{pin}/check?key={game['key']}")[0] == 404


def test_posts_must_be_json_so_other_websites_cannot_drive_the_server(env):
    body = json.dumps({"units": [1], "count": 5, "secs": 10, "teams": 0})
    for ctype in ("text/plain", "application/x-www-form-urlencoded", "multipart/form-data; boundary=x"):
        status, data, _ = call(env, "POST", "/api/games", raw=body, headers={"Content-Type": ctype})
        assert status == 415, ctype
    status, data, _ = call(env, "POST", "/api/games", raw=body, headers={"Content-Type": "Application/JSON; charset=utf-8"})
    assert status == 200
    assert len(env.hub.games) == 1


def test_odd_characters_in_tokens_and_keys_are_just_refused(env):
    game = new_game(env)
    pin = game["pin"]
    me = join(env, pin, "Ada")
    for bad in ("é", "\u202e", "日本語", "x" * 500):
        quoted = urllib_quote(bad)
        assert call(env, "GET", f"/api/games/{pin}/check?key={quoted}")[0] == 403
        assert call(env, "GET", f"/api/games/{pin}/check?pid={me['pid']}&token={quoted}")[0] == 403
        assert jcall(env, "POST", f"/api/games/{pin}/start", {"key": bad})[0] == 403
        status, _ = jcall(env, "POST", f"/api/games/{pin}/answer", {"pid": me["pid"], "token": bad, "q": 0, "choice": 0})
        assert status == 403


def test_live_pages_carry_a_content_security_policy(env):
    for page in ("/live/host.html", "/live/play.html", "/play"):
        status, _, headers = call(env, "GET", page)
        policy = headers["Content-Security-Policy"]
        assert status == 200 and "script-src 'self'" in policy and "'unsafe-inline'" not in policy.split("style-src")[0]
    assert "Content-Security-Policy" not in call(env, "GET", "/index.html")[2]      # the practice pages inline their scripts


def test_a_players_stream_stays_quiet_while_others_answer(env):
    game = new_game(env)
    pin = game["pin"]
    me, other = join(env, pin, "Ada"), join(env, pin, "Bob")
    third = join(env, pin, "Cem")
    host(env, game, "start")
    ps = Stream(env, f"/api/games/{pin}/events?pid={me['pid']}&token={me['token']}")
    assert ps.next()["state"] == "question"
    hs = Stream(env, f"/api/games/{pin}/host/events?key={game['key']}")
    assert hs.next()["answered"] == 0
    jcall(env, "POST", f"/api/games/{pin}/answer", {"pid": other["pid"], "token": other["token"], "q": 0, "choice": 0})
    assert hs.next()["answered"] == 1                   # the host is told about every answer...
    jcall(env, "POST", f"/api/games/{pin}/answer", {"pid": me["pid"], "token": me["token"], "q": 0, "choice": 1})
    snap = ps.next()                                     # ...Ada hears only about her own (the next thing she sees)
    assert snap["chosen"] == 1
    ps.close()
    hs.close()
    assert third["pid"]


def test_a_double_tapped_next_button_does_not_skip_a_question(env):
    game = new_game(env)
    join(env, game["pin"], "Ada")
    host(env, game, "start")
    assert host(env, game, "next", state="question", index=0)[0] == 200       # to the answer
    assert host(env, game, "next", state="question", index=0)[0] == 409       # the same click again
    assert host(env, game, "next", state="reveal", index=0)[0] == 200         # to question 2
    assert host(env, game, "next", state="reveal", index=0)[0] == 409         # a late second click
    assert env.hub.games[game["pin"]].index == 1 and env.hub.games[game["pin"]].state == "question"


# ---------- streams ----------
def test_players_and_host_follow_the_game_live(env):
    game = new_game(env, teams=2)
    pin = game["pin"]
    hs = Stream(env, f"/api/games/{pin}/host/events?key={game['key']}")
    first = hs.next()
    assert first["state"] == "lobby" and first["players"] == [] and first["teams"] == live_game.TEAM_NAMES[:2]
    me = join(env, pin, "Ada")
    ps = Stream(env, f"/api/games/{pin}/events?pid={me['pid']}&token={me['token']}")
    mine = ps.next()
    assert mine["state"] == "lobby" and mine["name"] == "Ada" and mine["team"] in live_game.TEAM_NAMES[:2]
    seen = hs.next()
    assert [p["name"] for p in seen["players"]] == ["Ada"]

    host(env, game, "start")
    snap = ps.next()
    assert snap["state"] == "question" and snap["question"]["index"] == 0 and 0 < snap["remaining_ms"] <= 10000
    assert "correct" not in snap["question"] and snap["chosen"] is None
    host_snap = hs.next()
    assert host_snap["state"] == "question" and host_snap["answered"] == 0

    right = env.hub.games[pin].questions[0]["correct"]
    status, _ = jcall(env, "POST", f"/api/games/{pin}/answer", {"pid": me["pid"], "token": me["token"], "q": 0, "choice": right})
    assert status == 200
    reveal = ps.next()
    while reveal["state"] == "question":          # the "I have answered" snapshot may come first
        reveal = ps.next()
    assert reveal["state"] == "reveal" and reveal["question"]["correct"] == right
    assert reveal["result"]["right"] is True and reveal["result"]["points"] >= 500
    host_reveal = hs.next()
    while host_reveal["state"] == "question":
        host_reveal = hs.next()
    assert host_reveal["counts"][right] == 1 and host_reveal["board"][0]["name"] == "Ada"
    ps.close()
    hs.close()


def test_a_kicked_player_is_told_and_the_stream_ends(env):
    game = new_game(env)
    pin = game["pin"]
    me = join(env, pin, "Ada")
    join(env, pin, "Bob")
    ps = Stream(env, f"/api/games/{pin}/events?pid={me['pid']}&token={me['token']}")
    assert ps.next()["state"] == "lobby"
    assert host(env, game, "kick", pid=me["pid"])[0] == 200
    assert ps.next() == {"state": "kicked"}
    assert ps.next() is None
    assert host(env, game, "kick", pid=me["pid"])[0] == 404
    ps.close()


def test_ending_a_game_tells_everyone(env):
    game = new_game(env)
    pin = game["pin"]
    me = join(env, pin, "Ada")
    ps = Stream(env, f"/api/games/{pin}/events?pid={me['pid']}&token={me['token']}")
    hs = Stream(env, f"/api/games/{pin}/host/events?key={game['key']}")
    assert ps.next()["state"] == "lobby" and hs.next()["state"] == "lobby"
    assert host(env, game, "end")[0] == 200
    assert ps.next() == {"state": "ended"} and hs.next() == {"state": "ended"}
    assert ps.next() is None and hs.next() is None
    assert call(env, "GET", f"/api/games/{pin}")[0] == 404
    ps.close()
    hs.close()


def test_a_reconnecting_player_gets_the_current_picture_at_once(env):
    game = new_game(env)
    pin = game["pin"]
    me = join(env, pin, "Ada")
    join(env, pin, "Bob")
    host(env, game, "start")
    ps = Stream(env, f"/api/games/{pin}/events?pid={me['pid']}&token={me['token']}")
    jcall(env, "POST", f"/api/games/{pin}/answer", {"pid": me["pid"], "token": me["token"], "q": 0, "choice": 1})
    ps.close()
    again = Stream(env, f"/api/games/{pin}/events?pid={me['pid']}&token={me['token']}")
    snap = again.next()
    assert snap["state"] == "question" and snap["chosen"] == 1
    again.close()


# ---------- clock ----------
def test_the_tick_closes_a_question_when_time_is_up(env):
    game = new_game(env, secs=10)
    pin = game["pin"]
    join(env, pin, "Ada")
    host(env, game, "start")
    hs = Stream(env, f"/api/games/{pin}/host/events?key={game['key']}")
    assert hs.next()["state"] == "question"
    env.clock.advance(10.2)
    assert env.hub.tick() is False
    env.clock.advance(0.5)
    assert env.hub.tick() is True
    snap = hs.next()
    assert snap["state"] == "reveal" and snap["counts"] == [0, 0, 0]
    hs.close()


def test_idle_and_finished_games_are_forgotten(env):
    idle = env.hub.create([1], 5, 10, 0)
    env.clock.advance(live.IDLE_LIMIT + 1)
    env.hub.tick()
    assert idle.pin not in env.hub.games

    done = new_game(env, count=3)
    join(env, done["pin"], "Ada")
    host(env, done, "start")
    for _ in range(3):
        host(env, done, "next")
        host(env, done, "next")
    assert env.hub.games[done["pin"]].state == "final"
    env.clock.advance(live.FINISHED_KEEP - 5)
    env.hub.tick()
    assert done["pin"] in env.hub.games
    env.clock.advance(10)
    env.hub.tick()
    assert done["pin"] not in env.hub.games


def test_the_number_of_games_is_capped(env):
    for _ in range(live.MAX_GAMES):
        env.hub.create([1], 5, 10, 0)
    status, data = jcall(env, "POST", "/api/games", {"units": [1], "count": 5, "secs": 10, "teams": 0})
    assert status == 503 and data["error"]


# ---------- a whole game ----------
def play_round(env, game, me_list, correct_for):
    """Every player answers the current question (correct_for[name] says whether rightly), then the host moves on."""
    pin = game["pin"]
    current = env.hub.games[pin]
    q = current.questions[current.index]
    for name, me in me_list.items():
        choice = q["correct"] if correct_for[name] else (q["correct"] + 1) % 3
        status, data = jcall(env, "POST", f"/api/games/{pin}/answer",
                             {"pid": me["pid"], "token": me["token"], "q": current.index, "choice": choice})
        assert status == 200, data


def test_a_complete_game_with_teams_ends_in_a_results_file(env):
    game = new_game(env, units=(1, 2), count=4, secs=20, teams=2)
    pin = game["pin"]
    assert game["total"] == 4
    players = {name: join(env, pin, name) for name in ("Ada", "Bob", "Cem", "Dil")}
    status, data = jcall(env, "GET", f"/api/games/{pin}")
    assert status == 200 and data == {"pin": pin, "state": "lobby", "teams": live_game.TEAM_NAMES[:2]}
    assert join_error(env, pin, "ada") == 409                      # nickname taken (any case)

    assert host(env, game, "start")[0] == 200
    accuracy = {"Ada": True, "Bob": True, "Cem": False, "Dil": False}
    for i in range(4):
        play_round(env, game, players, accuracy)
        assert env.hub.games[pin].state == "reveal"                # everyone answered: closes by itself
        assert host(env, game, "next", state="reveal", index=i)[0] == 200
    assert env.hub.games[pin].state == "final"

    hs = Stream(env, f"/api/games/{pin}/host/events?key={game['key']}")
    final = hs.next()
    hs.close()
    assert final["state"] == "final"
    assert [r["name"] for r in final["board"][:2]] in (["Ada", "Bob"], ["Bob", "Ada"])
    assert {r["correct"] for r in final["board"][:2]} == {4}
    assert {r["correct"] for r in final["board"][2:]} == {0}
    assert sum(t["players"] for t in final["team_board"]) == 4

    files = list(env.results.glob("*.csv"))
    assert len(files) == 1 and pin in files[0].name
    assert final["saved"] == str(files[0])
    status, body, headers = call(env, "GET", f"/api/games/{pin}/results.csv?key={game['key']}")
    assert status == 200 and "text/csv" in headers["Content-Type"] and pin in headers["Content-Disposition"]
    assert body.startswith(b"\xef\xbb\xbf") and body == files[0].read_bytes()
    rows = list(csv.reader(io.StringIO(body.decode("utf-8-sig"))))
    assert rows[0][:3] == ["Rank", "Name", "Team"]
    assert {r[1] for r in rows[1:5]} == {"Ada", "Bob", "Cem", "Dil"}

    me = players["Cem"]
    ps = Stream(env, f"/api/games/{pin}/events?pid={me['pid']}&token={me['token']}")
    mine = ps.next()
    ps.close()
    assert mine["state"] == "final" and mine["result"]["correct"] == 0 and mine["result"]["players"] == 4
    assert join_error(env, pin, "Late") == 409                     # finished games take nobody new


def join_error(env, pin, name):
    status, data = jcall(env, "POST", f"/api/games/{pin}/join", {"name": name})
    assert status != 200 and data["error"]
    return status


def test_results_file_failure_does_not_break_the_game(env, tmp_path):
    blocked = tmp_path / "not-a-folder"
    blocked.write_text("a file where the folder should be", encoding="utf-8")
    env.hub.results_dir = blocked / "results"
    game = new_game(env, count=3)
    join(env, game["pin"], "Ada")
    host(env, game, "start")
    for _ in range(3):
        host(env, game, "next")
        host(env, game, "next")
    assert env.hub.games[game["pin"]].state == "final"
    assert "saved" not in env.hub.host_snapshot(env.hub.games[game["pin"]])
    status, body, _ = call(env, "GET", f"/api/games/{game['pin']}/results.csv?key={game['key']}")
    assert status == 200 and body.startswith(b"\xef\xbb\xbf")


# ---------- command line ----------
def test_startup_banner_is_plain_ascii_for_windows_consoles():
    text = live.banner(8000, "0.0.0.0", ["192.168.43.1", "10.0.0.5"])
    assert text.isascii()
    assert "http://192.168.43.1:8000/play" in text and "http://localhost:8000/live/host.html" in text
    assert live.banner(8000, "0.0.0.0", []).isascii() and "hotspot" in live.banner(8000, "0.0.0.0", [])
    assert "telefonlar ulana olmaydi" in live.banner(8000, "127.0.0.1", ["192.168.1.2"])


def test_results_folder_is_ignored_by_git():
    assert Path(live.ROOT, "live-results") == live.ROOT / "live-results"
    assert "live-results/" in (PROJECT / ".gitignore").read_text(encoding="utf-8").split()


def test_help_lists_the_options(capsys):
    with pytest.raises(SystemExit) as e:
        live.main(["--help"])
    assert e.value.code == 0
    out = capsys.readouterr().out
    for option in ("--port", "--bind", "--no-browser", "--results", "--allow-remote-host"):
        assert option in out


def test_lan_ips_are_plain_ipv4_addresses():
    import ipaddress
    for ip in live.lan_ips():
        assert ipaddress.IPv4Address(ip) and not ip.startswith(("127.", "169.254."))


def test_live_py_starts_from_the_command_line_and_serves_the_site(tmp_path):
    """The real entry point: argument parsing, the question bank, the banner, the port it picked."""
    import os
    import queue
    import re
    import subprocess
    import urllib.request

    env = {**os.environ, "PYTHONUNBUFFERED": "1", "PYTHONIOENCODING": "utf-8", "PYTHONDONTWRITEBYTECODE": "1"}
    proc = subprocess.Popen(
        [sys.executable, "live.py", "--no-browser", "--port", "0", "--bind", "127.0.0.1", "--results", str(tmp_path)],
        cwd=PROJECT, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, encoding="utf-8",
    )
    lines = queue.Queue()
    threading.Thread(target=lambda: [lines.put(line) for line in proc.stdout], daemon=True).start()
    try:
        port = None
        for _ in range(200):
            try:
                line = lines.get(timeout=30)
            except queue.Empty:
                break
            found = re.search(r"http://localhost:(\d+)/live/host\.html", line)
            if found:
                port = int(found.group(1))
                break
        assert port, "the startup banner never appeared"
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/api/info", timeout=10) as resp:
            info = json.load(resp)
        assert len(info["units"]) == 42 and info["port"] == port
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/live/host.html", timeout=10) as resp:
            assert b"Live quiz" in resp.read()
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/", timeout=10) as resp:
            assert b"Destination A2" in resp.read()
    finally:
        proc.terminate()
        try:
            proc.wait(10)
        except subprocess.TimeoutExpired:
            proc.kill()
        proc.stdout.close()


@pytest.mark.skipif(__import__("shutil").which("node") is None, reason="Node.js is not installed")
def test_browser_scripts_parse():
    """No browser in CI, but a syntax slip in a page script would still break the whole game."""
    import subprocess
    for name in ("common.js", "host.js", "play.js"):
        result = subprocess.run(["node", "--check", str(PROJECT / "live" / name)], capture_output=True, text=True, timeout=60)
        assert result.returncode == 0, (name, result.stderr)
