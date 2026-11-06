"""Multiplayer WebSocket tests: pen selection is stored and shared on game_start.

Self-contained: starts its own uvicorn server on a free port, no extra dependencies.
Run from the backend folder:  ./venv/bin/python tests/test_multiplayer.py
"""
import asyncio
import json
import os
import socket
import sys
import threading
import time

import uvicorn
import websockets

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from main import app  # noqa: E402


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


PORT = free_port()
BASE = f"ws://127.0.0.1:{PORT}/ws"


async def recv(ws):
    return json.loads(await asyncio.wait_for(ws.recv(), 3))


async def test_pens_shared_on_game_start():
    a = await websockets.connect(f"{BASE}/TST1?pen=gel")
    init_a = await recv(a)
    assert init_a == {"type": "init", "player_num": 1, "game_id": "TST1"}, init_a

    b = await websockets.connect(f"{BASE}/TST1?pen=marker")
    init_b = await recv(b)
    assert init_b["player_num"] == 2, init_b

    for ws in (a, b):
        start = await recv(ws)
        assert start["type"] == "game_start", start
        assert start["state"]["pens"] == {"1": "gel", "2": "marker"}, start

    # Room is full: a third player is rejected
    c = await websockets.connect(f"{BASE}/TST1?pen=gel")
    err = await recv(c)
    assert err["type"] == "error", err

    # Position sync is still forwarded
    await a.send(json.dumps({
        "type": "sync_move", "player": 1,
        "p1": {"x": 1, "y": 2, "angle": 3}, "p2": {"x": 4, "y": 5, "angle": 6},
    }))
    msg = await recv(b)
    assert msg["type"] == "sync_move", msg

    for ws in (a, b, c):
        await ws.close()


async def test_invalid_or_missing_pen_falls_back():
    c = await websockets.connect(f"{BASE}/TST2?pen=<script>")
    await recv(c)
    d = await websockets.connect(f"{BASE}/TST2")
    await recv(d)
    start = await recv(c)
    assert start["state"]["pens"] == {"1": "ballpoint", "2": "ballpoint"}, start
    for ws in (c, d):
        await ws.close()


def main():
    server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=PORT, log_level="warning"))
    threading.Thread(target=server.run, daemon=True).start()
    while not server.started:
        time.sleep(0.05)

    tests = [test_pens_shared_on_game_start, test_invalid_or_missing_pen_falls_back]
    failed = 0
    for t in tests:
        try:
            asyncio.run(t())
            print(f"PASS: {t.__name__}")
        except Exception as e:  # noqa: BLE001
            failed += 1
            print(f"FAIL: {t.__name__}: {e!r}")

    server.should_exit = True
    print(f"\n{len(tests) - failed}/{len(tests)} passed")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
