from pathlib import Path

class ShipLibrary:
    def __init__(self, shiptypes_path="../shiptypes.txt"):
        self.shiptypes_path = Path(shiptypes_path)
        self.ships = self.load_shiptypes()

    def load_shiptypes(self):
        """
        Load shiptypes.txt into a dictionary:
        {
            "Carrack": ["room_engineering", "room_medbay", ...],
            ...
        }
        """
        ships = {}
        current_ship = None

        with self.shiptypes_path.open("r", errors="ignore") as f:
            for line in f:
                line = line.strip()

                if not line:
                    continue

                # Ship name lines start with a bracket or a known pattern
                if not line.startswith("room_"):
                    current_ship = line
                    ships[current_ship] = []
                else:
                    ships[current_ship].append(line)

        return ships

    def save_shiptypes(self):
        """Write updated ship signatures back to shiptypes.txt."""
        with self.shiptypes_path.open("w") as f:
            for ship, rooms in self.ships.items():
                f.write(f"{ship}\n")
                for room in rooms:
                    f.write(f"{room}\n")
                f.write("\n")
