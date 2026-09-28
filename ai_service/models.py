"""
CricGeek AI Scoring — HuggingFace Model Loader

Loads the classifier and embedding models used by the Python BQS service.
The sentence encoder now defaults to BAAI/bge-large-en-v1.5 so the service
can score coherence/originality from stronger embeddings than the earlier
MiniLM baseline.
"""

import os
from typing import Any


_models: dict[str, Any] = {
    "bart_classifier": None,    # BART-MNLI for archetype / zero-shot decisions
    "roberta_sentiment": None,  # RoBERTa for negativity / tone support
    "toxic_classifier": None,   # Toxic-BERT for toxicity
    "embedding_model": None,    # BGE-large sentence encoder
    "minilm": None,             # Backwards-compatible alias to embedding_model
}


def _resolve_device() -> tuple[int, str]:
    import torch

    if torch.cuda.is_available():
        return 0, "cuda"

    if getattr(torch.backends, "mps", None) and torch.backends.mps.is_available():
        return -1, "mps"

    return -1, "cpu"


def load_all_models() -> None:
    """
    Load the HuggingFace pipelines and the embedding backbone once at startup.
    """
    from sentence_transformers import SentenceTransformer
    from transformers import pipeline

    pipeline_device, sentence_device = _resolve_device()
    zero_shot_model = os.getenv("BQS_ZERO_SHOT_MODEL", "facebook/bart-large-mnli")
    sentiment_model = os.getenv(
        "BQS_SENTIMENT_MODEL",
        "cardiffnlp/twitter-roberta-base-sentiment-latest",
    )
    toxicity_model = os.getenv("BQS_TOXICITY_MODEL", "martin-ha/toxic-comment-model")
    embedding_model = os.getenv("BQS_EMBEDDING_MODEL", "BAAI/bge-large-en-v1.5")

    print(f"  [1/4] Loading zero-shot classifier ({zero_shot_model})...")
    _models["bart_classifier"] = pipeline(
        "zero-shot-classification",
        model=zero_shot_model,
        device=pipeline_device,
    )
    print("  ✅ Zero-shot classifier loaded")

    print(f"  [2/4] Loading sentiment model ({sentiment_model})...")
    _models["roberta_sentiment"] = pipeline(
        "sentiment-analysis",
        model=sentiment_model,
        device=pipeline_device,
    )
    print("  ✅ Sentiment model loaded")

    print(f"  [3/4] Loading toxicity classifier ({toxicity_model})...")
    _models["toxic_classifier"] = pipeline(
        "text-classification",
        model=toxicity_model,
        device=pipeline_device,
    )
    print("  ✅ Toxicity classifier loaded")

    print(f"  [4/4] Loading sentence encoder ({embedding_model}) on {sentence_device}...")
    encoder = SentenceTransformer(embedding_model, device=sentence_device)
    _models["embedding_model"] = encoder
    _models["minilm"] = encoder
    print("  ✅ Sentence encoder loaded")


def get_models() -> dict[str, Any]:
    """Return a reference to the global model registry."""
    return _models
