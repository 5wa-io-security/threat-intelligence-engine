# 5WA Threat Intelligence Engine — LLM Integration

**Author:** Manus AI  
**Prepared:** 2026-09-09

This integration adds a feature-gated **Step 3.5** after heuristic incident parsing and before the existing deduplication/storage stage. Each incident can receive a validated severity score, corrected attack/victim classification, concise AI summary, relevance confidence, and the model identifier that produced the result.

> **Important model update:** Groq’s deprecation page lists `llama-3.1-8b-instant` with a shutdown date of **2026-08-16** and recommends `openai/gpt-oss-20b` as its replacement.[1] The current implementation therefore uses `openai/gpt-oss-20b` by default and keeps the model configurable through `GROQ_MODEL`.

Groq’s API supports the OpenAI-compatible chat-completions endpoint and JSON output. Ollama’s official OpenAI compatibility documentation supports `/v1/chat/completions`, JSON mode, `/v1/models`, and `max_tokens` for local model serving.[2] [3]

## Included files

| Path | Action | Purpose |
| --- | --- | --- |
| `src/llm/config.ts` | Add | Typed provider/model configuration, validation, and provider selection |
| `src/llm/llm-client.ts` | Replace | Native-fetch Groq client, optional Ollama fallback, health check, retries, usage metadata, and throttling |
| `src/llm/classifier.ts` | Replace | Runtime output validation, per-incident enrichment, tag synchronization, aggregate metrics, and graceful failure |
| `src/llm/prompts.ts` | Add | Concise scoring, classification, summary, and relevance prompts |
| `src/llm/config.test.ts` | Add | Configuration, model defaults, provider modes, and URL validation tests |
| `src/llm/llm-client.test.ts` | Replace | Request shape, throttling, retries, health check, Ollama-only mode, fallback, and usage tests |
| `src/llm/classifier.test.ts` | Add | Parsing, classification, tagging, and graceful-failure tests |
| `src/llm/quality-fixtures.ts` | Add | Redacted deterministic enrichment fixtures for regression checks |
| `src/index.ts` | Replace | Adds provider-aware Step 3.5 and configuration warnings |
| `src/database/operations.ts` | Replace | Adds four nullable enrichment fields to `ThreatIncident` |
| `src/parsers/incident-parser.ts` | Replace | Initializes all LLM fields to `null` |
| `.github/workflows/collect-threats.yml` | Replace | Injects provider secrets and provides enough timeout for sequential processing |
| `.env.example` | Replace or merge | Documents all LLM variables without credentials |
| `supabase/migrations/20260815000000_add_llm_enrichment_columns.sql` | Add | Adds four nullable Supabase columns |
| `package.json` | Replace | Adds `npm test`; no new runtime dependency |
| `INDEPENDENT_DEVELOPMENT_AUDIT.md` | Add | Records the independent-development boundary and current compatibility findings |
| `VALIDATION.md` | Add or update | Records static and mocked-provider validation |

## Provider modes

`LLM_PROVIDER=auto` is the default. It tries Groq first and then Ollama if Groq fails. Set `LLM_PROVIDER=groq` to use Groq only, or `LLM_PROVIDER=ollama` to run locally on the Jetson without a Groq key. The pipeline enables Step 3.5 whenever at least one configured provider has a valid HTTP or HTTPS endpoint.

| Variable | Default | Meaning |
| --- | --- | --- |
| `LLM_PROVIDER` | `auto` | `auto`, `groq`, or `ollama` |
| `GROQ_API_KEY` | empty | Groq credential; keep it in GitHub Secrets |
| `GROQ_BASE_URL` | `https://api.groq.com/openai/v1` | Groq-compatible API base URL |
| `GROQ_MODEL` | `openai/gpt-oss-20b` | Current Groq model default; override only after testing |
| `OLLAMA_URL` | empty | Base URL such as `http://127.0.0.1:11434` |
| `OLLAMA_API_KEY` | empty | Optional Bearer token for an authenticated gateway |
| `OLLAMA_MODEL` | `llama3.1:8b` | Local model tag; can be a quantized/custom model name |
| `LLM_REQUEST_TIMEOUT_MS` | `30000` | Per-request timeout |
| `LLM_MAX_ATTEMPTS` | `3` | Maximum attempts per provider request |
| `LLM_MAX_RETRY_DELAY_MS` | `30000` | Upper bound for retry backoff |
| `LLM_MAX_COMPLETION_TOKENS` | `300` | Output token budget |
| `LLM_MIN_CONFIDENCE` | `0.65` | Minimum `confidence_score` required before LLM fields replace heuristic values |
| `GROQ_MIN_REQUEST_INTERVAL_MS` | `2000` | Minimum interval between Groq request starts |

## Health check and failure behavior

Before processing incidents, the default client performs one `GET /v1/models` preflight request for each configured provider. It checks endpoint reachability and, when the endpoint returns model IDs, verifies the configured model. An unavailable provider is disabled for the remainder of that run, preventing a stopped Jetson from causing a timeout for every incident.

The health check is observability only. The normal completion path still performs provider fallback and runtime JSON validation. If every provider fails, the original heuristic incident is preserved and the pipeline continues. No prompt, raw article content, API key, or full model response is written to logs.

The confidence gate provides a second, provider-independent safety boundary. A valid JSON response whose `confidence_score` is below `LLM_MIN_CONFIDENCE` is treated as a failed enrichment: the original heuristic incident is returned unchanged, including its nullable LLM fields. The default is `0.65`; raise it for conservative production operation or set it to `0` when intentionally accepting every schema-valid model result.

Do not expose an unauthenticated Ollama port directly to the public Internet. Keep plain HTTP on localhost or a private VPN, or place the endpoint behind HTTPS and authentication. The configuration layer emits a warning whenever `OLLAMA_URL` uses plain HTTP.

## Usage and cost observability

Successful completions record provider, model, request latency, and available token counts in aggregate workflow logs. Groq usage is read from `usage.prompt_tokens`, `usage.completion_tokens`, and `usage.total_tokens`. Ollama usage is normalized from `prompt_eval_count`, `eval_count`, and duration fields. This makes monthly cost estimation possible without storing article content.

For a provider priced per token, calculate:

```text
monthly_cost = monthly_prompt_tokens / 1,000,000 * input_price
              + monthly_completion_tokens / 1,000,000 * output_price
```

Prices change, so do not hard-code cost figures into incident records. Read the current provider pricing page when calculating the monthly estimate. Groq’s rate-limit documentation also describes HTTP 429 behavior and the `retry-after` header, which the client honors.[4]

## Installation and validation

Extract the package at the repository root so the included paths merge into the existing project. If your current `.env.example` contains additional project-specific variables, merge the new entries rather than replacing existing lines.

Apply the Supabase migration before enabling enrichment:

```bash
supabase db push
```

Then run:

```bash
npm ci
npm test
npm run llm:quality
npm run typecheck
npm run build
```

For local Ollama-only validation, configure:

```bash
LLM_PROVIDER=ollama
OLLAMA_URL=http://127.0.0.1:11434
OLLAMA_MODEL=llama3.1:8b
npm run collect
```

For GitHub Actions, store `GROQ_API_KEY` as a repository secret. Store `OLLAMA_URL` only if a secure private route from the runner to the Jetson exists. Do not use a private LAN address that the GitHub-hosted runner cannot reach, and do not publish port `11434` without authentication and network controls.

The CI workflow runs `npm run llm:contract` and `npm run llm:quality` before the collector. The first is a provider protocol smoke test; the second runs two redacted deterministic fixtures plus one low-confidence downgrade case without contacting any external service. After pushing, run **Collect Threat Intelligence** manually once. Confirm that logs show the provider mode, preflight health result, configured confidence gate, `LLM enrichment complete`, aggregated token/latency counters, and normal database insertion. Never print secret values in workflow logs.

## References

[1]: https://console.groq.com/docs/deprecations "GroqDocs — Model Deprecation"
[2]: https://console.groq.com/docs/models "GroqDocs — Supported Models and Pricing"
[3]: https://docs.ollama.com/api/openai-compatibility "Ollama Documentation — OpenAI Compatibility"
[4]: https://console.groq.com/docs/rate-limits "GroqDocs — Rate Limits"
