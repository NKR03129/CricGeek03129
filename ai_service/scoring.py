"""
CricGeek AI Scoring — BQS Assembly Engine

This scorer keeps the existing BQS dimensions and assembly rules, but replaces
the earlier blind LLM-style NLP reads with explicit model-based components:

1. Pre-processing
2. BART-MNLI archetype classification
3. BART + RoBERTa constructiveness / negativity scoring
4. Toxic-BERT toxicity scoring
5. BGE-large embeddings for coherence / originality
6. Existing NER + fact-check correctness layer
7. Deterministic rule engine + BQS assembly
"""

from __future__ import annotations

import json
import logging
import math
import os
import re
from functools import lru_cache
from pathlib import Path
from typing import Any

import numpy as np

from fact_checker import get_fact_check_score
from models import get_models
from ner import extract_cricket_entities

logger = logging.getLogger("scoring")

BQS_SCORE_VERSION = "hf-bge-bart-v1"
REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_REFERENCE_CORPUS = REPO_ROOT / "src" / "data" / "bqs-calibration.json"


# ── Archetype Weight Tables ──────────────────────────────────────────

ARCHETYPE_WEIGHTS: dict[str, dict[str, float]] = {
    "fan": {
        "constructiveness": 0.25,
        "toxicity_inv": 0.15,
        "originality": 0.15,
        "stat_accuracy": 0.15,
        "info_density": 0.10,
        "paragraph_coherence": 0.10,
        "argument_logic": 0.10,
    },
    "analyst": {
        "constructiveness": 0.25,
        "toxicity_inv": 0.15,
        "originality": 0.10,
        "stat_accuracy": 0.25,
        "info_density": 0.15,
        "paragraph_coherence": 0.10,
        "argument_logic": 0.00,
    },
    "storyteller": {
        "constructiveness": 0.20,
        "toxicity_inv": 0.15,
        "originality": 0.20,
        "stat_accuracy": 0.00,
        "info_density": 0.10,
        "paragraph_coherence": 0.20,
        "argument_logic": 0.15,
    },
    "debater": {
        "constructiveness": 0.20,
        "toxicity_inv": 0.15,
        "originality": 0.10,
        "stat_accuracy": 0.10,
        "info_density": 0.15,
        "paragraph_coherence": 0.15,
        "argument_logic": 0.15,
    },
}

LABEL_MAP = {
    "Analyst: A technical, statistical analysis focused on data and facts": "analyst",
    "Storyteller: A vivid narrative story filled with descriptions and metaphors": "storyteller",
    "Fan: A passionate, emotional, or casual reaction from a cricket lover": "fan",
    "Debater: A critical argument or debate comparing different viewpoints": "debater",
}
ARCHETYPE_LABELS = list(LABEL_MAP.keys())
ARCHETYPE_HYPOTHESIS = "The writing style of this cricket blog is {}."

NEGATIVITY_LABELS = {
    "supportive or celebratory cricket commentary": "supportive",
    "critical or disappointed cricket commentary": "negative",
    "neutral or descriptive cricket commentary": "neutral",
}
NEGATIVITY_HYPOTHESIS = "The emotional tone of this cricket writing is {}."

CONSTRUCTIVENESS_LABELS = {
    "constructive and actionable cricket analysis": "constructive",
    "balanced cricket criticism with specific reasoning": "balanced",
    "destructive rant or personal attack": "destructive",
}
CONSTRUCTIVENESS_HYPOTHESIS = "This cricket writing is {}."


_STYLE_MARKERS = {
    "storyteller": {
        "keywords": [
            "vivid", "shadows", "glow", "rhythm", "horizon", "journey", "scene",
            "picture", "character", "motive", "pulse", "silence", "roar", "crowd",
            "metaphor", "narrative", "atmosphere", "chapter", "saga", "dramatic",
            "description", "moment", "emotion", "amber", "immersive", "casting",
            "navigator", "secret", "breadcrumb", "whisper", "fading", "glowing",
        ],
        "phrases": [
            "as he spoke", "he described", "he walked", "his voice", "his eyes",
            "she spoke", "she described", "the moment", "it was an", "the sun",
            "a vivid picture", "the naked eye", "abstract digits",
        ],
    },
    "analyst": {
        "keywords": [
            "statistics", "percentage", "regression", "correlation", "metric",
            "dataset", "sample", "hypothesis", "coefficient", "benchmark",
            "quartile", "deviation", "variance", "aggregate", "forecast",
        ],
        "phrases": [
            "the data shows", "statistically significant", "on average",
            "based on the numbers", "the metrics indicate", "per cent",
        ],
    },
    "fan": {
        "keywords": [
            "love", "passion", "heart", "amazing", "incredible", "goat",
            "legend", "cheer", "support", "favourite", "hero", "idol",
            "electric", "insane", "king", "beast", "clutch",
        ],
        "phrases": [
            "what a", "oh my", "i love", "my favourite", "can't believe",
            "let's go", "come on", "absolute legend",
        ],
    },
    "debater": {
        "keywords": [
            "however", "although", "argue", "counter", "contrary", "therefore",
            "perspective", "viewpoint", "evidence", "flaw", "critique", "rebuttal",
            "whereas", "nevertheless", "furthermore", "opponents",
        ],
        "phrases": [
            "on the other hand", "one could argue", "the counter argument",
            "it is worth noting", "critics might say", "in contrast",
        ],
    },
}


# ── Helpers ──────────────────────────────────────────────────────────

def clamp_score(value: float | int | None, fallback: float = 0.0) -> float:
    try:
        if value is None:
            return round(fallback, 2)

        numeric = float(value)
        if math.isnan(numeric):
            return round(fallback, 2)

        return round(max(0.0, min(100.0, numeric)), 2)
    except Exception:
        return round(fallback, 2)


def clamp_unit(value: float | int | None, fallback: float = 0.0) -> float:
    try:
        if value is None:
            return round(fallback, 4)

        numeric = float(value)
        if math.isnan(numeric):
            return round(fallback, 4)

        return round(max(0.0, min(1.0, numeric)), 4)
    except Exception:
        return round(fallback, 4)


def safe_mean(values: list[float], fallback: float = 0.0) -> float:
    return float(sum(values) / len(values)) if values else fallback


def scale_between(value: float, low: float, high: float) -> float:
    if high <= low:
        return 0.0

    return max(0.0, min(1.0, (value - low) / (high - low)))


def inverse_scale_between(value: float, low: float, high: float) -> float:
    return 1.0 - scale_between(value, low, high)


def cosine_similarity(vec_a: np.ndarray, vec_b: np.ndarray) -> float:
    denom = np.linalg.norm(vec_a) * np.linalg.norm(vec_b)
    if denom <= 0:
        return 0.0

    return float(np.dot(vec_a, vec_b) / denom)


def excerpt_for_paragraph(paragraph: str) -> str:
    return paragraph.replace("\n", " ").strip()[:120]


def _truncate_for_classifier(text: str, max_words: int = 420) -> str:
    words = text.split()
    return " ".join(words[:max_words]) if len(words) > max_words else text


def _parse_zero_shot_scores(
    result: dict[str, Any],
    label_map: dict[str, str],
) -> dict[str, float]:
    parsed: dict[str, float] = {mapped: 0.0 for mapped in label_map.values()}

    for label, score in zip(result.get("labels", []), result.get("scores", [])):
        mapped = label_map.get(label)
        if mapped is not None:
            parsed[mapped] = float(score)

    return parsed


def _count_regex_hits(text: str, patterns: list[str]) -> int:
    return sum(1 for pattern in patterns if re.search(pattern, text))


def _compute_style_signals(text: str) -> dict[str, float]:
    text_lower = text.lower()
    words = text.split()
    word_count = len(words)
    sentences = [s.strip() for s in re.split(r"[.!?]+", text) if len(s.strip()) > 10]
    sent_count = max(len(sentences), 1)
    avg_sent_len = sum(len(s.split()) for s in sentences) / sent_count

    signals: dict[str, float] = {"storyteller": 0.0, "analyst": 0.0, "fan": 0.0, "debater": 0.0}

    for archetype, markers in _STYLE_MARKERS.items():
        kw_hits = sum(1 for word in markers["keywords"] if word in text_lower)
        kw_score = min(1.0, kw_hits / max(len(markers["keywords"]) * 0.25, 1))

        phrase_hits = sum(1 for phrase in markers["phrases"] if phrase in text_lower)
        phrase_score = min(1.0, phrase_hits / max(len(markers["phrases"]) * 0.2, 1))

        signals[archetype] = kw_score * 0.4 + phrase_score * 0.6

    if avg_sent_len >= 18:
        signals["storyteller"] += 0.2

    if any(
        phrase in text_lower
        for phrase in [
            "he spoke", "he said", "he walked", "he described", "his voice",
            "she spoke", "she said", "she walked", "her voice", "his laptop",
        ]
    ):
        signals["storyteller"] += 0.15

    descriptive_words = {
        "long", "amber", "vivid", "abstract", "immersive", "slight", "sudden",
        "tiring", "previous", "naked", "human", "physical", "fading", "quiet",
        "brilliant", "fierce", "gentle", "electric", "magnetic", "dramatic",
    }
    desc_count = sum(1 for word in words if word.lower() in descriptive_words)
    if desc_count / max(word_count, 1) > 0.03:
        signals["storyteller"] += 0.15

    if text.count("!") >= 3:
        signals["fan"] += 0.2
    if avg_sent_len <= 15:
        signals["fan"] += 0.1

    number_count = len(re.findall(r"\b\d+\.?\d*\b", text))
    if number_count / max(sent_count, 1) > 1.5:
        signals["analyst"] += 0.2

    contrastive = sum(
        1
        for connector in [
            "however", "although", "whereas", "nevertheless",
            "on the other hand", "in contrast",
        ]
        if connector in text_lower
    )
    if contrastive >= 2:
        signals["debater"] += 0.2

    for key in signals:
        signals[key] = min(1.0, max(0.0, signals[key]))

    return signals


def _heuristic_toxicity(text: str) -> float:
    text_lower = text.lower()
    toxic_patterns = [
        r"\bidiot\b", r"\bstupid\b", r"\btrash\b", r"\bgarbage\b", r"\bloser\b",
        r"\bpathetic\b", r"\blaughable\b", r"\bjoke\b", r"\bwashed\b",
        r"\buseless\b", r"\bclown\b", r"\bbrainless\b", r"\bworthless\b",
        r"\bfraud\b", r"\bno brain\b",
    ]
    hits = _count_regex_hits(text_lower, toxic_patterns)
    return clamp_score(4 + hits * 18, 5.0)


def _load_json_corpus(path: Path) -> list[str]:
    payload = json.loads(path.read_text(encoding="utf-8"))

    if isinstance(payload, list):
        results: list[str] = []

        for item in payload:
            if isinstance(item, str):
                candidate = item.strip()
            elif isinstance(item, dict):
                candidate = str(
                    item.get("content")
                    or item.get("text")
                    or item.get("body")
                    or item.get("article")
                    or ""
                ).strip()
            else:
                candidate = ""

            if len(candidate) >= 20:
                results.append(candidate)

        return results

    return []


def _load_jsonl_corpus(path: Path) -> list[str]:
    results: list[str] = []

    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue

        try:
            payload = json.loads(line)
        except json.JSONDecodeError:
            continue

        if isinstance(payload, str) and len(payload.strip()) >= 20:
            results.append(payload.strip())
            continue

        if isinstance(payload, dict):
            candidate = str(
                payload.get("content")
                or payload.get("text")
                or payload.get("body")
                or payload.get("article")
                or ""
            ).strip()
            if len(candidate) >= 20:
                results.append(candidate)

    return results


@lru_cache(maxsize=1)
def load_reference_corpus() -> tuple[tuple[str, ...], str]:
    configured = os.getenv("BQS_REFERENCE_CORPUS_PATH")
    path = Path(configured).expanduser() if configured else DEFAULT_REFERENCE_CORPUS

    if not path.exists():
        logger.warning("Reference corpus not found at %s", path)
        return tuple(), "missing"

    try:
        if path.suffix.lower() == ".json":
            texts = _load_json_corpus(path)
        elif path.suffix.lower() == ".jsonl":
            texts = _load_jsonl_corpus(path)
        else:
            texts = [line.strip() for line in path.read_text(encoding="utf-8").splitlines() if len(line.strip()) >= 20]

        unique_texts = tuple(dict.fromkeys(texts))
        return unique_texts, str(path)
    except Exception as exc:
        logger.warning("Failed to load reference corpus from %s: %s", path, exc)
        return tuple(), "unavailable"


_reference_embeddings_cache: np.ndarray | None = None
_reference_embeddings_source: str | None = None


def get_reference_corpus_embeddings() -> tuple[np.ndarray | None, int, str]:
    global _reference_embeddings_cache, _reference_embeddings_source

    models = get_models()
    encoder = models.get("embedding_model") or models.get("minilm")
    corpus_texts, source = load_reference_corpus()

    if encoder is None or not corpus_texts:
        return None, 0, source

    if _reference_embeddings_cache is None or _reference_embeddings_source != source:
        _reference_embeddings_cache = encoder.encode(
            list(corpus_texts),
            convert_to_numpy=True,
            normalize_embeddings=True,
            batch_size=8,
        )
        _reference_embeddings_source = source

    return _reference_embeddings_cache, len(corpus_texts), source


# ── Step 1: Pre-processing ───────────────────────────────────────────

def pre_process(text: str) -> dict[str, Any]:
    words = text.strip().split()
    word_count = len(words)
    sentences = [s.strip() for s in re.split(r"[.!?]+", text) if s.strip()]
    sentence_count = len(sentences)
    paragraphs = [p.strip() for p in re.split(r"\n\s*\n", text) if p.strip()]
    paragraph_count = max(len(paragraphs), 1)

    unique_words = set(word.lower() for word in words)
    lexical_diversity = len(unique_words) / max(word_count, 1)

    sent_lengths = [len(sentence.split()) for sentence in sentences]
    if len(sent_lengths) > 1:
        mean_len = sum(sent_lengths) / len(sent_lengths)
        variance = sum((length - mean_len) ** 2 for length in sent_lengths) / len(sent_lengths)
        sentence_variety = min(100.0, math.sqrt(variance) * 8)
    else:
        sentence_variety = 0.0

    completeness = 0.0
    if paragraph_count >= 3:
        completeness += 40
    elif paragraph_count >= 2:
        completeness += 20
    if sentence_count >= 5:
        completeness += 30
    if word_count >= 120:
        completeness += 30

    avg_sentence_length = sum(sent_lengths) / max(len(sent_lengths), 1)

    return {
        "word_count": word_count,
        "sentence_count": sentence_count,
        "paragraph_count": paragraph_count,
        "lexical_diversity": round(lexical_diversity, 4),
        "sentence_variety": round(sentence_variety, 2),
        "avg_sentence_length": round(avg_sentence_length, 2),
        "completeness": min(100.0, completeness),
        "sentences": sentences,
        "paragraphs": paragraphs or [text.strip()],
    }


# ── Step 2: Archetype Classification ────────────────────────────────

def classify_archetype(text: str) -> dict[str, Any]:
    models = get_models()
    classifier = models.get("bart_classifier")

    if classifier is None:
        return {"label": "analyst", "confidence": 0.5, "scores": {}}

    truncated = _truncate_for_classifier(text)

    try:
        result = classifier(
            truncated,
            candidate_labels=ARCHETYPE_LABELS,
            hypothesis_template=ARCHETYPE_HYPOTHESIS,
        )
        bart_scores = _parse_zero_shot_scores(result, LABEL_MAP)
    except Exception as exc:
        logger.warning("Archetype classification failed: %s", exc)
        return {"label": "analyst", "confidence": 0.5, "scores": {}}

    style_signals = _compute_style_signals(text)

    blended: dict[str, float] = {}
    for archetype in ["analyst", "storyteller", "fan", "debater"]:
        blended[archetype] = bart_scores.get(archetype, 0.25) * 0.5 + style_signals.get(archetype, 0.0) * 0.5

    best_label = str(max(blended, key=lambda key: float(blended[key])))
    best_conf = float(blended[best_label])

    logger.info(
        "Archetype: BART=%s | Style=%s | Blended=%s | Winner=%s",
        bart_scores,
        style_signals,
        blended,
        best_label,
    )

    return {
        "label": best_label,
        "confidence": round(best_conf, 4),
        "scores": {key: round(float(value), 4) for key, value in blended.items()},
    }


# ── Step 3: Constructiveness / Negativity ───────────────────────────

def score_constructiveness(text: str) -> float:
    models = get_models()
    classifier = models.get("bart_classifier")

    if classifier is None:
        return 65.0

    truncated = _truncate_for_classifier(text)
    lowered = text.lower()
    reasoning_hits = _count_regex_hits(
        lowered,
        [
            r"\bbecause\b", r"\btherefore\b", r"\bhowever\b", r"\balthough\b",
            r"\bsince\b", r"\bthus\b", r"\bhence\b", r"\bevidence\b",
            r"\bshows\b", r"\bindicates\b", r"\bsuggests\b",
        ],
    )
    actionable_hits = _count_regex_hits(
        lowered,
        [
            r"\bshould\b", r"\bmust\b", r"\bneeds? to\b", r"\bcan improve\b",
            r"\bbetter\b", r"\badjust\b", r"\bfix\b", r"\bplan\b",
        ],
    )

    try:
        result = classifier(
            truncated,
            candidate_labels=list(CONSTRUCTIVENESS_LABELS.keys()),
            hypothesis_template=CONSTRUCTIVENESS_HYPOTHESIS,
        )
        scores = _parse_zero_shot_scores(result, CONSTRUCTIVENESS_LABELS)
    except Exception as exc:
        logger.warning("Constructiveness classification failed: %s", exc)
        return 65.0

    constructive = scores.get("constructive", 0.33)
    balanced = scores.get("balanced", 0.33)
    destructive = scores.get("destructive", 0.33)
    score = (
        24
        + constructive * 52
        + balanced * 30
        + min(14.0, reasoning_hits * 2.5 + actionable_hits * 2.0)
        - destructive * 34
    )
    return clamp_score(score, 65.0)


def score_tone(text: str) -> float:
    return score_constructiveness(text)


def score_negativity(text: str) -> float:
    models = get_models()
    classifier = models.get("bart_classifier")
    roberta = models.get("roberta_sentiment")

    lowered = text.lower()
    heuristic_negative = clamp_score(
        8
        + _count_regex_hits(
            lowered,
            [
                r"\bterrible\b", r"\bworst\b", r"\bawful\b", r"\bdisaster\b",
                r"\bpoor\b", r"\bsloppy\b", r"\bfrustrating\b", r"\bdisappointing\b",
                r"\bconcern(ing)?\b", r"\bunderperform(ing|ed)?\b",
            ],
        ) * 11,
        12.0,
    )

    bart_negativity = heuristic_negative
    if classifier is not None:
        try:
            result = classifier(
                _truncate_for_classifier(text),
                candidate_labels=list(NEGATIVITY_LABELS.keys()),
                hypothesis_template=NEGATIVITY_HYPOTHESIS,
            )
            scores = _parse_zero_shot_scores(result, NEGATIVITY_LABELS)
            negative = scores.get("negative", 0.33)
            neutral = scores.get("neutral", 0.33)
            supportive = scores.get("supportive", 0.33)
            bart_negativity = negative * 100 + neutral * 35 + supportive * 8
        except Exception as exc:
            logger.warning("Negativity classification failed: %s", exc)

    roberta_negativity = bart_negativity
    if roberta is not None:
        try:
            result = roberta(text[:512], truncation=True, max_length=512)[0]
            label = str(result.get("label", "")).upper()
            score = float(result.get("score", 0.5))

            if "NEG" in label:
                roberta_negativity = 42 + score * 58
            elif "POS" in label:
                roberta_negativity = 6 + (1 - score) * 16
            else:
                roberta_negativity = 24 + score * 16
        except Exception as exc:
            logger.warning("RoBERTa negativity read failed: %s", exc)

    combined = bart_negativity * 0.6 + roberta_negativity * 0.25 + heuristic_negative * 0.15
    return clamp_score(combined, 28.0)


# ── Step 4: Toxicity ────────────────────────────────────────────────

def score_toxicity(text: str) -> float:
    models = get_models()
    toxic = models.get("toxic_classifier")
    heuristic = _heuristic_toxicity(text)

    if toxic is None:
        return heuristic

    try:
        result = toxic(text[:512], truncation=True, max_length=512)
        if isinstance(result, list) and result and isinstance(result[0], list):
            candidates = result[0]
        elif isinstance(result, list):
            candidates = result
        else:
            candidates = [result]

        toxic_probability: float | None = None
        for candidate in candidates:
            label = str(candidate.get("label", "")).lower()
            score = float(candidate.get("score", 0.5))

            if "toxic" in label and "non" not in label:
                toxic_probability = max(toxic_probability or 0.0, score)
            elif "non-toxic" in label or "nontoxic" in label or "neutral" in label:
                toxic_probability = max(toxic_probability or 0.0, 1 - score)
            elif label == "label_1":
                toxic_probability = max(toxic_probability or 0.0, score)
            elif label == "label_0" and toxic_probability is None:
                toxic_probability = 1 - score

        if toxic_probability is None:
            top = candidates[0]
            label = str(top.get("label", "")).lower()
            score = float(top.get("score", 0.5))
            toxic_probability = score if "toxic" in label or label == "label_1" else 1 - score

        combined = toxic_probability * 100 * 0.8 + heuristic * 0.2
        return clamp_score(combined, heuristic)
    except Exception as exc:
        logger.warning("Toxicity scoring failed: %s", exc)
        return heuristic


# ── Step 5: Embeddings — Coherence & Originality ────────────────────

def generate_embeddings(
    text: str,
    paragraphs: list[str],
    sentences: list[str],
) -> dict[str, Any]:
    models = get_models()
    encoder = models.get("embedding_model") or models.get("minilm")

    if encoder is None:
        return {
            "available": False,
            "chunk_texts": paragraphs if paragraphs else sentences,
            "chunk_embeddings": None,
            "document_embedding": None,
        }

    chunk_texts = paragraphs if len(paragraphs) >= 2 else sentences or paragraphs or [text]

    try:
        chunk_embeddings = encoder.encode(
            chunk_texts,
            convert_to_numpy=True,
            normalize_embeddings=True,
            batch_size=8,
        )
        document_embedding = encoder.encode(
            [text],
            convert_to_numpy=True,
            normalize_embeddings=True,
        )[0]
        return {
            "available": True,
            "chunk_texts": chunk_texts,
            "chunk_embeddings": chunk_embeddings,
            "document_embedding": document_embedding,
        }
    except Exception as exc:
        logger.warning("Embedding generation failed: %s", exc)
        return {
            "available": False,
            "chunk_texts": chunk_texts,
            "chunk_embeddings": None,
            "document_embedding": None,
        }


def score_coherence_originality(
    text: str,
    paragraphs: list[str],
    sentences: list[str],
) -> dict[str, Any]:
    embedding_context = generate_embeddings(text, paragraphs, sentences)
    chunk_embeddings = embedding_context["chunk_embeddings"]
    document_embedding = embedding_context["document_embedding"]

    if not embedding_context["available"] or chunk_embeddings is None or document_embedding is None:
        return {
            "coherence": 72.0,
            "originality": 68.0,
            "adjacent_similarity": None,
            "max_reference_similarity": None,
            "reference_corpus_size": 0,
            "reference_source": "unavailable",
            "embedding_context": embedding_context,
        }

    adjacent_sims: list[float] = []
    for index in range(len(chunk_embeddings) - 1):
        adjacent_sims.append(cosine_similarity(chunk_embeddings[index], chunk_embeddings[index + 1]))

    mean_adjacent = safe_mean(adjacent_sims, 0.62)
    sim_std = float(np.std(adjacent_sims)) if adjacent_sims else 0.14
    flow_consistency = max(0.0, 1.0 - min(sim_std / 0.25, 1.0))
    coherence = clamp_score(scale_between(mean_adjacent, 0.2, 0.9) * 75 + flow_consistency * 25, 72.0)

    pairwise_sims: list[float] = []
    for left in range(len(chunk_embeddings)):
        for right in range(left + 1, len(chunk_embeddings)):
            pairwise_sims.append(cosine_similarity(chunk_embeddings[left], chunk_embeddings[right]))
    mean_pairwise = safe_mean(pairwise_sims, 0.62)

    reference_embeddings, reference_count, reference_source = get_reference_corpus_embeddings()
    max_reference_similarity: float | None = None
    if reference_embeddings is not None and reference_count > 0:
        similarities = np.dot(reference_embeddings, document_embedding)
        max_reference_similarity = float(np.max(similarities))

    novelty_component = (
        inverse_scale_between(max_reference_similarity, 0.55, 0.92) * 100
        if max_reference_similarity is not None
        else 68.0
    )
    intra_variety_component = (
        inverse_scale_between(mean_pairwise, 0.45, 0.9) * 100
        if pairwise_sims
        else 65.0
    )
    originality = clamp_score(
        novelty_component * 0.75 + intra_variety_component * 0.25,
        68.0,
    )

    return {
        "coherence": coherence,
        "originality": originality,
        "adjacent_similarity": round(mean_adjacent, 4) if adjacent_sims else None,
        "max_reference_similarity": round(max_reference_similarity, 4) if max_reference_similarity is not None else None,
        "reference_corpus_size": reference_count,
        "reference_source": reference_source,
        "embedding_context": embedding_context,
    }


# ── Step 6: Rule Engine ──────────────────────────────────────────────

def rule_engine(text: str, ner_result: dict[str, Any], pre_processed: dict[str, Any]) -> dict[str, float]:
    words = [
        word
        for word in re.sub(r"[^a-zA-Z0-9\s']", " ", text.lower()).split()
        if word
    ]
    sentences = pre_processed["sentences"]
    word_count = max(len(words), 1)

    reasoning_hits = _count_regex_hits(
        text.lower(),
        [
            r"\bbecause\b", r"\btherefore\b", r"\bhowever\b", r"\balthough\b",
            r"\bsince\b", r"\bthus\b", r"\bhence\b", r"\bsuggests\b",
            r"\bindicates\b", r"\bevidence\b", r"\bconsequently\b",
            r"\bas a result\b", r"\bthis shows\b", r"\bdemonstrates\b",
        ],
    )
    argument_logic = clamp_score(24 + reasoning_hits * 6 + min(10, len(sentences) * 2), 40.0)

    entity_count = len(ner_result.get("entities", []))
    stats_count = len(ner_result.get("stats_found", []))
    evidence_presence = clamp_score(16 + entity_count * 8 + stats_count * 12, 35.0)

    counter_hits = _count_regex_hits(
        text.lower(),
        [
            r"\bbut\b", r"\bhowever\b", r"\balthough\b", r"\bnevertheless\b",
            r"\bconversely\b", r"\bdespite\b", r"\byet\b", r"\bon the other hand\b",
            r"\bthat said\b", r"\badmittedly\b",
        ],
    )
    counter_acknowledge = clamp_score(10 + counter_hits * 10, 18.0)

    position_hits = _count_regex_hits(
        text.lower(),
        [
            r"\bbelieve\b", r"\bthink\b", r"\bopinion\b", r"\bargue\b",
            r"\bsuggest\b", r"\bclearly\b", r"\bundoubtedly\b", r"\bshould\b",
            r"\bmust\b", r"\bin my view\b",
        ],
    )
    position_clarity = clamp_score(28 + position_hits * 10 + min(12, len(sentences) * 2), 45.0)

    avg_words_per_sentence = word_count / max(len(sentences), 1)
    cricket_depth = ner_result.get("cricket_depth", 0)
    info_density = clamp_score(avg_words_per_sentence * 3.8 + cricket_depth * 0.3 + stats_count * 6, 36.0)

    stop_words = {
        "a", "an", "and", "are", "as", "at", "be", "been", "for", "from",
        "has", "have", "he", "his", "if", "in", "is", "it", "of", "on",
        "or", "so", "the", "this", "to", "was", "with",
    }
    significant_words = [word for word in words if len(word) >= 4 and word not in stop_words]
    word_counts: dict[str, int] = {}
    for word in significant_words:
        word_counts[word] = word_counts.get(word, 0) + 1

    bigram_counts: dict[str, int] = {}
    for index in range(len(significant_words) - 1):
        bigram = f"{significant_words[index]} {significant_words[index + 1]}"
        bigram_counts[bigram] = bigram_counts.get(bigram, 0) + 1

    repeated_word_excess = sum(max(0, count - 2) for count in word_counts.values())
    repeated_bigram_excess = sum(max(0, count - 1) for count in bigram_counts.values())
    repetition_penalty = clamp_score(repeated_word_excess * 9 + repeated_bigram_excess * 12 + (word_count < 25) * 6, 0.0)

    return {
        "argument_logic": argument_logic,
        "evidence_presence": evidence_presence,
        "counter_acknowledge": counter_acknowledge,
        "position_clarity": position_clarity,
        "info_density": info_density,
        "repetition_penalty": repetition_penalty,
        "completeness": clamp_score(pre_processed["completeness"], 30.0),
    }


# ── Step 7: Deterministic BQS Assembly ───────────────────────────────

def resolve_moderation_penalty(
    negativity_score: float,
    toxicity_score: float,
    constructiveness: float,
    evidence_presence: float,
    counter_acknowledge: float,
) -> dict[str, float | bool]:
    clear_toxicity = toxicity_score >= 65
    borderline_toxicity = 25 <= toxicity_score < 65
    override_applied = (
        borderline_toxicity
        and negativity_score >= toxicity_score
        and constructiveness >= 68
        and evidence_presence >= 58
        and counter_acknowledge >= 35
    )

    effective_toxicity = toxicity_score * 0.35 if override_applied else toxicity_score
    penalty_applied = clear_toxicity or toxicity_score >= 28

    return {
        "effective_toxicity": round(effective_toxicity, 2),
        "penalty_applied": penalty_applied,
        "override_applied": override_applied,
    }


def assemble_bqs(
    archetype: str,
    constructiveness: float,
    negativity_score: float,
    toxicity_score: float,
    originality: float,
    coherence: float,
    stat_accuracy: float,
    info_density: float,
    argument_logic: float,
    evidence_presence: float,
    counter_acknowledge: float,
    position_clarity: float,
    completeness: float,
    repetition_penalty: float,
) -> dict[str, Any]:
    weights = ARCHETYPE_WEIGHTS.get(archetype, ARCHETYPE_WEIGHTS["fan"])
    moderation = resolve_moderation_penalty(
        negativity_score=negativity_score,
        toxicity_score=toxicity_score,
        constructiveness=constructiveness,
        evidence_presence=evidence_presence,
        counter_acknowledge=counter_acknowledge,
    )

    toxicity_inv = 100.0 - float(moderation["effective_toxicity"])
    negativity_adjustment = 4 if negativity_score > 70 and toxicity_score < 20 else 0
    brevity_penalty = (35 - completeness) * 0.4 if completeness < 35 else 0
    thin_counter_penalty = (20 - counter_acknowledge) * 0.2 if counter_acknowledge < 20 else 0

    score = (
        constructiveness * weights["constructiveness"]
        + toxicity_inv * weights["toxicity_inv"]
        + originality * weights["originality"]
        + stat_accuracy * weights["stat_accuracy"]
        + info_density * weights["info_density"]
        + coherence * weights["paragraph_coherence"]
        + argument_logic * weights["argument_logic"]
    )

    score += evidence_presence * 0.04
    score += position_clarity * 0.03
    score += completeness * 0.04
    score += counter_acknowledge * 0.03
    score -= repetition_penalty * 0.04
    score -= brevity_penalty
    score -= thin_counter_penalty
    score += negativity_adjustment

    if evidence_presence > 80 and completeness < 40:
        score -= 3

    if not moderation["override_applied"] and toxicity_score >= 70:
        score -= 12
    elif not moderation["override_applied"] and toxicity_score >= 45:
        score -= 6

    return {
        "bqs": clamp_score(round(score), 0.0),
        "moderation": moderation,
    }


# ── Explanation / Paragraph Breakdowns ───────────────────────────────

def build_writer_dna(archetype_result: dict[str, Any]) -> dict[str, float]:
    scores = archetype_result.get("scores") or {}
    total = sum(float(value) for value in scores.values()) or 1.0

    return {
        "analyst": round(float(scores.get("analyst", 0.0)) / total * 100, 1),
        "fan": round(float(scores.get("fan", 0.0)) / total * 100, 1),
        "storyteller": round(float(scores.get("storyteller", 0.0)) / total * 100, 1),
        "debater": round(float(scores.get("debater", 0.0)) / total * 100, 1),
    }


def build_dimension_explanations(
    constructiveness: float,
    negativity_score: float,
    toxicity_score: float,
    originality: float,
    coherence: float,
    stat_accuracy: float,
    rule_scores: dict[str, float],
    embedding_scores: dict[str, Any],
) -> dict[str, str]:
    reference_count = embedding_scores.get("reference_corpus_size", 0)
    reference_note = (
        f" using {reference_count} reference texts"
        if reference_count
        else " using intra-document variation only"
    )

    return {
        "constructiveness": (
            "The article makes evidence-led, actionable cricket points."
            if constructiveness >= 70
            else "The article is understandable, but some claims need more actionable reasoning."
        ),
        "negativity": (
            "The tone is strongly critical or disappointed."
            if negativity_score >= 60
            else "The tone stays mostly neutral or supportive."
        ),
        "toxicity": (
            "Language crosses into personal ridicule or hostility."
            if toxicity_score >= 45
            else "Criticism mostly stays focused on cricket rather than abuse."
        ),
        "originality": (
            f"Originality was estimated from semantic novelty{reference_note}."
            if originality >= 65
            else f"Similar framing was found semantically{reference_note}."
        ),
        "coherence": (
            "Paragraph embeddings stay aligned from one section to the next."
            if coherence >= 70
            else "The semantic flow between sections is only moderately stable."
        ),
        "stat_accuracy": (
            "Correctness uses the existing fact-checking lane rather than a self-consistency heuristic."
            if stat_accuracy >= 75
            else "Correctness is currently limited by the existing fact-checking confidence."
        ),
        "info_density": (
            "The piece carries concrete cricket detail and context."
            if rule_scores["info_density"] >= 65
            else "The piece could use more specific cricket detail."
        ),
        "argument_logic": (
            "Reasoning markers and structure support the argument."
            if rule_scores["argument_logic"] >= 65
            else "The position is present, but the reasoning chain is still light."
        ),
        "evidence_presence": (
            "Claims are supported by entities, stats, or concrete references."
            if rule_scores["evidence_presence"] >= 60
            else "More named evidence or stats would strengthen the piece."
        ),
        "counter_acknowledge": (
            "The writing acknowledges counter-positions."
            if rule_scores["counter_acknowledge"] >= 35
            else "Counter-arguments are only lightly acknowledged."
        ),
        "position_clarity": (
            "The author's stance is explicit and easy to follow."
            if rule_scores["position_clarity"] >= 60
            else "The main stance could be stated more clearly."
        ),
        "completeness": (
            "The article has enough structure to read as a complete take."
            if rule_scores["completeness"] >= 60
            else "The article is short or structurally incomplete."
        ),
        "repetition_penalty": (
            "Repeated wording noticeably drags the score down."
            if rule_scores["repetition_penalty"] >= 35
            else "Repetition is low enough that it does not heavily hurt the score."
        ),
    }


def build_explanation(
    bqs: float,
    constructiveness: float,
    negativity_score: float,
    toxicity_score: float,
    originality: float,
    coherence: float,
    stat_accuracy: float,
    rule_scores: dict[str, float],
    moderation: dict[str, float | bool],
    embedding_scores: dict[str, Any],
) -> dict[str, Any]:
    dimensions = build_dimension_explanations(
        constructiveness=constructiveness,
        negativity_score=negativity_score,
        toxicity_score=toxicity_score,
        originality=originality,
        coherence=coherence,
        stat_accuracy=stat_accuracy,
        rule_scores=rule_scores,
        embedding_scores=embedding_scores,
    )

    strengths = [
        "Constructive reasoning" if constructiveness >= 70 else "Clear core stance",
        "Strong semantic flow" if coherence >= 70 else "Readable paragraph flow",
        "Distinct cricket framing" if originality >= 65 else "Some original framing",
    ]
    concerns = [
        "Hostility risk" if toxicity_score >= 45 else "More proof points needed",
        "Strongly negative tone" if negativity_score >= 60 else "Counter-view is thin",
        "Repetition drag" if rule_scores["repetition_penalty"] >= 35 else "Depth can still improve",
    ]

    if bqs >= 85:
        summary = "This article scores highly because it stays coherent, constructive, and evidence-led."
    elif bqs >= 70:
        summary = "This article is solid overall, with more strengths than structural weaknesses."
    elif bqs >= 55:
        summary = "This article is workable, but several dimensions still cap the BQS."
    else:
        summary = "This article loses BQS mostly on hostility, thin evidence, or limited structure."

    negativity_vs_toxicity = (
        "The system detected critical language, but it did not treat all criticism as toxicity."
        if negativity_score > toxicity_score
        else "Negative tone overlaps with more hostile phrasing, so toxicity weighed more heavily."
    )

    if moderation["override_applied"]:
        penalty_decision = "A reduced toxicity penalty was used because the criticism stayed evidence-led."
    elif moderation["penalty_applied"]:
        penalty_decision = "A toxicity penalty was applied because the language became too hostile."
    else:
        penalty_decision = "No toxicity penalty was needed because the language stayed focused on cricket."

    return {
        "summary": summary,
        "strengths": strengths,
        "concerns": concerns,
        "negativity_vs_toxicity": negativity_vs_toxicity,
        "penalty_decision": penalty_decision,
        "user_visible_breakdown": [
            f"Constructiveness {round(constructiveness)}/100",
            f"Coherence {round(coherence)}/100",
            f"Correctness {round(stat_accuracy)}/100",
        ],
        "dimensions": dimensions,
    }


def _paragraph_evidence_score(paragraph: str) -> float:
    numeric_hits = len(re.findall(r"\b\d+(\.\d+)?\b", paragraph))
    proper_nouns = len(re.findall(r"\b(?:[A-Z]{2,}|[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b", paragraph))
    cricket_terms = _count_regex_hits(
        paragraph.lower(),
        [
            r"\bruns?\b", r"\bwickets?\b", r"\bstrike rate\b", r"\beconomy\b",
            r"\binnings\b", r"\bover(s)?\b", r"\bpowerplay\b", r"\bphase\b",
            r"\baverage\b", r"\bmatchup\b",
        ],
    )
    return clamp_score(18 + numeric_hits * 10 + proper_nouns * 4 + cricket_terms * 6, 25.0)


def build_paragraph_scores(
    paragraphs: list[str],
    embedding_scores: dict[str, Any],
) -> list[dict[str, Any]]:
    if not paragraphs:
        return []

    chunk_embeddings = embedding_scores.get("embedding_context", {}).get("chunk_embeddings")
    chunk_texts = embedding_scores.get("embedding_context", {}).get("chunk_texts") or paragraphs
    chunk_lookup = {index: chunk_text for index, chunk_text in enumerate(chunk_texts)}

    paragraph_scores: list[dict[str, Any]] = []
    for index, paragraph in enumerate(paragraphs):
        constructiveness = score_constructiveness(paragraph)
        negativity = score_negativity(paragraph)
        toxicity = score_toxicity(paragraph)
        evidence = _paragraph_evidence_score(paragraph)

        coherence = embedding_scores["coherence"]
        if (
            isinstance(chunk_embeddings, np.ndarray)
            and len(chunk_embeddings) > 1
            and index < len(chunk_embeddings)
            and chunk_lookup.get(index) == paragraph
        ):
            local_sims: list[float] = []
            if index > 0:
                local_sims.append(cosine_similarity(chunk_embeddings[index], chunk_embeddings[index - 1]))
            if index < len(chunk_embeddings) - 1:
                local_sims.append(cosine_similarity(chunk_embeddings[index], chunk_embeddings[index + 1]))
            if local_sims:
                coherence = clamp_score(scale_between(safe_mean(local_sims, 0.6), 0.2, 0.9) * 100, coherence)

        overall = clamp_score((constructiveness + coherence + evidence + max(0.0, 100.0 - toxicity)) / 4, 60.0)
        if toxicity >= 45:
            note = "Tone is drifting into personal hostility."
        elif evidence >= 60:
            note = "Paragraph includes at least one concrete support signal."
        else:
            note = "Paragraph is readable but could use sharper evidence."

        paragraph_scores.append(
            {
                "paragraph_index": index,
                "excerpt": excerpt_for_paragraph(paragraph),
                "overall": overall,
                "constructiveness": constructiveness,
                "negativity": negativity,
                "toxicity": toxicity,
                "evidence": evidence,
                "coherence": coherence,
                "note": note,
            }
        )

    return paragraph_scores


# ── Full Pipeline ────────────────────────────────────────────────────

def compute_bqs(text: str, include_fact_check_score: bool = True) -> dict[str, Any]:
    pre_processed = pre_process(text)
    archetype_result = classify_archetype(text)
    archetype = archetype_result["label"]

    constructiveness = score_constructiveness(text)
    negativity_score = score_negativity(text)
    toxicity_score = score_toxicity(text)

    embedding_scores = score_coherence_originality(
        text=text,
        paragraphs=pre_processed["paragraphs"],
        sentences=pre_processed["sentences"],
    )
    coherence = embedding_scores["coherence"]
    originality = embedding_scores["originality"]

    ner_result = extract_cricket_entities(text)
    stats_found = len(ner_result.get("stats_found", []))
    stats_verified = ner_result.get("stats_verified", 0)
    entities_found = len(ner_result.get("entities", []))

    stat_accuracy = (
        get_fact_check_score(text, archetype=archetype)
        if include_fact_check_score
        else 75.0
    )

    rules = rule_engine(text, ner_result, pre_processed)
    assembled = assemble_bqs(
        archetype=archetype,
        constructiveness=constructiveness,
        negativity_score=negativity_score,
        toxicity_score=toxicity_score,
        originality=originality,
        coherence=coherence,
        stat_accuracy=stat_accuracy,
        info_density=rules["info_density"],
        argument_logic=rules["argument_logic"],
        evidence_presence=rules["evidence_presence"],
        counter_acknowledge=rules["counter_acknowledge"],
        position_clarity=rules["position_clarity"],
        completeness=rules["completeness"],
        repetition_penalty=rules["repetition_penalty"],
    )
    moderation = assembled["moderation"]
    paragraph_scores = build_paragraph_scores(pre_processed["paragraphs"], embedding_scores)
    explanation = build_explanation(
        bqs=assembled["bqs"],
        constructiveness=constructiveness,
        negativity_score=negativity_score,
        toxicity_score=toxicity_score,
        originality=originality,
        coherence=coherence,
        stat_accuracy=stat_accuracy,
        rule_scores=rules,
        moderation=moderation,
        embedding_scores=embedding_scores,
    )

    return {
        "archetype": archetype,
        "archetype_confidence": clamp_unit(archetype_result.get("confidence"), 0.5),
        "tone_score": constructiveness,
        "negativity_score": negativity_score,
        "toxicity_score": toxicity_score,
        "originality_score": originality,
        "coherence_score": coherence,
        "constructiveness": constructiveness,
        "evidence_presence": rules["evidence_presence"],
        "counter_acknowledge": rules["counter_acknowledge"],
        "position_clarity": rules["position_clarity"],
        "info_density": rules["info_density"],
        "repetition_penalty": rules["repetition_penalty"],
        "completeness": rules["completeness"],
        "argument_logic": rules["argument_logic"],
        "stat_accuracy": stat_accuracy,
        "entities_found": entities_found,
        "stats_found": stats_found,
        "stats_verified": stats_verified,
        "word_count": pre_processed["word_count"],
        "lexical_diversity": pre_processed["lexical_diversity"],
        "sentence_variety": pre_processed["sentence_variety"],
        "avg_sentence_length": pre_processed["avg_sentence_length"],
        "bqs": assembled["bqs"],
        "toxicity_penalty_applied": bool(moderation["penalty_applied"]),
        "toxicity_penalty_override": bool(moderation["override_applied"]),
        "writer_dna": build_writer_dna(archetype_result),
        "paragraph_scores": paragraph_scores,
        "explanation": explanation,
        "score_version": BQS_SCORE_VERSION,
        "reference_corpus_size": embedding_scores["reference_corpus_size"],
        "reference_corpus_source": embedding_scores["reference_source"],
        "max_reference_similarity": embedding_scores["max_reference_similarity"],
        "adjacent_similarity": embedding_scores["adjacent_similarity"],
    }
