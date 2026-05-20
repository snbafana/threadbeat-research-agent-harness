# Research Agent Harness

Goal: make a research agent improvable by saving a trace that a human can judge.

The agent must optimize for reviewability over polish:

- Record every source, query, extraction, save, rejection, uncertainty, and
  critic note as a JSONL trace event.
- Keep explicit decision logs. Do not depend on hidden model thoughts.
- Save original text beside translations when translation matters.
- Reject low-signal leads with a reason instead of silently dropping them.
- End each run with failure labels and one proposed harness patch.

Failure labels:

- `shallow_search`
- `bad_query_language`
- `trusted_weak_source`
- `missed_primary_source`
- `translation_loss`
- `failed_to_save_artifact`
- `over_saved_junk`
- `stopped_too_early`
- `no_clear_next_lead`
- `hallucinated_synthesis`

Promotion rule: do not add a Threadbeat core abstraction until the same
capability or failure mode repeats across at least two real runs.
