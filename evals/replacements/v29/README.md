# V29 replacement held-out pack

Status: exposed; do not reuse as an acceptance gate.

This 16-case pack covers four workflows, with 12 real-source cases and 4 synthetic team-roster cases. The real cases use new names, FM/Understat IDs, source-evidence bundle, and scenario families. `v29-lookup-dayot-profile` deliberately uses “Dayot Upamecano” from FM while the linked Understat row displays “Dayotchanculle Upamecano”; the Reep bridge links the two IDs.

The data rules are fixed in every case: Understat supplies season-scoped performance; FM supplies the dated ability snapshot; age is recalculated from birth date as of `2026-11-04`, separately from the FM snapshot date.

The interrupted attempt `fce32181-c454-41b7-bbc0-ddb2a6758282` stopped after the first trial and 4 model requests. It exposed a stale comparison contract: identity expansion correctly added Bruno Fernandes's Understat source ID, but the golden action expected only two participants' coverage. No calibration or semantic scoring ran. V29 is exposed; use V30 for the replacement gate.
