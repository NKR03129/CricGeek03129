from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, List

import faiss
import numpy as np
from sentence_transformers import SentenceTransformer


@dataclass
class DocumentChunk:
    doc_id: str
    chunk_id: int
    text: str


DOCS_DIR = Path("data/docs")
ARTIFACTS_DIR = Path("artifacts")
INDEX_PATH = ARTIFACTS_DIR / "vector_store.faiss"
METADATA_PATH = ARTIFACTS_DIR / "chunks.json"
MODEL_NAME = "all-MiniLM-L6-v2"


def chunk_text(text: str, chunk_size: int = 520, overlap: int = 80) -> List[str]:
    cleaned = " ".join(text.split())
    chunks: List[str] = []
    start = 0
    while start < len(cleaned):
        end = min(len(cleaned), start + chunk_size)
        chunk = cleaned[start:end]
        chunks.append(chunk)
        start += chunk_size - overlap
    return chunks


def load_documents(docs_dir: Path = DOCS_DIR) -> List[DocumentChunk]:
    chunks: List[DocumentChunk] = []
    for path in sorted(docs_dir.glob("*.md")):
        text = path.read_text(encoding="utf-8")
        chunk_texts = chunk_text(text)
        for idx, chunk in enumerate(chunk_texts):
            chunks.append(DocumentChunk(doc_id=path.stem, chunk_id=idx, text=chunk))
    return chunks


def build_index(chunks: Iterable[DocumentChunk], model_name: str = MODEL_NAME) -> faiss.IndexFlatIP:
    model = SentenceTransformer(model_name)
    corpus = [chunk.text for chunk in chunks]
    embeddings = model.encode(corpus, convert_to_numpy=True, normalize_embeddings=True)
    dimension = embeddings.shape[1]
    index = faiss.IndexFlatIP(dimension)
    index.add(embeddings.astype(np.float32))
    return index


def save_artifacts(index: faiss.IndexFlatIP, chunks: List[DocumentChunk]) -> None:
    ARTIFACTS_DIR.mkdir(parents=True, exist_ok=True)
    faiss.write_index(index, str(INDEX_PATH))
    serialized = [chunk.__dict__ for chunk in chunks]
    METADATA_PATH.write_text(json.dumps(serialized, indent=2), encoding="utf-8")


def main() -> None:
    chunks = load_documents()
    index = build_index(chunks)
    save_artifacts(index, chunks)
    print(f"Saved {len(chunks)} chunks to {INDEX_PATH} and metadata to {METADATA_PATH}.")


if __name__ == "__main__":
    main()
