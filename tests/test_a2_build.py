"""Checks for the A2 practice-site generator: content rules, reproducible output, export files."""
import importlib.util
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

PROJECT = Path(__file__).resolve().parent.parent
SOURCES = [
    "build.py",
    "units_a.py",
    "units_b.py",
    "units_c.py",
    "readings_a.py",
    "readings_b.py",
    "review_items.py",
]
DATA_MODULES = ("units_a", "units_b", "units_c", "readings_a", "readings_b", "review_items")
HTML_PAGES = 42 + 42 + 14 + 2 + 4  # units, worksheets, reviews, progress tests, placement/quiz/mistakes/index


def lf(data: bytes) -> bytes:
    """Builds made on Windows write CRLF; the repository stores LF."""
    return data.replace(b"\r\n", b"\n")


@pytest.fixture(scope="module")
def build_module():
    sys.path.insert(0, str(PROJECT))
    try:
        spec = importlib.util.spec_from_file_location("a2_build", PROJECT / "build.py")
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        yield module
    finally:
        sys.path.remove(str(PROJECT))
        for name in DATA_MODULES:
            sys.modules.pop(name, None)


@pytest.fixture(scope="module")
def rebuilt(tmp_path_factory):
    """Runs build.py on a copy of the sources so the committed files are never touched."""
    pytest.importorskip("openpyxl")
    work = tmp_path_factory.mktemp("a2-build")
    for name in SOURCES:
        shutil.copy2(PROJECT / name, work / name)
    shutil.copytree(PROJECT / "static", work / "static")
    env = {**os.environ, "PYTHONDONTWRITEBYTECODE": "1"}
    subprocess.run([sys.executable, "build.py"], cwd=work, env=env, check=True, capture_output=True, timeout=300)
    return work


def test_content_passes_the_generator_checks(build_module):
    build_module.validate()


def test_book_structure(build_module):
    assert [u["n"] for u in build_module.UNITS] == list(range(1, 43))
    files = [entry[0] for entry in build_module.SEQ]
    assert len(files) == 42 + 14 + 2
    assert files.count("progress-test-1.html") == 1
    assert files.count("progress-test-2.html") == 1


def test_committed_html_matches_a_fresh_build(rebuilt):
    built = sorted(p.name for p in (rebuilt / "html").glob("*.html"))
    committed = sorted(p.name for p in (PROJECT / "html").glob("*.html"))
    assert built == committed
    assert len(built) == HTML_PAGES
    stale = [
        name
        for name in built
        if lf((rebuilt / "html" / name).read_bytes()) != lf((PROJECT / "html" / name).read_bytes())
    ]
    assert not stale, f"html/ is out of date, run `python build.py` ({stale[:5]})"
    home = "artifact-home.html"
    assert lf((rebuilt / home).read_bytes()) == lf((PROJECT / home).read_bytes())


def test_spreadsheet_exports_are_complete(rebuilt):
    for root in (rebuilt / "html", PROJECT / "html"):
        listed = set(json.loads((root / "xlsx-files.json").read_text(encoding="utf-8")))
        on_disk = {p.relative_to(root).as_posix() for p in root.rglob("*") if p.suffix in {".xlsx", ".zip"}}
        assert listed == on_disk
        assert len(on_disk) == 2 * 42 + 2  # per-unit Kahoot + Quizizz files, plus one zip for each


def test_xlsx_index_ends_with_a_newline(rebuilt):
    """The repository's CI rejects text files without a trailing newline."""
    assert (rebuilt / "html" / "xlsx-files.json").read_bytes().endswith(b"\n")
    assert (PROJECT / "html" / "xlsx-files.json").read_bytes().endswith(b"\n")
