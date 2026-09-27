# CricGeek AI Scoring Service

A Python FastAPI microservice that loads open-source HuggingFace models and scores cricket blog posts using the 7-step BQS pipeline.

## Models Used

| Model | Task | HuggingFace ID |
|---|---|---|
| BART-MNLI | Archetype classification (Fan/Analyst/Storyteller/Debater) | `facebook/bart-large-mnli` |
| RoBERTa | Sentiment support for negativity reads | `cardiffnlp/twitter-roberta-base-sentiment-latest` |
| Toxic-BERT | Toxicity detection | `martin-ha/toxic-comment-model` |
| BGE Large | Coherence + originality via dense embeddings | `BAAI/bge-large-en-v1.5` |

Models are downloaded to `~/.cache/huggingface/` on first run.
You can optionally point originality scoring at a larger reference corpus with:

```env
BQS_REFERENCE_CORPUS_PATH=/absolute/path/to/corpus.json
```

If unset, the service falls back to `src/data/bqs-calibration.json`.

## Setup

### 1. Create virtual environment

```bash
cd ai_service
python3 -m venv venv
source venv/bin/activate   # Windows: venv\Scripts\activate
```

### 2. Install dependencies

```bash
pip install -r requirements.txt
```

### 3. Start the service

```bash
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

Or directly:

```bash
python main.py
```

The service will print model loading progress. When all 4 models are loaded, you'll see:
```
✅ All models loaded. Service ready.
```

## API Endpoints

### `GET /health`

Returns model loading status.

```json
{
  "status": "ok",
  "models_loaded": true,
  "model_status": {
    "bart_classifier": true,
    "roberta_sentiment": true,
    "toxic_classifier": true,
    "minilm": true
  }
}
```

### `POST /score`

Score a blog post.

**Request:**
```json
{
  "text": "Jasprit Bumrah is arguably the best fast bowler in the world right now...",
  "blog_id": "optional-id",
  "skip_fact_check": false
}
```

**Response:**
```json
{
  "archetype": "analyst",
  "archetype_confidence": 0.71,
  "bqs": 83.15,
  "constructiveness": 88.0,
  "negativity_score": 18.0,
  "toxicity_score": 2.1,
  "originality_score": 79.0,
  "coherence_score": 81.0,
  "argument_logic": 66.0,
  "stat_accuracy": 80.0,
  "info_density": 71.0,
  "score_version": "hf-bge-bart-v1",
  "word_count": 187,
  "lexical_diversity": 0.74,
  ...
}
```

## Environment Variable

The Next.js app reads the service URL from `AI_SERVICE_URL` (defaults to `http://localhost:8000`).
Set this in `.env.local`:

```
AI_SERVICE_URL=http://localhost:8000
```

## BQS Scoring Overview

The Blog Quality Score (0–100) is computed using archetype-specific weights:

| Component | Fan | Analyst | Storyteller | Debater |
|---|---|---|---|---|
| Constructiveness | 25% | 25% | 20% | 20% |
| Toxicity (inv) | 15% | 15% | 15% | 15% |
| Originality | 15% | 10% | 20% | 10% |
| Stat Accuracy | 15% | 25% | — | 10% |
| Info Density | 10% | 15% | 10% | 15% |
| Coherence | 10% | 10% | 20% | 15% |
| Argument Logic | 10% | — | 15% | 15% |
