# Risk Register

## Risks
- API instability from upstream providers.
- Behavior drift from legacy detection logic.
- Discord policy changes affecting role checks.
- Regression in Windows game automation behavior.

## Mitigations
- Contract tests and replay fixtures.
- Shadow mode parity checks.
- Retries/circuit breakers and feature flags.
- Pilot rollout before full cutover.
