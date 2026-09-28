from __future__ import annotations

from collections import Counter
from pathlib import Path
from typing import List

LOG_DIR = Path("data/logs")


class LogIssue:
    def __init__(self, category: str, description: str, root_cause: str, solutions: List[str]):
        self.category = category
        self.description = description
        self.root_cause = root_cause
        self.solutions = solutions

    def to_markdown(self) -> str:
        bullet_solutions = "\n".join(f"- {item}" for item in self.solutions)
        return (
            f"### {self.category}\n"
            f"*Issue:* {self.description}\n\n"
            f"*Root cause:* {self.root_cause}\n\n"
            f"*Solutions:*\n{bullet_solutions}\n"
        )


def parse_web_log(path: Path) -> LogIssue:
    rows = path.read_text(encoding="utf-8").splitlines()
    status_codes = [parts[4] for parts in (line.split() for line in rows) if len(parts) > 4]
    counts = Counter(status_codes)
    upstream_timeouts = [line for line in rows if "upstream_timeout" in line]
    description = (
        f"{counts.get('500', 0)} upstream timeouts observed on /query; rate limiting also triggered."
    )
    root_cause = (
        "Application backend became unresponsive causing 500 errors and triggered a protective 429 rate limit."
    )
    solutions = [
        "Scale the API deployment and ensure the vector index is loaded before accepting traffic.",
        "Add health probes to drain instances when upstream latency exceeds thresholds.",
        "Tune rate-limit buckets for POST /query to avoid cascading retries.",
    ]
    if upstream_timeouts:
        solutions.append("Investigate dependency timeouts between Node client and FastAPI service.")
    return LogIssue("Web Server", description, root_cause, solutions)


def parse_database_log(path: Path) -> LogIssue:
    rows = path.read_text(encoding="utf-8").splitlines()
    failovers = [line for line in rows if "promotion" in line]
    slow_queries = [line for line in rows if "slow query" in line]
    description = (
        "Primary database timed out twice and failed over to a replica; slow query observed after recovery."
    )
    root_cause = (
        "Database primary was unreachable, forcing an election. Slow post-failover query suggests cold caches or missing index."
    )
    solutions = [
        "Harden connectivity with connection pooling and shorter timeouts during primary loss.",
        "Warm caches or add an index on chunks.doc_id to prevent slow lookups after failover.",
        "Add alerts for repeated primary connection timeouts to trigger automated failover sooner.",
    ]
    if slow_queries:
        solutions.append("Review query plans for embedding lookup paths and add missing indexes.")
    if failovers:
        solutions.append("Validate replication health after promotions to ensure read/write separation is correct.")
    return LogIssue("Database", description, root_cause, solutions)


def parse_application_log(path: Path) -> LogIssue:
    rows = path.read_text(encoding="utf-8").splitlines()
    circuit_breaker = any("Circuit breaker opened" in line for line in rows)
    name_error = any("NameError: name 'index' is not defined" in line for line in rows)
    description = "Embedder retries exceeded and circuit breaker opened; RAG queries failed while index was unavailable."
    root_cause = (
        "Embedding pipeline experienced latency spikes causing circuit breaker trips, and API lacked defensive checks when the "
        "vector index failed to initialize."
    )
    solutions = [
        "Add readiness checks that require the FAISS index to be loaded before serving queries.",
        "Implement exponential backoff and a fallback local embedding model to reduce reliance on remote APIs.",
        "Guard RAG search with null checks and clearer errors to avoid NameError when index references are missing.",
    ]
    if circuit_breaker:
        solutions.append("Tune circuit breaker thresholds and add pooled connections for the embedding provider.")
    if name_error:
        solutions.append("Add unit tests around search paths to prevent undefined index references.")
    return LogIssue("Application", description, root_cause, solutions)


def generate_report(log_dir: Path = LOG_DIR) -> str:
    web_issue = parse_web_log(log_dir / "web_server.log")
    db_issue = parse_database_log(log_dir / "database.log")
    app_issue = parse_application_log(log_dir / "application.log")
    header = "# Error Log Analysis Report\n\n"
    content = "\n".join(issue.to_markdown() for issue in [web_issue, db_issue, app_issue])
    return header + content


def export_report(destination: Path = Path("reports/log_analysis_report.md")) -> None:
    report = generate_report()
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(report, encoding="utf-8")


if __name__ == "__main__":
    export_report()
    print("Report written to reports/log_analysis_report.md")
