# V42 held-out replacement pack

Status: exposed; do not use for acceptance.

V42 contained 16 cases and fresh identities/source IDs. Run `ed7b544a-c400-4ddb-8529-197ecf9eba9f` was stopped after 36/48 trials and 105 Agent requests. One player-recommendation trial failed because the request parser omitted an explicit “up to three” limit; the default candidate pool happened to contain three players. The other 35 trials were unassessed. Judge calibration had not started. There were no network failures or request denials.

The parser now derives explicit English and Chinese result limits deterministically and applies them after model extraction. A Vitest regression covers both `up to three` and `最多 3 名`. V42 is exposed; V43 is the next independent pack.
