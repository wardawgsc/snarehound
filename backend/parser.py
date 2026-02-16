import re

class LogParser:
    ROOM_PATTERN = re.compile(r"room_[A-Za-z0-9_]+")
    SNAPSHOT_PATTERN = re.compile(r"initial snapshot", re.IGNORECASE)

    def parse_line(self, line: str):
        """
        Parse a single log line and extract:
        - room codes
        - whether it's an initial snapshot
        - whether the line is relevant
        """

        # Extract room codes
        rooms = self.ROOM_PATTERN.findall(line)

        # If no rooms, this line is irrelevant
        if not rooms:
            return None

        # Detect station-spawned ships
        is_snapshot = bool(self.SNAPSHOT_PATTERN.search(line))

        return {
            "rooms": rooms,
            "is_snapshot": is_snapshot,
            "raw": line
        }
