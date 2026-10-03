"""Live quiz: a Kahoot-style game that runs from the teacher's computer.

    py live.py

The teacher opens the host page on this computer, students join from their phones with a PIN.
Questions come straight from the 42 units of the practice site (the same 16 multiple-choice
questions per unit that the Kahoot spreadsheets hold). Only the Python standard library is used.

The server also serves the practice site (html/) at "/", so a student's wrong answers can be
written into the same "My mistakes" notebook the site already has.
"""
import argparse
import json
import mimetypes
import os
import random
import secrets
import socket
import socketserver
import sys
import threading
import time
import traceback
import webbrowser
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlsplit

ROOT = Path(__file__).resolve().parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import live_game  # noqa: E402
from live_game import Game, GameError  # noqa: E402

SITE, LIVE = ROOT / "html", ROOT / "live"
DEFAULT_PORTS = range(8000, 8010)
SECS_CHOICES = (10, 15, 20, 30, 45, 60)
TEAM_CHOICES = (0, 2, 3, 4, 5, 6)
COUNT_MIN, COUNT_MAX, COUNT_DEFAULT = 3, 50, 15
MAX_GAMES = 20
MAX_PER_IP = 6              # phones per address; the teacher's own computer is exempt
IDLE_LIMIT = 4 * 3600       # a game nobody touched for this long is forgotten
FINISHED_KEEP = 1800        # a finished game stays available for its CSV for this long
TICK = 0.2
HEARTBEAT = 15              # seconds between keep-alive comments on an idle stream
MAX_BODY = 4096
CSP = ("default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; "
       "connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'")

MIME = {
    ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".txt": "text/plain; charset=utf-8",
    ".zip": "application/zip",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
}


# ---------- questions ----------
def load_bank():
    """unit number -> {"n", "title", "kind", "items": [{"id", "q", "options"}]}, right answer first.

    The ids are the ones the practice site gives the same questions, so "My mistakes" recognises them.
    """
    import build                       # only data and helpers; importing it writes nothing
    bank = {}
    for u in build.UNITS:
        seen, items = set(), []
        for q, options in build.mc_pool(u):
            qid = build.iid(f"u{u['n']}", q, options)
            if qid not in seen:
                seen.add(qid)
                items.append({"id": qid, "q": q, "options": list(options)})
        bank[u["n"]] = {"n": u["n"], "title": u["title"], "kind": build.kind_of(u), "items": items}
    return bank


def _hostname_ips(wait=1.0):
    """Addresses the computer's own name resolves to; some systems are slow here, so don't wait long."""
    found = []

    def look():
        try:
            found.extend(socket.gethostbyname_ex(socket.gethostname())[2])
        except OSError:
            pass

    worker = threading.Thread(target=look, daemon=True)
    worker.start()
    worker.join(wait)
    return list(found)


def lan_ips():
    """This computer's addresses on the local network, best guess first. Sends no traffic."""
    found = []
    for target in ("10.255.255.255", "192.168.255.255", "172.31.255.255", "8.8.8.8"):
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        try:
            s.connect((target, 9))
            found.append(s.getsockname()[0])
        except OSError:
            pass
        finally:
            s.close()
    found += _hostname_ips()
    ips = []
    for ip in found:
        if ip not in ips and not ip.startswith(("127.", "169.254.", "0.")):
            ips.append(ip)
    return ips


def is_int(value):
    return isinstance(value, int) and not isinstance(value, bool)


# ---------- the hub: every game, one lock ----------
class Hub:
    """Owns the games. `cond` guards every Game; call `notify()` after changing one."""

    def __init__(self, bank, results_dir=None, clock=time.monotonic, rng=None, allow_remote_host=False):
        self.bank, self.clock = bank, clock
        self.rng = rng or random.Random()
        self.results_dir = Path(results_dir) if results_dir else None
        self.allow_remote_host = allow_remote_host
        self.games = {}
        self.saved = {}             # pin -> path of the CSV written when the game finished
        self.finished_at = {}       # pin -> clock() when it finished
        self.joins = {}             # pin -> {ip: how many joined from it}
        self.cond = threading.Condition()
        self.stopping = False
        self.port = 0
        self._ips = (0.0, [])
        self._ips_lock = threading.Lock()

    # ----- creating games -----
    def unit_list(self):
        return [{"n": b["n"], "title": b["title"], "kind": b["kind"], "count": len(b["items"])}
                for b in self.bank.values()]

    def create(self, units, count, secs, teams):
        if not isinstance(units, list) or not units or not all(is_int(n) and n in self.bank for n in units):
            raise GameError("Pick at least one unit (1-%d)." % len(self.bank))
        if not is_int(secs) or secs not in SECS_CHOICES:
            raise GameError("Time per question must be one of %s seconds." % ", ".join(map(str, SECS_CHOICES)))
        if not is_int(teams) or teams not in TEAM_CHOICES:
            raise GameError("Use 0 (no teams) or 2-%d teams." % max(TEAM_CHOICES))
        if not is_int(count) or not COUNT_MIN <= count <= COUNT_MAX:
            raise GameError("Choose %d-%d questions." % (COUNT_MIN, COUNT_MAX))
        questions = self._draw(sorted(set(units)), count)
        with self.cond:
            self._sweep()
            if len(self.games) >= MAX_GAMES:
                raise GameError("Too many games are running on this computer.", 503)
            pin, key = live_game.new_pin(self.games), secrets.token_urlsafe(12)
            game = self.games[pin] = Game(pin, key, questions, secs, teams, self.clock)
            self.cond.notify_all()
        return game

    def _draw(self, units, count):
        """`count` questions spread evenly over the chosen units, in random order, options shuffled."""
        pools = []
        for n in units:
            items = list(self.bank[n]["items"])
            self.rng.shuffle(items)
            pools.append(items)
        chosen = []
        while len(chosen) < count and any(pools):
            for pool in pools:
                if pool and len(chosen) < count:
                    chosen.append(pool.pop())
        self.rng.shuffle(chosen)
        questions = []
        for item in chosen:
            options = item["options"][:]
            self.rng.shuffle(options)
            questions.append({"id": item["id"], "q": item["q"], "options": options,
                              "correct": options.index(item["options"][0])})
        return questions

    # ----- looking games up -----
    def get(self, pin):
        game = self.games.get(pin)
        if game is None:
            raise GameError("No game with that PIN.", 404)
        return game

    def local_ips(self):
        """Cached for a while: looking addresses up can be slow and must never happen under `cond`."""
        with self._ips_lock:
            at, ips = self._ips
            if time.monotonic() - at > 30 or not ips:
                ips = lan_ips()
                self._ips = (time.monotonic(), ips)
            return list(ips)

    def is_local(self, ip):
        return self.allow_remote_host or ip in ("127.0.0.1", "::1") or ip in self.local_ips()

    # ----- changes (callers hold cond) -----
    def notify(self, game=None):
        if game is not None and game.state == "final" and game.pin not in self.saved:
            self.finished_at[game.pin] = self.clock()
            self._save_results(game)
        self.cond.notify_all()

    def join(self, game, name, ip, local):
        with self.cond:
            counts = self.joins.setdefault(game.pin, {})
            if not local and counts.get(ip, 0) >= MAX_PER_IP:
                raise GameError("Too many players joined from this device.", 429)
            player = game.join(name)
            counts[ip] = counts.get(ip, 0) + 1
            self.notify()
            return player

    def expect(self, game, state, index):
        """Ignore a double-tapped button: the host's click names the screen it was made on."""
        if state is not None and (game.state != state or (index is not None and game.index != index)):
            raise GameError("Already moved on.", 409)

    def end(self, pin):
        for book in (self.games, self.joins, self.saved, self.finished_at):
            book.pop(pin, None)
        self.cond.notify_all()

    def tick(self):
        """Close questions whose time is up; forget old games. Returns True if anything changed."""
        with self.cond:
            changed = False
            for game in list(self.games.values()):
                if game.tick():
                    changed = True
            self._sweep()
            if changed:
                self.notify()
            return changed

    def _sweep(self):
        now = self.clock()
        for pin, game in list(self.games.items()):
            done = self.finished_at.get(pin)
            if now - game.touched > IDLE_LIMIT or (done is not None and now - done > FINISHED_KEEP):
                self.end(pin)

    def stop(self):
        with self.cond:
            self.stopping = True
            self.cond.notify_all()

    def run_ticks(self):
        while not self.stopping:
            time.sleep(TICK)
            try:
                self.tick()
            except Exception:                               # never let the clock thread die
                traceback.print_exc()

    # ----- results -----
    def _save_results(self, game):
        if self.results_dir is None:
            return
        name = "%s-%s.csv" % (datetime.now().strftime("%Y-%m-%d_%H%M"), game.pin)
        try:
            self.results_dir.mkdir(parents=True, exist_ok=True)
            path = self.results_dir / name
            path.write_bytes(csv_bytes(game))
            self.saved[game.pin] = str(path)
        except OSError as exc:
            print("Could not save the results file: %s" % exc, file=sys.stderr)
            self.saved[game.pin] = ""

    def host_snapshot(self, game):
        snap = game.snapshot_host()
        if self.saved.get(game.pin):
            snap["saved"] = self.saved[game.pin]
        return snap


def csv_bytes(game):
    return ("﻿" + game.results_csv()).encode("utf-8")      # the BOM makes Excel read UTF-8 names


# ---------- HTTP ----------
class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "A2Live"
    timeout = 60
    hub = None
    verbose = False

    def log_message(self, fmt, *args):
        if self.verbose:
            sys.stderr.write("%s %s\n" % (self.client_address[0], fmt % args))

    # ----- plumbing -----
    def do_GET(self):
        self.dispatch("GET")

    def do_POST(self):
        self.dispatch("POST")

    @property
    def ip(self):
        return self.client_address[0]

    def dispatch(self, method):
        url = urlsplit(self.path)
        self.path_only, self.query = url.path, {k: v[-1] for k, v in parse_qs(url.query).items()}
        try:
            self.raw = self.read_raw() if method == "POST" else b""    # always consume it: keep-alive
            if self.path_only.startswith("/api/"):
                self.api(method, [unquote(p) for p in self.path_only[5:].strip("/").split("/")])
            elif method == "GET":
                self.static(self.path_only)
            else:
                raise GameError("Not found.", 404)
        except GameError as err:
            self.send_json({"error": err.message}, err.status)
        except (BrokenPipeError, ConnectionError, socket.timeout):
            self.close_connection = True
        except Exception:
            traceback.print_exc()
            self.close_connection = True
            try:
                self.send_json({"error": "Server error."}, 500)
            except OSError:
                pass

    def read_raw(self):
        try:
            size = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            size = -1
        if not 0 <= size <= MAX_BODY:
            self.close_connection = True
            if 0 < size <= 16 * MAX_BODY:        # read what was sent, or the client may see a reset, not our answer
                self.rfile.read(size)
            raise GameError("Request too large.", 413)
        return self.rfile.read(size) if size else b""

    def body(self):
        # Only our own pages send JSON: another website cannot (without a CORS preflight we never answer).
        if "application/json" not in self.headers.get("Content-Type", "").lower():
            raise GameError("Send JSON.", 415)
        try:
            data = json.loads(self.raw.decode("utf-8") or "{}")
        except (ValueError, UnicodeDecodeError):
            raise GameError("Bad request.")
        if not isinstance(data, dict):
            raise GameError("Bad request.")
        return data

    def send_bytes(self, status, payload, ctype, extra=()):
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        if ctype.startswith("text/html") and getattr(self, "served", "").startswith("/live/"):
            self.send_header("Content-Security-Policy", CSP)       # nicknames can never run as script
        for k, v in extra:
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(payload)

    def send_json(self, data, status=200):
        self.send_bytes(status, json.dumps(data).encode("utf-8"), "application/json; charset=utf-8")

    # ----- API -----
    def api(self, method, parts):
        hub = self.hub
        if parts == ["info"] and method == "GET":
            port = self.server.server_address[1]
            return self.send_json({"port": port, "join": ["http://%s:%d/play" % (ip, port) for ip in hub.local_ips()],
                                   "units": hub.unit_list(), "secs": list(SECS_CHOICES),
                                   "teams": list(TEAM_CHOICES), "count": [COUNT_MIN, COUNT_MAX, COUNT_DEFAULT]})
        if parts == ["games"] and method == "POST":
            if not hub.is_local(self.ip):
                raise GameError("Games can only be created on the teacher's computer.", 403)
            data = self.body()
            game = hub.create(data.get("units"), data.get("count", COUNT_DEFAULT), data.get("secs", 20),
                              data.get("teams", 0))
            return self.send_json({"pin": game.pin, "key": game.host_key, "total": len(game.questions)})
        if len(parts) < 2 or parts[0] != "games":
            raise GameError("Not found.", 404)
        pin, action = parts[1], (parts[2:] or [""])
        with hub.cond:
            game = hub.get(pin)
            teams = list(game.teams)
            state = game.state
        if action == [""] and method == "GET":
            return self.send_json({"pin": pin, "state": state, "teams": teams})
        if action == ["join"] and method == "POST":
            name, local = self.body().get("name", ""), hub.is_local(self.ip)
            with hub.cond:
                player = hub.join(hub.get(pin), name, self.ip, local)
                return self.send_json({"pid": player.pid, "token": player.token, "name": player.name})
        if action == ["answer"] and method == "POST":
            data = self.body()
            with hub.cond:
                hub.get(pin).answer(str(data.get("pid", "")), str(data.get("token", "")), data.get("q"),
                                    data.get("choice"))
                hub.notify(hub.get(pin))
            return self.send_json({"ok": True})
        if action == ["check"] and method == "GET":          # is this host / player still valid? (no stream)
            with hub.cond:
                if "key" in self.query:
                    game.check_host(self.query["key"])
                else:
                    game.player(self.query.get("pid", ""), self.query.get("token", ""))
            return self.send_json({"ok": True})
        if action == ["events"] and method == "GET":
            pid, token = self.query.get("pid", ""), self.query.get("token", "")
            with hub.cond:
                game.player(pid, token)
            return self.stream(pin, lambda g: g.snapshot_player(pid))
        if action == ["host", "events"] and method == "GET":
            with hub.cond:
                game.check_host(self.query.get("key", ""))
            return self.stream(pin, hub.host_snapshot)
        if action == ["results.csv"] and method == "GET":
            with hub.cond:
                game.check_host(self.query.get("key", ""))
                payload = csv_bytes(game)
            name = 'attachment; filename="live-results-%s-%s.csv"' % (pin, datetime.now().strftime("%Y-%m-%d"))
            return self.send_bytes(200, payload, "text/csv; charset=utf-8", [("Content-Disposition", name)])
        if action[0] in ("start", "next", "kick", "end") and method == "POST":
            data = self.body()
            with hub.cond:
                game.check_host(str(data.get("key", "")))
                if action[0] == "start":
                    game.start()
                elif action[0] == "next":
                    hub.expect(game, data.get("state"), data.get("index"))
                    game.next()
                elif action[0] == "kick":
                    game.kick(str(data.get("pid", "")))
                else:
                    hub.end(pin)
                    return self.send_json({"ok": True})
                hub.notify(game)
            return self.send_json({"ok": True})
        raise GameError("Not found.", 404)

    def stream(self, pin, make_snapshot):
        """Server-Sent Events: a full snapshot on connect and after every change. Reconnect-safe."""
        hub = self.hub
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Connection", "close")
        self.send_header("X-Accel-Buffering", "no")
        self.end_headers()
        self.close_connection = True
        self.wfile.write(b"retry: 1500\n\n")
        self.wfile.flush()
        version, shown = None, None
        while True:
            with hub.cond:
                game = hub.games.get(pin)
                if game is not None and not hub.stopping and game.version == version:
                    hub.cond.wait(HEARTBEAT)
                    game = hub.games.get(pin)
                if game is None or hub.stopping:
                    snap, last = {"state": "ended"}, True
                elif game.version != version:
                    version = game.version
                    snap = make_snapshot(game)
                    last = snap["state"] == "kicked"
                    # other people's answers change the version but not what this viewer sees
                    said = json.dumps({k: v for k, v in snap.items() if k not in ("v", "remaining_ms")}, sort_keys=True)
                    if said == shown:
                        snap = None
                    shown = said
                else:
                    snap, last = None, False
            chunk = b": ping\n\n" if snap is None else ("data: %s\n\n" % json.dumps(snap)).encode("utf-8")
            try:
                self.wfile.write(chunk)
                self.wfile.flush()
            except OSError:
                return
            if last:
                return

    # ----- files -----
    def static(self, path):
        if path in ("/live", "/live/"):
            return self.redirect("/live/host.html")
        if path in ("/play", "/play/"):
            path = "/live/play.html"
        elif path == "/":
            path = "/index.html"
        self.served = path
        base, rel = (LIVE, path[len("/live/"):]) if path.startswith("/live/") else (SITE, path.lstrip("/"))
        try:
            root = base.resolve()
            target = (root / unquote(rel)).resolve()
            inside = target.is_relative_to(root) and target.is_file()
        except (OSError, ValueError):
            inside = False
        if not inside:
            if path == "/favicon.ico":                     # browsers ask for it; the pages carry their own icon
                return self.send_bytes(204, b"", "image/x-icon")
            raise GameError("Not found.", 404)
        ctype = MIME.get(target.suffix.lower()) or mimetypes.guess_type(target.name)[0] or "application/octet-stream"
        self.send_bytes(200, target.read_bytes(), ctype)

    def redirect(self, where):
        self.send_bytes(302, b"", "text/plain", [("Location", where)])


class Server(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = os.name != "nt"      # on Windows this flag would let a second copy share the port
    request_queue_size = 128

    def server_bind(self):
        """HTTPServer.server_bind looks the address up in DNS (socket.getfqdn): seconds of nothing on
        some networks, and pointless here. Bind, and take the names as they are."""
        socketserver.TCPServer.server_bind(self)
        host, port = self.server_address[:2]
        self.server_name, self.server_port = host, port

    def handle_error(self, request, client_address):
        """Phones drop off Wi-Fi all the time: a vanished connection is not worth a traceback."""
        if isinstance(sys.exc_info()[1], (ConnectionError, TimeoutError)):
            return
        super().handle_error(request, client_address)


def make_server(hub, bind="127.0.0.1", port=0, verbose=False):
    handler = type("LiveHandler", (Handler,), {"hub": hub, "verbose": verbose})
    server = Server((bind, port), handler)
    hub.port = server.server_address[1]
    return server


# ---------- command line ----------
def banner(port, bind, ips):
    line = "=" * 64
    out = [line, "  Destination A2 - Live quiz", line, ""]
    if bind in ("127.0.0.1", "localhost"):
        out.append("  Faqat shu kompyuterdan ochiladi (telefonlar ulana olmaydi).")
    elif ips:
        out += ["  O'quvchilar telefonida shu manzilni ochadi:", ""]
        out += ["        http://%s:%d/play" % (ip, port) for ip in ips[:3]]
        out += ["", "  Hammasi bir xil Wi-Fi yoki telefondagi hotspot'da bo'lishi kerak."]
    else:
        out += ["  Tarmoq topilmadi. Telefonda hotspot'ni yoqing, kompyuterni unga ulang",
                "  va dasturni qayta ishga tushiring."]
    out += ["", "  O'qituvchi (siz) shu yerni ochasiz:", "", "        http://localhost:%d/live/host.html" % port, "",
            "  To'xtatish: Ctrl+C", line]
    return "\n".join(out)


def main(argv=None):
    ap = argparse.ArgumentParser(description="Destination A2 live quiz (Kahoot-style) for the classroom.")
    ap.add_argument("--port", type=int, help="port to listen on (default: first free one from 8000)")
    ap.add_argument("--bind", default="0.0.0.0", help="address to listen on (default: all, so phones can join)")
    ap.add_argument("--no-browser", action="store_true", help="do not open the host page automatically")
    ap.add_argument("--results", default=str(ROOT / "live-results"), help="folder for the results files (.csv)")
    ap.add_argument("--allow-remote-host", action="store_true",
                    help="let any device create games (by default only this computer can)")
    ap.add_argument("-v", "--verbose", action="store_true", help="print every request")
    args = ap.parse_args(argv)
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(errors="replace")
        except (AttributeError, ValueError):
            pass
    if not (LIVE / "host.html").is_file() or not SITE.is_dir():
        sys.exit("live/ or html/ is missing: run this from the project folder.")
    hub = Hub(load_bank(), args.results, allow_remote_host=args.allow_remote_host)
    server = None
    for port in ([args.port] if args.port is not None else DEFAULT_PORTS):
        try:
            server = make_server(hub, args.bind, port, args.verbose)
            break
        except OSError:
            continue
    if server is None:
        sys.exit("Could not open the port. Is live.py already running? Try: py live.py --port 8123")
    threading.Thread(target=hub.run_ticks, daemon=True).start()
    print(banner(hub.port, args.bind, hub.local_ips()), flush=True)
    if not args.no_browser:
        threading.Timer(0.6, webbrowser.open, ["http://localhost:%d/live/host.html" % hub.port]).start()
    try:
        server.serve_forever(poll_interval=0.25)
    except KeyboardInterrupt:
        print("\nTo'xtatildi.")
    finally:
        hub.stop()
        server.server_close()


if __name__ == "__main__":
    main()
