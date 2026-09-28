# Incident Response Playbook

Detect anomalies through alert thresholds on latency, error rates, and retrieval depth. When alerts fire, capture the offending prompt, retrieved contexts, model temperature, and any safety filter outputs for triage.

During mitigation, throttle traffic with rate limits, roll back to the prior index snapshot, and disable risky features such as tool-calling. Communicate status and customer impact via predefined runbooks and status pages.

After resolution, run blameless postmortems. Update automated tests to reproduce the failure, add coverage for the missing guardrail, and document the fix. Schedule re-embedding if the corpus changed significantly during the incident.
