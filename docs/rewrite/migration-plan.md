# Migration Plan

1. Build v2 in parallel under `v2/`.
2. Mirror legacy detection behavior with replay fixtures.
3. Shadow-run v2 and compare lookup/push outcomes.
4. Pilot with small user group.
5. Cut over with rollback window.
