# V25 replacement held-out pack

Status: exposed; do not reuse for tuning or acceptance.

Run `e5dde68f-5ae0-4ab8-8ae7-ea6ba6b05d2a` was stopped after 17/48 trials and 55 requests. It found two Understat player rows whose case `sourceScope` said `La_liga` while the fixed snapshots and required facts said `Bundesliga`. V25 is diagnostic only. V26 has a preflight check that rejects such scope/data mismatches before model dispatch.
