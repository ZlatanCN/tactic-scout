# V40 held-out replacement pack

Status: exposed; do not use for acceptance.

V40 included 16 cases and fresh identities, source IDs, and synthetic team evidence. Run `ec24f5ed-5552-4b48-8f89-691802a4ca52` was stopped after 24/48 trials and 68 Agent requests. Three trials failed on the accentless `Jorgen Strand Larsen` query because the resolver did not match it to source spelling `Jørgen Strand Larsen`; 21 trials were unassessed. Judge calibration did not start. There were no network failures or request denials.

The resolver now folds common Latin spelling variants during local search and keeps records with different Reep IDs separate. A temporary SQLite integration test reproduced the failure and verifies both matching and identity separation. V40 remains exposed; V41 is the next independent pack.
