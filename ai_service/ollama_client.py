"""
CricGeek — Ollama Client

Ollama REST API integration.
Supports any model pulled into Ollama (Qwen, Llama, Mistral, etc.).

Default model: qwen2.5 (configurable via OLLAMA_MODEL env var)
"""

import os
import json
import re
import logging
from typing import Optional

import httpx

logger = logging.getLogger("ollama")

OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL") or os.getenv("OLLAMA_URL") or "http://localhost:11434"
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "qwen2.5")
OLLAMA_TIMEOUT = 60.0  # Local models can be slow on first load


def is_ollama_available() -> bool:
    """Check if Ollama is running and reachable."""
    try:
        resp = httpx.get(f"{OLLAMA_BASE_URL}/api/tags", timeout=3.0)
        return resp.status_code == 200
    except Exception:
        return False


def get_available_models() -> list[str]:
    """List all models pulled into Ollama."""
    try:
        resp = httpx.get(f"{OLLAMA_BASE_URL}/api/tags", timeout=5.0)
        if resp.status_code == 200:
            data = resp.json()
            return [m.get("name", "") for m in data.get("models", [])]
    except Exception:
        pass
    return []


def generate(
    prompt: str,
    system: str = "",
    model: Optional[str] = None,
    temperature: float = 0.3,
    max_tokens: int = 1024,
    json_mode: bool = False,
) -> Optional[str]:
    """
    Generate text using Ollama's /api/generate endpoint.

    Args:
        prompt: User prompt
        system: System prompt
        model: Model name (defaults to OLLAMA_MODEL env var or 'qwen2.5')
        temperature: Sampling temperature
        max_tokens: Max output tokens
        json_mode: If True, request JSON output format

    Returns:
        Generated text or None on failure
    """
    model = model or OLLAMA_MODEL

    payload = {
        "model": model,
        "prompt": prompt,
        "system": system,
        "stream": False,
        "options": {
            "temperature": temperature,
            "num_predict": max_tokens,
        },
    }

    if json_mode:
        payload["format"] = "json"

    try:
        resp = httpx.post(
            f"{OLLAMA_BASE_URL}/api/generate",
            json=payload,
            timeout=OLLAMA_TIMEOUT,
        )
        resp.raise_for_status()
        data = resp.json()
        return data.get("response", "")
    except httpx.ConnectError:
        logger.warning("Ollama not running. Start with: ollama serve")
        return None
    except httpx.HTTPStatusError as e:
        logger.error(f"Ollama HTTP error: {e.response.status_code}")
        if e.response.status_code == 404:
            logger.error(f"Model '{model}' not found. Pull it with: ollama pull {model}")
        return None
    except Exception as e:
        logger.error(f"Ollama request failed: {e}")
        return None


def chat(
    messages: list[dict],
    model: Optional[str] = None,
    temperature: float = 0.3,
    max_tokens: int = 1024,
    json_mode: bool = False,
) -> Optional[str]:
    """
    Chat completion using Ollama's /api/chat endpoint.

    Args:
        messages: List of {"role": "system"|"user"|"assistant", "content": "..."}
        model: Model name
        temperature: Sampling temperature
        max_tokens: Max output tokens
        json_mode: If True, request JSON output format

    Returns:
        Assistant message content or None on failure
    """
    model = model or OLLAMA_MODEL

    payload = {
        "model": model,
        "messages": messages,
        "stream": False,
        "options": {
            "temperature": temperature,
            "num_predict": max_tokens,
        },
    }

    if json_mode:
        payload["format"] = "json"

    try:
        resp = httpx.post(
            f"{OLLAMA_BASE_URL}/api/chat",
            json=payload,
            timeout=OLLAMA_TIMEOUT,
        )
        resp.raise_for_status()
        data = resp.json()
        return data.get("message", {}).get("content", "")
    except httpx.ConnectError:
        logger.warning("Ollama not running. Start with: ollama serve")
        return None
    except httpx.HTTPStatusError as e:
        logger.error(f"Ollama HTTP error: {e.response.status_code}")
        if e.response.status_code == 404:
            logger.error(f"Model '{model}' not found. Pull it with: ollama pull {model}")
        return None
    except Exception as e:
        logger.error(f"Ollama chat failed: {e}")
        return None


def parse_json_response(raw: str) -> Optional[dict]:
    """
    Parse JSON from an LLM response, handling markdown fences and extra text.
    """
    if not raw:
        return None

    cleaned = raw.strip()

    # Strip markdown fences
    if "```" in cleaned:
        cleaned = re.sub(r"```(?:json)?\s*", "", cleaned)
        cleaned = cleaned.rstrip("`").strip()

    # Try to find JSON object in the response
    # Sometimes models add text before/after the JSON
    json_match = re.search(r"\{.*\}", cleaned, re.DOTALL)
    if json_match:
        try:
            return json.loads(json_match.group())
        except json.JSONDecodeError:
            pass

    # Direct parse attempt
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        logger.warning(f"Failed to parse JSON from LLM: {cleaned[:150]}...")
        return None


def health_check() -> dict:
    """Check Ollama status and available models."""
    available = is_ollama_available()
    models = get_available_models() if available else []
    default_ready = OLLAMA_MODEL in [m.split(":")[0] for m in models] or \
                    any(OLLAMA_MODEL in m for m in models)

    return {
        "status": "ok" if available else "unavailable",
        "base_url": OLLAMA_BASE_URL,
        "default_model": OLLAMA_MODEL,
        "default_model_ready": default_ready,
        "available_models": models,
    }
