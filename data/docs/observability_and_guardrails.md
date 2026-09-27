# Observability and Guardrails

Include request IDs and user IDs in structured JSON logs to make tracing across services trivial. Capture latency percentiles for embedding, retrieval, reranking, and generation so regressions are caught early.

Guardrails should validate maximum prompt sizes, filter disallowed topics, and run toxicity classifiers on both inputs and outputs. Fail closed with user-friendly messages whenever safety checks trigger.

Offline evaluation suites with golden questions help detect recall or precision drift as the corpus evolves. Track embedding coverage and perform backfills after mass document ingestions. Synthetic tests can seed known risky prompts to verify that refusal policies still work.
