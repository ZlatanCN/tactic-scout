# Run offline formula comparisons and ablations

Status: resolved
Labels: ready-for-agent

Implement and run the frozen protocol on the local FM STC `positions.rating=20` corpus. Keep numerical scripts and lightweight reports under this directory, and derived catalog/rankings under ignored `.data/recommendation-experiments/`. Produce all formula/ablation results, paired uncertainty, feasibility checks, performance observations, and a clearly provisional default selection. This numeric filter is not a claim to represent every FM natural-position label. No production graph integration in this task.

Pre-run selection policy: select a challenger using development identities only; require level-sensitive nondegenerate scoring, all correctness gates, an open-pool size at least 50, at least 0.02 mean Top5 Jaccard gain under ±2 attribute noise with a positive paired 95% lower bound, no more than +5 CA-gap increase, and score/rank p95 below 50ms. These margins are engineering choices, not football relevance truth. Freeze the challenger before test; if test confirmation fails, retain MAE. Cosine/correlation remain measured style-oriented alternatives, while CA/random remain negative controls for stability-only selection. The report must not relabel these observations as validated real-world replacement relevance.

Completed: 19 numerical checks, 21 configurations, 240 unique queries, 3 filter scenarios, paired bootstrap and all registered ablations. Development selected rmse18; test confirmed +0.07166 Jaccard gain over MAE with 95% interval [0.03900,0.10376]. Final provisional strategy recorded in selection.json. Independent artifact audit verified all15,120 rankings, identity/snapshot/code isolation and frozen selection. Source application code was not changed; local numerical work used NumPy2.3.5 without gateway calls.
