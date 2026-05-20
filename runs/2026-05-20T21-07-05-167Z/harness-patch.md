# Harness Patch Proposal

Change one thing next:

Add a real browser/device provider step that must emit:

- searched query
- opened URL
- screenshot or DOM/text snapshot path
- save/reject decision
- follow-up lead

Keep the provider implementation inside this agent repo until two runs prove the
same code needs to move into Threadbeat core.
