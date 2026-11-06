# V39 held-out replacement pack

Status: exposed; do not use for acceptance.

V39 contained 16 cases: 12 real-source and 4 synthetic team-roster cases. Run `9b99f1ab-3444-479b-919d-9a2636cd1f53` was stopped after 12/48 trials and 30 Agent requests. Three EPL comparison trials failed because the expected competition was still `Bundesliga`; nine trials were unassessed. Judge calibration did not start. There were no network failures or request denials.

The failure came from a stale case contract inherited from its source template, not from the observed Agent route: the user asked for EPL and the Agent used EPL. V39 is exposed. V40 is the next independent pack, with the explicit league text checked against its expected comparison condition before dispatch.
