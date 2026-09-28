# Azure Deployment Notes

Azure Container Apps can host both the FastAPI RAG service and a lightweight Node.js client. Build images with a multi-stage Dockerfile that installs Python dependencies, downloads the embedding model, and copies the FAISS index created during CI.

Use Azure Files or Azure Blob Storage to persist the vector index so that stateless pods can mount or download it on startup. Configure autoscaling rules based on HTTP concurrency and CPU utilization to keep latency predictable.

For networking, expose the API with a managed certificate on a custom domain. Use Azure Application Gateway WAF to block abusive traffic and enforce request size limits. Private endpoints to storage and Key Vault reduce data egress and keep embeddings confidential.

Monitoring relies on Azure Monitor and OpenTelemetry traces. Emit metrics for query throughput, vector recall hit rates, and model latency. Send logs to Log Analytics with correlation IDs that chain the Node client, API requests, and downstream embedding calls.
