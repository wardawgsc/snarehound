import time
from pathlib import Path

class LogWatcher:
    def __init__(self, log_path="/mnt/c/Program Files/Roberts Space Industries/StarCitizen/LIVE/Game.log"):
        self.log_path = Path(log_path)

    def follow(self):
        """Yield new lines as they appear in the log file."""
        with self.log_path.open("r", errors="ignore") as f:
            # Move to the end of the file
            f.seek(0, 2)

            while True:
                line = f.readline()
                if not line:
                    time.sleep(0.1)
                    continue
                yield line.rstrip("\n")
