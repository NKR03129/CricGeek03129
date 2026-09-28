/** Provider abstraction so the production language model stays swappable (spec section 3). */

export interface StructuredRequest {
  /** Human-readable stage name, used in logs and stored model-version records. */
  purpose: string;
  prompt: string;
  /**
   * JSON Schema (OpenAPI subset) describing the expected object. Providers that
   * support constrained decoding use it; the others fall back to prompt + repair.
   */
  schema?: Record<string, unknown>;
  temperature?: number;
  maxOutputTokens?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface ProviderResult<T> {
  data: T | null;
  provider: string;
  model: string;
  latencyMs: number;
  error?: string;
}

export interface LanguageProvider {
  readonly id: string;
  readonly model: string;
  isConfigured(): boolean;
  generateStructured<T>(
    request: StructuredRequest,
    validate: (value: unknown) => value is T,
  ): Promise<ProviderResult<T>>;
}
