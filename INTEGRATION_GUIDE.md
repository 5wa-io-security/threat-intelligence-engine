# 5WA Threat Intelligence Engine — Groq LLM Integration

**Author:** Manus AI  
**Prepared:** 2026-08-15

This commit package adds a feature-gated **Step 3.5** after heuristic incident parsing and before the existing deduplication/storage stage. Each incident can now receive a validated severity score, corrected attack/victim classification, concise AI summary, relevance confidence, and the model identifier that produced the result.

Groq’s official model documentation confirms that `llama-3.1-8b-instant` supports JSON mode, and the chat-completions API accepts `response_format: {"type":"json_object"}`.[1] [2] The implementation deliberately uses JSON Object Mode rather than strict JSON Schema because Groq’s current Structured Outputs documentation lists strict schema support only for selected GPT-OSS models, while directing other models to JSON Object Mode.[3]

## Included files

| Path | Action | Purpose |
| --- | --- | --- |
| `src/llm/llm-client.ts` | Add | Native-fetch Groq client, optional Ollama fallback, timeout, retries, `Retry-After`, and two-second Groq throttle |
| `src/llm/classifier.ts` | Add | Runtime output validation, per-incident enrichment, tag synchronization, and graceful failure |
| `src/llm/prompts.ts` | Add | Concise scoring, classification, summary, and relevance prompts |
| `src/llm/llm-client.test.ts` | Add | Mocked request, throttling, retry, and Ollama fallback tests |
| `src/llm/classifier.test.ts` | Add | Parsing, classification, tagging, and graceful-failure tests |
| `src/index.ts` | Replace | Adds feature-gated Step 3.5 before deduplication/storage |
| `src/database/operations.ts` | Replace | Adds four nullable fields to `ThreatIncident` and one explicit query-row type |
| `src/parsers/incident-parser.ts` | Replace | Initializes all LLM fields to `null` |
| `.github/workflows/collect-threats.yml` | Replace | Injects Groq/Ollama secrets and raises timeout to 60 minutes |
| `.env.example` | Add or merge | Documents LLM variables without credentials |
| `supabase/migrations/20260815000000_add_llm_enrichment_columns.sql` | Add | Adds four nullable Supabase columns |
| `package.json` | Replace | Adds `npm test`; no dependency is added |
| `VALIDATION.md` | Add | Records completed static and mocked-provider checks |

## Installation

Extract the archive at the repository root so the included paths merge into the existing project. If your current `.env.example` contains additional project-specific variables, merge the four relevant entries instead of discarding those existing lines.

Apply the database migration **before** enabling the workflow secret. With Supabase CLI, run:

```bash
supabase db push
```

Alternatively, execute the contents of `supabase/migrations/20260815000000_add_llm_enrichment_columns.sql` once in the Supabase SQL Editor.

## Secret setup

The Groq key included in the original request was exposed in plaintext. **Revoke it and create a replacement key before deployment.** Do not put the replacement in source code, `.env.example`, logs, or workflow YAML.

In GitHub, open **Settings → Secrets and variables → Actions → New repository secret**, then create:

| Secret | Required | Value |
| --- | --- | --- |
| `GROQ_API_KEY` | Yes for Step 3.5 | Newly rotated Groq API key |
| `OLLAMA_URL` | No | Base server URL such as `http://host:11434`; leave absent if no fallback is available |

The workflow already maps these repository secrets into the collector process. An absent `GROQ_API_KEY` skips Step 3.5 and keeps the existing heuristic-only pipeline. An absent `OLLAMA_URL` silently disables only the fallback path.

## Validation before push

Run the project’s normal installation and checks from the repository root:

```bash
npm ci
npm test
npm run typecheck
npm run build
```

Then test locally with a newly rotated key. In Windows PowerShell, use semicolons rather than Bash `&&`:

```powershell
$env:GROQ_API_KEY="your-rotated-key"; $env:LOG_LEVEL="debug"; npm run collect
```

To exercise Ollama fallback locally, add:

```powershell
$env:OLLAMA_URL="http://127.0.0.1:11434"; npm run collect
```

After pushing, run **Collect Threat Intelligence** manually from the GitHub Actions tab once. Confirm that logs show `Step 3.5/4`, `LLM enrichment complete`, and normal database insertion. Do not print or inspect secret values in workflow logs.

## Runtime behavior

| Condition | Result |
| --- | --- |
| `GROQ_API_KEY` absent | LLM step is skipped; heuristic incidents continue unchanged |
| Groq success with valid JSON | Validated fields and classifications are stored; `llm_model` records the response model |
| Groq transient error | Up to three attempts use bounded exponential backoff; HTTP 429 honors `Retry-After` |
| Groq invalid output | Output is rejected; configured Ollama is attempted |
| Groq authentication failure | Groq is disabled for the rest of that run; configured Ollama can continue |
| Ollama absent or also fails | The original heuristic incident is preserved with nullable LLM fields; the pipeline continues |
| Low relevance confidence | The score is stored for downstream filtering; this integration does not silently delete the incident |

Groq documents a 30 requests-per-minute limit and 14,400 requests per day for `llama-3.1-8b-instant`; it also documents HTTP 429 and the `retry-after` response header.[4] The client therefore starts Groq requests no less than two seconds apart, including retry attempts.

## References

[1]: https://console.groq.com/docs/model/llama-3.1-8b-instant "GroqDocs — Llama 3.1 8B Instant"
[2]: https://console.groq.com/docs/api-reference "GroqDocs — API Reference"
[3]: https://console.groq.com/docs/structured-outputs "GroqDocs — Structured Outputs"
[4]: https://console.groq.com/docs/rate-limits "GroqDocs — Rate Limits"
