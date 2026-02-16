from fastapi import FastAPI
from fastapi.responses import JSONResponse
from threading import Thread
from queue import Queue, Empty

from log_watcher import LogWatcher
from parser import LogParser
from ships import ShipLibrary
from shipmatcher import ShipMatcher

app = FastAPI()

# Initialize components
log_path = "/mnt/c/Program Files/Roberts Space Industries/StarCitizen/LIVE/Game.log"
watcher = LogWatcher(log_path)
parser = LogParser()
shiplib = ShipLibrary("../shiptypes.txt")
matcher = ShipMatcher(shiplib)

# Queue for parsed events
event_queue = Queue()

def event_loop():
    """Background thread that watches the log and pushes events into the queue."""
    for line in watcher.follow():
        parsed = parser.parse_line(line)
        if not parsed:
            continue

        match = matcher.match(parsed["rooms"], parsed["is_snapshot"])
        if match:
            event_queue.put(match)

# Start background thread
thread = Thread(target=event_loop, daemon=True)
thread.start()

@app.get("/health")
def health():
    return {"status": "ok"}

@app.get("/next_event")
def next_event():
    """AHK calls this repeatedly to get the next ship detection."""
    try:
        event = event_queue.get_nowait()
        return JSONResponse(event)
    except Empty:
        return JSONResponse({
            "event": "none",
            "ship": None,
            "confidence": 0.0
        })

@app.post("/correct_ship")
def correct_ship(wrong_ship: str, correct_ship: str):
    """
    AHK calls this when the user presses the correction button.
    Updates shiptypes.txt so Snarehound learns.
    """
    # Move room signatures from wrong ship to correct ship
    if wrong_ship in shiplib.ships:
        rooms = shiplib.ships.pop(wrong_ship)
        shiplib.ships.setdefault(correct_ship, []).extend(rooms)
        shiplib.save_shiptypes()

    return {"status": "updated"}
