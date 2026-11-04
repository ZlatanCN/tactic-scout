# V27 replacement held-out pack

Status: exposed; do not reuse as an acceptance gate.

This pack contains 16 cases, balanced across the four workflows. It uses new player identities and source records for the real-data cases and a new synthetic API-Football roster fixture for team recommendations. Its cases were not used for earlier model tuning.

The source boundary is explicit: the fixed FM snapshot supports CA, PA, natural positions, and attributes. Understat supports only the performance fields returned for its specific competition and season. Current registration, injuries, availability, transfer status, and other time-sensitive facts require a source that actually covers the requested period; FM cannot substantiate them.

The interrupted attempt `4c70f3d1-9067-474b-a1d7-bb8687dbd5d1` stopped after 32/48 trials and 117 model requests. It exposed that player recommendation age filters used the FM snapshot date and that the age-based case contract was stale. No judge calibration or semantic scoring ran. V28 recalculates age from birth date as of a fixed case date.

V27 is exposed and must not be prepared or run again as a blind gate. The local partial report remains under `.data/evals/v27-heldout-runs/`; use V28 for the replacement gate.
