# 5WA TIE 獨立開發盤點

**盤點日期：** 2026-09-09  
**目的：** 在尚未取得 Jetson 現場登入、JetPack 資訊與網路路徑前，先完成可獨立開發的軟體工作。

## 已確認的程式狀態

| 項目 | 現況 | 影響 |
| --- | --- | --- |
| Groq endpoint | `https://api.groq.com/openai/v1` | 可保留為預設 endpoint |
| Groq model | `llama-3.1-8b-instant` 硬編碼於 `src/llm/llm-client.ts` | 目前有淘汰風險；必須改成可配置且更新預設值 |
| Ollama model | `llama3.1:8b` 硬編碼 | 應改成環境變數可覆寫，方便 Jetson 使用量化模型或替代 tag |
| Ollama URL | 已支援 `/v1/chat/completions` 與 base URL 自動拼接 | 可保留，後續補健康檢查與安全 URL 驗證 |
| Provider fallback | Groq 失敗後嘗試 Ollama | 架構方向正確，但需要把 provider 狀態與失敗原因納入可觀測性 |
| Rate limit | Groq request start 至少間隔 2 秒 | 符合原先保守限制；後續可對 Ollama 不套用 Groq throttle |
| LLM 輸出 | JSON Object Mode + runtime validation | 適合 `llama3.1:8b` 與相容 OpenAI API 的服務 |
| Pipeline 降級 | 單筆失敗保留 heuristic incident | 符合 graceful failure 要求 |
| Tests | 已有 8 個 provider/classifier 單元測試 | 需要補模型選擇、provider 狀態、健康檢查與 cost/usage logging 測試 |
| Secret | 程式讀取 `GROQ_API_KEY`，未嵌入 key | 正確；原先外洩的 key 仍必須撤銷與輪替 |

## 外部相容性發現

Groq 官方淘汰頁列出 `llama-3.1-8b-instant` 的 shutdown date 為 **2026-08-16**，建議替代模型為 `openai/gpt-oss-20b`。因此現有 client 不能直接作為正式部署版本。[1]

Groq 官方模型頁目前列出 `openai/gpt-oss-20b` 的價格為 **US$0.075／百萬輸入 tokens**、**US$0.30／百萬輸出 tokens**，並列出 131,072 token context window。[2]

Ollama 官方定價頁將本機執行列為無服務費；本案的本地成本主要是 Jetson 電力、儲存、散熱與網路維護，而不是按 token 計費。[3]

## 可獨立開發的範圍

1. 將 Groq model、Ollama model、endpoint、timeout 與 retry 參數集中到 typed configuration。
2. 將 Groq 預設模型更新為現行可用替代模型，並保留環境變數覆寫能力。
3. 為 Ollama 加入健康檢查、明確的錯誤分類與 optional fallback 行為。
4. 為每次 enrichment 增加 provider/model/usage/latency 統計，但不記錄 prompt、API key 或完整文章內容。
5. 增加 model selection、fallback、invalid JSON、HTTP 429、timeout 與安全 URL 的測試。
6. 更新 `.env.example`、GitHub Actions 與部署文件。

## 本階段已完成的獨立開發

已完成現行 Groq model 更新、typed provider configuration、`auto/groq/ollama` mode、Ollama `/v1/models` health check、可選 API key、URL 安全驗證、usage/latency metadata、aggregate logging、`npm run llm:check` 與 Jetson 接入清單。後續又加入 daily-token-quota-aware circuit breaker：Groq 回傳 TPD 額度耗盡時不再重試，會立即 fallback 或保留 heuristic 結果；目前隔離 LLM 測試套件通過 22/22。

## 暫不在本階段執行的項目

Jetson 上的 JetPack/CUDA/Ollama 實際安裝、GPU offload、溫度與功耗測量，以及從 GitHub-hosted runner 到 Jetson 的 VPN/私有網路連線測試，都必須等取得設備版本與網路條件後再做。這些不應阻塞目前的程式開發。

## 下一階段已完成：Provider contract smoke test

在不需要 Jetson、Groq、Supabase 或任何真實憑證的前提下，新增 `npm run llm:contract`。測試會啟動一次性的本機 HTTP provider，重現 `/v1/models` 與 `/v1/chat/completions`，並驗證 Ollama-only、Bearer token、JSON mode、usage metadata、provider fallback、`Retry-After`/exponential retry 與 timeout。GitHub Actions 會在正式 collector 前執行這個 gate，將「程式契約失效」與「外部服務暫時不可用」分離。

這個階段的範圍仍不包含 Jetson 現場效能、GPU offload、功耗、溫度或 runner 到 Jetson 的實際網路測試；那些屬於設備整合階段。

## 本次完成：Confidence gate 與品質回歸門

在不需要外部 provider、Supabase 或 Jetson 的前提下，新增 `LLM_MIN_CONFIDENCE` typed configuration。預設值為 `0.65`；schema-valid 但低於門檻的模型輸出會被視為 enrichment failure，完整保留原 heuristic incident，不覆寫分類、severity、summary、confidence 或 model 欄位。

同時新增兩組 redacted golden fixtures 與一個低信心 downgrade case，透過 `npm run llm:quality` 驗證 JSON contract、欄位映射、tag synchronization 與降級行為。GitHub Actions 會在 collector 前先執行這個 deterministic gate，因此本階段不會因 Groq、Ollama、Supabase 或真實新聞內容不可用而變得不穩定。

本階段仍不宣稱模型分類的真實世界準確率；fixtures 是可重現的契約與回歸測試，不是 live provider benchmark。真正的 provider/Jetson 效能與品質評估仍需設備、模型 tag、網路與經核准的測試資料。

## 參考資料

[1]: https://console.groq.com/docs/deprecations "GroqDocs — Model Deprecation"
[2]: https://console.groq.com/docs/models "GroqDocs — Supported Models and Pricing"
[3]: https://ollama.com/pricing "Ollama — Pricing"
