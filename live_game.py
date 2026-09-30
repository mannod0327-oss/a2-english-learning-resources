"""Kahoot-style live quiz: the game rules, with no networking (live.py is the server).

One Game is one classroom session. The server calls these methods while holding a lock, so
nothing here is thread-aware. Time comes from an injectable clock so the rules can be tested
without sleeping.

Flow: lobby -> (question -> reveal) x N -> final. A question closes when everybody has
answered, when the countdown (plus a short grace) runs out, or when the host skips it.
Scoring follows Kahoot: a correct answer is worth 500-1000 points depending on speed, plus a
streak bonus of 100 per extra correct answer in a row (at most 500).
"""
import csv
import io
import secrets
import string
import time

MAX_PLAYERS = 100
NAME_MAX = 16
GRACE = 0.5                 # seconds the question stays open after the countdown hits zero
BASE_POINTS = 1000          # for an instant correct answer; the slowest one earns half
STREAK_STEP, STREAK_CAP = 100, 500
TEAM_NAMES = ["Lions", "Eagles", "Tigers", "Wolves", "Sharks", "Bears"]


def same(a, b):
    """Constant-time comparison that accepts any text (compare_digest refuses non-ASCII strings)."""
    return secrets.compare_digest(str(a).encode("utf-8", "replace"), str(b).encode("utf-8", "replace"))


class GameError(Exception):
    """A request the rules refuse; `status` is the HTTP code the server answers with."""

    def __init__(self, message, status=400):
        super().__init__(message)
        self.message, self.status = message, status


def clean_name(raw):
    """One line, printable characters only, at most NAME_MAX long."""
    text = "".join(ch for ch in str(raw) if ch.isprintable())
    return " ".join(text.split())[:NAME_MAX].strip()


def csv_cell(value):
    """Stop spreadsheet programs from running a player's nickname as a formula."""
    text = str(value)
    return "'" + text if text[:1] in ("=", "+", "-", "@", "\t", "\r") else text


class Player:
    __slots__ = ("pid", "token", "name", "team", "score", "streak", "answers")

    def __init__(self, pid, token, name, team):
        self.pid, self.token, self.name, self.team = pid, token, name, team
        self.score = 0
        self.streak = 0
        self.answers = {}   # question index -> (choice, seconds taken, points)


class Game:
    def __init__(self, pin, host_key, questions, secs, team_count=0, clock=time.monotonic):
        """questions: [{"id", "q", "options": [...], "correct": index}] in play order."""
        if not questions:
            raise GameError("A game needs at least one question.")
        self.pin, self.host_key = pin, host_key
        self.questions, self.secs, self.clock = questions, secs, clock
        self.teams = TEAM_NAMES[:team_count] if team_count else []
        self.state = "lobby"
        self.index = -1
        self.players = {}       # pid -> Player, in joining order
        self.started_at = 0.0   # when the current question opened
        self.version = 0        # bumped on every change so streams know to resend
        self.touched = clock()

    # ---------- housekeeping ----------
    def _touch(self):
        self.version += 1
        self.touched = self.clock()

    def player(self, pid, token):
        p = self.players.get(pid)
        if p is None or not same(p.token, token):
            raise GameError("You are not in this game any more.", 403)
        return p

    def check_host(self, key):
        if not same(self.host_key, key):
            raise GameError("Only the host can do that.", 403)

    # ---------- players ----------
    def join(self, name):
        if self.state == "final":
            raise GameError("This game is over.", 409)
        name = clean_name(name)
        if not name:
            raise GameError("Type a nickname (1-%d characters)." % NAME_MAX)
        if len(self.players) >= MAX_PLAYERS:
            raise GameError("This game is full.", 409)
        if any(p.name.lower() == name.lower() for p in self.players.values()):
            raise GameError("That nickname is taken. Try another one.", 409)
        team = None
        if self.teams:   # keep teams balanced: the smallest team gets the newcomer
            sizes = [sum(1 for p in self.players.values() if p.team == t) for t in range(len(self.teams))]
            team = sizes.index(min(sizes))
        pid = secrets.token_hex(4)
        while pid in self.players:
            pid = secrets.token_hex(4)
        p = self.players[pid] = Player(pid, secrets.token_urlsafe(12), name, team)
        self._touch()
        return p

    def kick(self, pid):
        if self.players.pop(pid, None) is None:
            raise GameError("No such player.", 404)
        self._touch()
        if self.state == "question" and self.players and self._everyone_answered():
            self._close()

    # ---------- host controls ----------
    def start(self):
        if self.state != "lobby":
            raise GameError("The game has already started.", 409)
        if not self.players:
            raise GameError("Wait for at least one player.", 409)
        self._open(0)

    def next(self):
        """Question -> skip to the answer. Answer -> next question, or the podium after the last."""
        if self.state == "question":
            self._close()
        elif self.state == "reveal":
            if self.index + 1 < len(self.questions):
                self._open(self.index + 1)
            else:
                self.state = "final"
                self._touch()
        else:
            raise GameError("There is nothing to advance.", 409)

    def tick(self):
        """Called a few times a second; closes a question whose time has run out."""
        if self.state == "question" and self.clock() - self.started_at >= self.secs + GRACE:
            self._close()
            return True
        return False

    def _open(self, i):
        self.index, self.state, self.started_at = i, "question", self.clock()
        self._touch()

    def _close(self):
        for p in self.players.values():
            if self.index not in p.answers:
                p.streak = 0            # no answer breaks the streak
        self.state = "reveal"
        self._touch()

    def _everyone_answered(self):
        return all(self.index in p.answers for p in self.players.values())

    # ---------- answering ----------
    def answer(self, pid, token, qi, choice):
        p = self.player(pid, token)
        if self.state != "question" or qi != self.index:
            raise GameError("Too late for this question.", 409)
        if qi in p.answers:
            raise GameError("You have already answered.", 409)
        q = self.questions[qi]
        if isinstance(choice, bool) or not isinstance(choice, int) or not 0 <= choice < len(q["options"]):
            raise GameError("Unknown option.")
        taken = min(max(self.clock() - self.started_at, 0.0), self.secs)
        points = 0
        if choice == q["correct"]:
            p.streak += 1
            points = round(BASE_POINTS * (1 - taken / self.secs / 2))
            points += min(p.streak - 1, STREAK_CAP // STREAK_STEP) * STREAK_STEP
        else:
            p.streak = 0
        p.score += points
        p.answers[qi] = (choice, taken, points)
        if self._everyone_answered():
            self._close()
        else:
            self._touch()

    # ---------- what clients are shown ----------
    def standings(self):
        """Players best first (ties keep alphabetical order), each with a 1-based rank."""
        order = sorted(self.players.values(), key=lambda p: (-p.score, p.name.lower()))
        return [(rank, p) for rank, p in enumerate(order, 1)]

    def team_standings(self):
        if not self.teams:
            return []
        totals = [{"team": t, "name": n, "score": 0, "players": 0} for t, n in enumerate(self.teams)]
        for p in self.players.values():
            totals[p.team]["score"] += p.score
            totals[p.team]["players"] += 1
        return sorted(totals, key=lambda t: (-t["score"], t["team"]))

    def _remaining_ms(self):
        return max(0, int((self.secs - (self.clock() - self.started_at)) * 1000))

    def _question_view(self, reveal):
        q = self.questions[self.index]
        view = {"index": self.index, "total": len(self.questions), "id": q["id"], "text": q["q"],
                "options": q["options"]}
        if reveal:
            view["correct"] = q["correct"]
        return view

    def _points_this_question(self, p):
        return p.answers.get(self.index, (None, 0, 0))[2]

    def snapshot_host(self):
        s = {"v": self.version, "pin": self.pin, "state": self.state, "secs": self.secs,
             "total": len(self.questions), "teams": self.teams,
             "players": [{"id": p.pid, "name": p.name, "team": p.team} for p in self.players.values()]}
        if self.state in ("question", "reveal"):
            s["question"] = self._question_view(self.state == "reveal")
            s["answered"] = sum(1 for p in self.players.values() if self.index in p.answers)
        if self.state == "question":
            s["remaining_ms"] = self._remaining_ms()
        if self.state == "reveal":
            counts = [0] * len(self.questions[self.index]["options"])
            for p in self.players.values():
                if self.index in p.answers:
                    counts[p.answers[self.index][0]] += 1
            s["counts"] = counts
            s["last"] = self.index + 1 == len(self.questions)
            s["board"] = [{"name": p.name, "team": p.team, "score": p.score,
                           "gained": self._points_this_question(p), "streak": p.streak}
                          for _, p in self.standings()[:5]]
            s["team_board"] = self.team_standings()
        if self.state == "final":
            s["board"] = [{"rank": r, "name": p.name, "team": p.team, "score": p.score,
                           "correct": self._correct_count(p)} for r, p in self.standings()]
            s["team_board"] = self.team_standings()
        return s

    def _correct_count(self, p):
        return sum(1 for qi, (choice, _, _) in p.answers.items() if choice == self.questions[qi]["correct"])

    def snapshot_player(self, pid):
        p = self.players.get(pid)
        if p is None:
            return {"state": "kicked"}
        s = {"v": self.version, "pin": self.pin, "state": self.state, "name": p.name, "secs": self.secs,
             "total": len(self.questions), "team": None if p.team is None else self.teams[p.team],
             "team_index": p.team}
        if self.state == "question":
            s["question"] = self._question_view(False)
            s["remaining_ms"] = self._remaining_ms()
            s["chosen"] = p.answers[self.index][0] if self.index in p.answers else None
        elif self.state == "reveal":
            s["question"] = self._question_view(True)
            choice, _, points = p.answers.get(self.index, (None, 0, 0))
            ranks = self.standings()
            rank = next(r for r, x in ranks if x is p)
            ahead = ranks[rank - 2][1] if rank > 1 else None
            s["result"] = {"chosen": choice, "right": None if choice is None else choice == s["question"]["correct"],
                           "points": points, "streak": p.streak, "score": p.score, "rank": rank,
                           "players": len(ranks), "behind": None if ahead is None else
                           {"name": ahead.name, "gap": ahead.score - p.score}}
        elif self.state == "final":
            ranks = self.standings()
            s["result"] = {"rank": next(r for r, x in ranks if x is p), "players": len(ranks), "score": p.score,
                           "correct": self._correct_count(p), "answered": len(p.answers)}
            s["team_board"] = self.team_standings()
        return s

    # ---------- results for the teacher ----------
    def results_csv(self):
        """Per-player table, then a per-question summary. Excel-friendly; text is formula-safe."""
        out = io.StringIO()
        w = csv.writer(out, lineterminator="\r\n")
        n = len(self.questions)
        head = ["Rank", "Name"] + (["Team"] if self.teams else []) + ["Score", "Correct", "Answered",
                                                                     "Avg seconds"]
        w.writerow(head + ["Q%d" % (i + 1) for i in range(n)])
        for rank, p in self.standings():
            times = [t for _, t, _ in p.answers.values()]
            row = [rank, csv_cell(p.name)] + ([self.teams[p.team]] if self.teams else [])
            row += [p.score, self._correct_count(p), len(p.answers),
                    "%.1f" % (sum(times) / len(times)) if times else ""]
            for i in range(n):
                a = p.answers.get(i)
                row.append("" if a is None else "right" if a[0] == self.questions[i]["correct"] else "wrong")
            w.writerow(row)
        w.writerow([])
        w.writerow(["Question", "Text", "Right", "Wrong", "No answer", "% right"])
        for i, q in enumerate(self.questions):
            answers = [p.answers.get(i) for p in self.players.values()]
            right = sum(1 for a in answers if a and a[0] == q["correct"])
            wrong = sum(1 for a in answers if a and a[0] != q["correct"])
            total = len(answers)
            w.writerow(["Q%d" % (i + 1), csv_cell(q["q"]), right, wrong, total - right - wrong,
                        round(100 * right / total) if total else ""])
        return out.getvalue()


def new_pin(taken):
    """A 6-digit game PIN that no running game uses."""
    while True:
        pin = "".join(secrets.choice(string.digits) for _ in range(6))
        if pin not in taken:
            return pin
