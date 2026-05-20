# Critic Prompt

Review the trace as a model-debugging artifact.

Focus on:

- where the agent stopped too early
- which query terms were weak
- which sources were low signal
- which artifacts should have been saved
- what translation or context was missing
- what single harness change would most improve the next rerun

Produce failure labels and a patch proposal. Do not rewrite the final answer.
