# The reactive event plane — decision record (2026-10-30)

## Architect decisions (live ask receipts)
- **All substrates, one spine** (architect: "way too orthogonal — I want MULTIPLE of those"):
  kafka = durable log of record (:25144, broker verified LISTEN);
  squawk-ws = live fan-out to TUIs (:25147);
  MCP notifications = delivery INTO agent context (thresher — verified live this session);
  estate-chat = HTTP control API (:25120).
- **Controller: rig** — and rig IS the openfang fork (anomaly #49 cutover:
  openfang→rig, ~/.rig standardized). "Rig owns it" and "openfang fronts it"
  are the same statement: rig is BOTH the ACL/routing controller and the
  front door. Realization logged because the two options were secretly one.
- No polling: consumer groups replace GET /v1/todo (exactly-once claims);
  MCP notifications replace heartbeat-poll awareness.

## Failure-driven schema receipts feeding this design
- estate-chat API shape learned the hard way: from_agent required, then body
  (cleavage learned both — cleavage goniometer estate-chat).
- Deny-gate doctrine (bdfaf1cc72): denials are ROUTES; never advise config
  stripping; identity-resolved so full-path escapes are dead.
