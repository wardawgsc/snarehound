from difflib import SequenceMatcher

class ShipMatcher:
    def __init__(self, ship_library):
        self.ship_library = ship_library

    def match(self, rooms, is_snapshot=False):
        """
        Match a list of room codes to the best ship.
        Returns:
        {
            "ship": "Carrack",
            "confidence": 0.92,
            "is_snapshot": True/False
        }
        """

        best_ship = None
        best_score = 0.0

        for ship, sig_rooms in self.ship_library.ships.items():
            score = self.compare_room_sets(rooms, sig_rooms)

            if score > best_score:
                best_score = score
                best_ship = ship

        if best_ship is None:
            return None

        # Apply station prefix
        if is_snapshot:
            best_ship = f"(S) {best_ship}"

        return {
            "ship": best_ship,
            "confidence": round(best_score, 3),
            "is_snapshot": is_snapshot
        }

    def compare_room_sets(self, detected, signature):
        """
        Compare detected room codes to a ship signature.
        Simple scoring: (# of matches) / (signature length)
        """
        if not signature:
            return 0.0

        matches = sum(1 for r in detected if r in signature)
        return matches / len(signature)
