# Validation Report

**Project:** 5WA Threat Intelligence Engine — independent LLM/Ollama development stage
**Date:** 2026-09-14
**Author:** Manus AI

The integration was validated without calling Groq, without using the exposed key from the original request, and without requiring access to the Jetson. Provider behavior was tested with deterministic native-fetch mocks.

| Check | Result | Scope |
| --- | --- | --- |
| Unit tests | **Passed: 22/22** | Configuration, current model default, provider mode, URL validation, JSON validation, classification override, confidence gate, graceful failure, provider exhaustion short-circuit, request shape, throttle, transient retry, daily quota circuit breaker, health checks, Ollama-only mode, fallback, and usage metadata |
| Provider contract smoke | **Passed** | Disposable local HTTP servers for `/v1/models`, JSON-mode completion, usage, fallback, retry, and timeout; no external provider contacted |
| LLM quality regression | **Passed** | Two redacted deterministic fixtures plus one low-confidence downgrade case; no external provider contacted |
| Strict TypeScript check | **Passed** | Complete repository after provider contract and confidence-gate integration |
| Production build | **Passed** | `npm run build` completed and emitted `dist/` output |
| No-provider smoke check | **Passed as expected** | `npm run llm:check` returns exit code 1 with a clear configuration message when no provider is configured; this is the intended fail-closed behavior |
| Secret scan | **Passed** | No Groq `gsk_...` token appears in the workspace |
| Live Groq call | **Not performed** | The original key was exposed and must be revoked/rotated before any live request |
| Live Jetson/Ollama call | **Not performed** | Requires JetPack, Ollama/model tag, private route, and endpoint details from the device |

## Independent changes now validated

The default Groq model is now `openai/gpt-oss-20b`, replacing the retired `llama-3.1-8b-instant`. The provider mode can be `auto`, `groq`, or `ollama`. The client performs one `/v1/models` preflight per configured provider, supports optional `OLLAMA_API_KEY`, normalizes Groq/Ollama usage metadata, and records aggregate provider/model/latency/token counters without logging article content or secrets.

The quota-safety gate now distinguishes a daily token quota 429 from a transient rate-limit 429. A daily quota error is not retried, disables Groq for the current run, falls back to Ollama when available, and prevents the classifier from repeatedly attempting an exhausted provider for the remaining incidents. A transient 429 still honors `Retry-After` and exponential backoff.

The Jetson connection can be tested later with:

```bash
LLM_PROVIDER=ollama \
OLLAMA_URL=http://127.0.0.1:11434 \
OLLAMA_MODEL=llama3.1:8b \
npm run llm:check
```

## Next independent stage: provider contract smoke test

The package now includes `npm run llm:contract`. It starts disposable local HTTP servers and exercises the same `/v1/models` and `/v1/chat/completions` paths used in production, without contacting Groq, Ollama, Supabase, or the Jetson. The smoke test covers Ollama-only mode with an optional Bearer token, JSON mode and `max_tokens`, usage normalization, automatic fallback after a transient provider failure, `Retry-After`/exponential retry behavior, and request timeout handling. The test uses no real credentials and does not print request bodies or credentials.

Validated result:

```text
LLM provider contract smoke passed ({"ollama":2,"fallback":2,"retry":2,"timeout":1})
```

The contract check is run before the collection job in GitHub Actions. It is intentionally independent of live provider availability, so a stopped Jetson or a missing Groq secret cannot make the CI contract gate nondeterministic.

The quality check is also run before the collection job. `LLM_MIN_CONFIDENCE` defaults to `0.65`; schema-valid results below that threshold preserve the original heuristic incident. The check covers field mapping, tag synchronization, model metadata, usage/latency accounting, and the downgrade path.

The temporary compatibility shims used in earlier validation are not intended as application files. The repository’s existing logger, collectors, geolocation parser, Supabase client, and shared constants remain authoritative.

Run these checks after merging into the complete repository:

```bash
npm ci
npm test
npm run llm:contract
npm run llm:quality
npm run typecheck
npm run build
npm run llm:check
```

The final `npm run llm:check` command is expected to exit with code `1` in an environment with no `GROQ_API_KEY` and no `OLLAMA_URL`; it is a configuration smoke check, not a no-provider success case. On Jetson or a configured provider host, it should instead report reachable health and model availability.

The attached stage package is intentionally a merge package rather than a standalone repository: the complete application must provide the existing collectors, logger, constants, Supabase client, and TypeScript configuration referenced by the staged files.
