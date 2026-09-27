from __future__ import annotations

import json
from pathlib import Path
from typing import List

import faiss
import numpy as np
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from sentence_transformers import SentenceTransformer
from transformers import pipeline

ARTIFACTS_DIR = Path("artifacts")
INDEX_PATH = ARTIFACTS_DIR / "vector_store.faiss"
METADATA_PATH = ARTIFACTS_DIR / "chunks.json"
EMBEDDING_MODEL = "all-MiniLM-L6-v2"
GENERATION_MODEL = "google/flan-t5-small"
TOP_K = 4


class QueryRequest(BaseModel):
    question: str


class QueryResponse(BaseModel):
    answer: str
    contexts: List[str]


def load_index(index_path: Path = INDEX_PATH) -> faiss.IndexFlatIP:
    if not index_path.exists():
        raise FileNotFoundError(f"Missing index at {index_path}. Run rag/ingest.py first.")
    return faiss.read_index(str(index_path))


def load_metadata(metadata_path: Path = METADATA_PATH) -> List[dict]:
    if not metadata_path.exists():
        raise FileNotFoundError(f"Missing metadata at {metadata_path}. Run rag/ingest.py first.")
    content = metadata_path.read_text(encoding="utf-8")
    return json.loads(content)


def build_retriever():
    index = load_index()
    metadata = load_metadata()
    encoder = SentenceTransformer(EMBEDDING_MODEL)
    return index, metadata, encoder


def build_generator():
    return pipeline("text2text-generation", model=GENERATION_MODEL)


def search(index: faiss.IndexFlatIP, encoder: SentenceTransformer, query: str, top_k: int = TOP_K):
    query_vector = encoder.encode([query], convert_to_numpy=True, normalize_embeddings=True).astype(np.float32)
    distances, indices = index.search(query_vector, top_k)
    return distances[0], indices[0]


def compose_prompt(question: str, contexts: List[str]) -> str:
    formatted_contexts = "\n".join(f"- {ctx}" for ctx in contexts)
    return (
        "You are a retrieval-augmented assistant. Use only the provided context to answer the question. "
        "Respond concisely with numbered bullets when listing steps.\n"
        f"Context:\n{formatted_contexts}\n\nQuestion: {question}\nAnswer:"
    )


app = FastAPI(title="Mini RAG Service", version="0.1.0")

index, metadata, encoder = build_retriever()
generator = build_generator()


@app.post("/query", response_model=QueryResponse)
def query_rag(request: QueryRequest) -> QueryResponse:
    if not request.question.strip():
        raise HTTPException(status_code=400, detail="Question cannot be empty")

    distances, indices = search(index, encoder, request.question)
    contexts: List[str] = []
    for idx in indices:
        if idx < 0 or idx >= len(metadata):
            continue
        contexts.append(metadata[idx]["text"])

    if not contexts:
        raise HTTPException(status_code=500, detail="No contexts retrieved")

    prompt = compose_prompt(request.question, contexts)
    generation = generator(prompt, max_new_tokens=128, num_beams=2)[0]["generated_text"]
    return QueryResponse(answer=generation.strip(), contexts=contexts)


@app.get("/healthz")
def healthcheck():
    return {"status": "ok"}
