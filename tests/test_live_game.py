"""Rules of the live quiz (live_game.py): scoring, phases, teams, results. No network, no sleeping."""
import csv
import io
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import live_game  # noqa: E402
from live_game import Game, GameError  # noqa: E402


class Clock:
    def __init__(self):
        self.now = 1000.0

    def __call__(self):
        return self.now

    def advance(self, seconds):
        self.now += seconds


def questions(n=3):
    return [{"id": f"q{i}", "q": f"Question {i} ___ here?", "options": ["right", "wrong", "other"], "correct": 0}
            for i in range(n)]


@pytest.fixture
def clock():
    return Clock()


def make(clock, n=3, secs=20, teams=0):
    return Game("123456", "hostkey", questions(n), secs, teams, clock)


def join(game, *names):
    return [game.join(n) for n in names]


def ans(game, player, qi, choice):
    game.answer(player.pid, player.token, qi, choice)


# ---------- joining ----------
def test_a_game_needs_questions(clock):
    with pytest.raises(GameError):
        Game("1", "k", [], 20, 0, clock)


def test_join_cleans_and_checks_names(clock):
    g = make(clock)
    assert g.join("  Ada   Lovelace  ").name == "Ada Lovelace"
    assert g.join("x" * 40).name == "x" * live_game.NAME_MAX
    assert g.join("tab\there\nnew").name == "tabherenew"
    for bad in ("", "   ", "​\x07"):
        with pytest.raises(GameError) as e:
            g.join(bad)
        assert e.value.status == 400


def test_duplicate_nickname_is_refused_ignoring_case(clock):
    g = make(clock)
    g.join("Sardor")
    with pytest.raises(GameError) as e:
        g.join("sARDOR")
    assert e.value.status == 409


def test_game_is_full_at_the_limit(clock, monkeypatch):
    monkeypatch.setattr(live_game, "MAX_PLAYERS", 3)
    g = make(clock)
    join(g, "a", "b", "c")
    with pytest.raises(GameError) as e:
        g.join("d")
    assert e.value.status == 409


def test_cannot_join_a_finished_game(clock):
    g = make(clock, n=1)
    (p,) = join(g, "a")
    g.start()
    ans(g, p, 0, 0)
    g.next()
    assert g.state == "final"
    with pytest.raises(GameError):
        g.join("late")


def test_late_joiners_are_welcome_mid_game(clock):
    g = make(clock)
    join(g, "a")
    g.start()
    late = g.join("late")
    assert late.score == 0 and g.state == "question"


def test_player_token_is_checked(clock):
    g = make(clock)
    (p,) = join(g, "a")
    assert g.player(p.pid, p.token) is p
    for pid, token in ((p.pid, "nope"), ("missing", p.token), (p.pid, "")):
        with pytest.raises(GameError) as e:
            g.player(pid, token)
        assert e.value.status == 403


def test_host_key_is_checked(clock):
    g = make(clock)
    g.check_host("hostkey")
    with pytest.raises(GameError) as e:
        g.check_host("guess")
    assert e.value.status == 403


# ---------- flow ----------
def test_cannot_start_without_players_or_twice(clock):
    g = make(clock)
    with pytest.raises(GameError):
        g.start()
    join(g, "a")
    g.start()
    with pytest.raises(GameError):
        g.start()


def test_full_flow_lobby_question_reveal_final(clock):
    g = make(clock, n=2)
    (p,) = join(g, "a")
    assert g.state == "lobby"
    with pytest.raises(GameError):
        g.next()
    g.start()
    assert (g.state, g.index) == ("question", 0)
    ans(g, p, 0, 0)
    assert g.state == "reveal"          # the only player answered, so it closes at once
    g.next()
    assert (g.state, g.index) == ("question", 1)
    g.next()                            # host skips
    assert g.state == "reveal"
    snap = g.snapshot_host()
    assert snap["last"] is True
    g.next()
    assert g.state == "final"
    with pytest.raises(GameError):
        g.next()


def test_question_closes_when_time_is_up(clock):
    g = make(clock, secs=10)
    join(g, "a", "b")
    g.start()
    clock.advance(10.4)
    assert g.tick() is False and g.state == "question"     # still inside the grace period
    clock.advance(0.2)
    assert g.tick() is True and g.state == "reveal"
    assert g.tick() is False


def test_version_changes_on_every_change(clock):
    g = make(clock)
    v = g.version
    (p,) = join(g, "a", "b")[:1]
    assert g.version > v
    v = g.version
    g.start()
    assert g.version > v
    v = g.version
    ans(g, p, 0, 0)
    assert g.version > v


# ---------- answering & scoring ----------
def test_instant_correct_answer_scores_full_marks_and_slowest_half(clock):
    g = make(clock, secs=20)
    a, b, c = join(g, "a", "b", "c")
    g.start()
    ans(g, a, 0, 0)                      # at t=0
    clock.advance(10)
    ans(g, b, 0, 0)                      # halfway
    clock.advance(10)
    ans(g, c, 0, 0)                      # at the buzzer
    assert (a.score, b.score, c.score) == (1000, 750, 500)


def test_wrong_answer_scores_nothing_and_breaks_the_streak(clock):
    g = make(clock)
    (p,) = join(g, "a")
    g.start()
    ans(g, p, 0, 0)
    assert p.streak == 1
    g.next()
    ans(g, p, 1, 1)
    assert p.score == 1000 and p.streak == 0
    assert p.answers[1][2] == 0


def test_streak_bonus_grows_by_100_and_stops_at_500(clock):
    g = make(clock, n=8)
    (p,) = join(g, "a")
    g.start()
    gained = []
    for qi in range(8):
        before = p.score
        ans(g, p, qi, 0)
        gained.append(p.score - before)
        if qi < 7:
            g.next()
    assert gained == [1000, 1100, 1200, 1300, 1400, 1500, 1500, 1500]


def test_unanswered_question_resets_the_streak(clock):
    g = make(clock, secs=10)
    a, b = join(g, "a", "b")
    g.start()
    ans(g, a, 0, 0)
    ans(g, b, 0, 0)
    g.next()
    ans(g, a, 1, 0)                      # b stays silent
    clock.advance(11)
    g.tick()
    assert (a.streak, b.streak) == (2, 0)


def test_answer_is_refused_out_of_turn(clock):
    g = make(clock)
    a, b = join(g, "a", "b")
    with pytest.raises(GameError) as e:
        ans(g, a, 0, 0)                  # lobby
    assert e.value.status == 409
    g.start()
    with pytest.raises(GameError):
        ans(g, a, 1, 0)                  # wrong question number
    ans(g, a, 0, 0)
    with pytest.raises(GameError):
        ans(g, a, 0, 1)                  # already answered
    g.next()                             # reveal
    with pytest.raises(GameError):
        ans(g, b, 0, 0)                  # too late
    assert a.answers[0][0] == 0


@pytest.mark.parametrize("choice", [-1, 3, 99, "0", None, 1.0, True])
def test_unknown_choices_are_rejected(clock, choice):
    g = make(clock)
    (p,) = join(g, "a")
    g.start()
    with pytest.raises(GameError) as e:
        ans(g, p, 0, choice)
    assert e.value.status == 400
    assert 0 not in p.answers            # and the player may still answer


def test_answer_time_is_clamped_to_the_question_length(clock):
    g = make(clock, secs=10)
    a, b = join(g, "a", "b")
    g.start()
    clock.advance(10.4)                  # inside the grace period: counts as the last instant
    ans(g, a, 0, 0)
    assert a.score == 500
    assert a.answers[0][1] == 10


def test_kicking_the_last_unanswered_player_closes_the_question(clock):
    g = make(clock)
    a, b = join(g, "a", "b")
    g.start()
    ans(g, a, 0, 0)
    assert g.state == "question"
    g.kick(b.pid)
    assert g.state == "reveal"
    assert g.snapshot_player(b.pid) == {"state": "kicked"}
    with pytest.raises(GameError) as e:
        g.kick("nobody")
    assert e.value.status == 404


# ---------- teams ----------
def test_teams_are_kept_balanced(clock):
    g = make(clock, teams=3)
    players = join(g, *"abcdefg")
    sizes = [sum(1 for p in players if p.team == t) for t in range(3)]
    assert sorted(sizes) == [2, 2, 3]
    assert g.teams == live_game.TEAM_NAMES[:3]
    g.kick(players[2].pid)                   # team 2 is now the smallest
    assert g.join("z").team == players[2].team


def test_team_standings_add_up_member_scores(clock):
    g = make(clock, teams=2)
    a, b, c = join(g, "a", "b", "c")     # a -> team 0, b -> team 1, c -> team 0
    g.start()
    ans(g, a, 0, 0)
    ans(g, b, 0, 1)
    ans(g, c, 0, 0)
    board = {t["team"]: t for t in g.team_standings()}
    assert board[0]["score"] == a.score + c.score and board[0]["players"] == 2
    assert board[1]["score"] == 0 and board[1]["players"] == 1
    assert g.team_standings()[0]["team"] == 0


def test_no_team_board_without_teams(clock):
    g = make(clock)
    join(g, "a")
    assert g.team_standings() == []
    assert g.snapshot_host()["teams"] == []


# ---------- what each side is shown ----------
def test_players_never_see_the_answer_before_the_reveal(clock):
    g = make(clock)
    a, b = join(g, "a", "b")
    g.start()
    for snap in (g.snapshot_player(a.pid), g.snapshot_host()):
        assert snap["state"] == "question"
        assert "correct" not in snap["question"]
        assert 0 < snap["remaining_ms"] <= 20000
    ans(g, a, 0, 1)
    snap = g.snapshot_player(a.pid)
    assert snap["chosen"] == 1 and "result" not in snap
    g.next()
    snap = g.snapshot_player(a.pid)
    assert snap["question"]["correct"] == 0
    assert snap["result"]["right"] is False and snap["result"]["chosen"] == 1
    assert g.snapshot_host()["counts"] == [0, 1, 0]


def test_reveal_tells_each_player_their_rank_and_the_gap(clock):
    g = make(clock, secs=20)
    a, b, c = join(g, "a", "b", "c")
    g.start()
    ans(g, a, 0, 0)
    clock.advance(10)
    ans(g, b, 0, 0)
    g.next()
    ra, rb, rc = (g.snapshot_player(p.pid)["result"] for p in (a, b, c))
    assert (ra["rank"], rb["rank"], rc["rank"]) == (1, 2, 3)
    assert ra["behind"] is None
    assert rb["behind"] == {"name": "a", "gap": 250}
    assert rc["right"] is None and rc["points"] == 0 and rc["chosen"] is None
    assert ra["players"] == 3


def test_leaderboard_ties_are_alphabetical(clock):
    g = make(clock)
    z, m = join(g, "Zed", "amy")
    g.start()
    ans(g, z, 0, 0)
    ans(g, m, 0, 0)
    assert z.score == m.score
    assert [(r, p.name) for r, p in g.standings()] == [(1, "amy"), (2, "Zed")]


def test_final_snapshots_list_everyone(clock):
    g = make(clock, n=1)
    a, b = join(g, "a", "b")
    g.start()
    ans(g, a, 0, 0)
    ans(g, b, 0, 2)
    g.next()
    assert g.state == "final"
    board = g.snapshot_host()["board"]
    assert [(r["rank"], r["name"], r["correct"]) for r in board] == [(1, "a", 1), (2, "b", 0)]
    assert g.snapshot_player(a.pid)["result"] == {"rank": 1, "players": 2, "score": a.score, "correct": 1,
                                                  "answered": 1}


def test_reveal_board_shows_only_the_top_five(clock):
    g = make(clock)
    players = join(g, *"abcdefgh")
    g.start()
    for p in players:
        ans(g, p, 0, 0)
    assert len(g.snapshot_host()["board"]) == 5


# ---------- results file ----------
def read_csv(text):
    return list(csv.reader(io.StringIO(text)))


def test_results_csv_has_players_and_question_summary(clock):
    g = make(clock, n=2)
    a, b = join(g, "a", "b")
    g.start()
    ans(g, a, 0, 0)
    ans(g, b, 0, 1)
    g.next()
    ans(g, a, 1, 0)
    g.next()                                  # b skipped question 2
    rows = read_csv(g.results_csv())
    assert rows[0] == ["Rank", "Name", "Score", "Correct", "Answered", "Avg seconds", "Q1", "Q2"]
    assert rows[1][:2] == ["1", "a"] and rows[1][6:] == ["right", "right"]
    assert rows[2][:2] == ["2", "b"] and rows[2][6:] == ["wrong", ""]
    summary = rows[4:]
    assert summary[0] == ["Question", "Text", "Right", "Wrong", "No answer", "% right"]
    assert summary[1][2:] == ["1", "1", "0", "50"]
    assert summary[2][2:] == ["1", "0", "1", "50"]


def test_results_csv_with_teams_has_a_team_column(clock):
    g = make(clock, teams=2)
    join(g, "a", "b")
    rows = read_csv(g.results_csv())
    assert rows[0][:3] == ["Rank", "Name", "Team"]
    assert {rows[1][2], rows[2][2]} == {"Lions", "Eagles"}


def test_results_csv_neutralises_formulas_in_nicknames(clock):
    g = make(clock)
    join(g, "=1+1", "+SUM(A1)", "@cmd", "-2")
    names = [row[1] for row in read_csv(g.results_csv())[1:5]]
    assert all(n.startswith("'") for n in names), names
    assert live_game.csv_cell("Plain") == "Plain" and live_game.csv_cell(42) == "42"


def test_results_csv_handles_an_empty_game(clock):
    g = make(clock)
    rows = read_csv(g.results_csv())
    assert rows[0][0] == "Rank"
    assert rows[-1][-1] == "" and rows[-1][2:5] == ["0", "0", "0"]


# ---------- pins ----------
def test_new_pin_is_six_digits_and_unused():
    taken = set()
    for _ in range(200):
        pin = live_game.new_pin(taken)
        assert len(pin) == 6 and pin.isdigit() and pin not in taken
        taken.add(pin)
