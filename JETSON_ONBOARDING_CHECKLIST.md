# Jetson EAC-6000 接入檢查清單

這份清單把必須在 EAC-6000 現場完成的工作集中到最小範圍；在設備尚未登入前，其餘 TIE 軟體可以獨立開發與測試。

## A. 現場盤點

| 項目 | 要記錄的值 | 目的 |
| --- | --- | --- |
| 型號 | `EAC-6000-R16-S128` | 確認實際 SKU |
| CPU/架構 | `uname -m` | 確認 ARM64 |
| JetPack/L4T | `sudo apt-cache policy nvidia-jetpack` 或既有版本指令 | 決定 CUDA/容器相容性 |
| Ubuntu/L4T | `cat /etc/os-release` | 確認安裝方式 |
| 儲存空間 | `df -h` | 確認模型與日誌空間 |
| 記憶體 | `free -h` | 確認 16GB 使用狀態 |
| GPU 狀態 | `tegrastats` | 觀察推理時 RAM/GPU/溫度 |
| 網路 | 私有 IP、VPN IP、DNS | 設計 GitHub runner 到 Jetson 的路徑 |

## B. 本機 Ollama 驗證

先在 Jetson 本機確認服務，不要一開始就從 GitHub Actions 排錯：

```bash
curl -fsS http://127.0.0.1:11434/api/version
ollama list
ollama pull llama3.1:8b
curl -fsS http://127.0.0.1:11434/v1/models
```

確認 `/v1/models` 的回應中包含實際使用的 model tag。如果使用量化或自訂 Modelfile，請把實際 tag 設為 `OLLAMA_MODEL`，不必強行使用 `llama3.1:8b`。

## C. TIE smoke test

在 TIE 專案中先只設定本機 endpoint：

```bash
export LLM_PROVIDER=ollama
export OLLAMA_URL=http://127.0.0.1:11434
export OLLAMA_MODEL=llama3.1:8b
npm run llm:check
```

成功條件是 JSON 輸出中的 `reachable` 為 `true`，且 `modelAvailable` 為 `true` 或 `null`。這個命令只做 `/v1/models` health check，不會送出新聞內容。

接著再執行一次單筆或小批次 pipeline 測試，觀察：

| 指標 | 期望 |
| --- | --- |
| provider | `ollama` |
| model | 與 `/v1/models` 回應一致 |
| severity/summary/confidence | 可通過 runtime validation |
| latency | 需記錄平均值，不要求與 Groq 相同 |
| fallback | Ollama 失敗時 incident 保留 heuristic 結果 |
| 溫度/記憶體 | 長時間運行不應持續觸發 thermal throttling 或 OOM |

## D. 私有網路與安全

GitHub-hosted runner 通常不能直接連入 Jetson 的 `192.168.x.x` 位址。選擇一個私有路徑，例如 Tailscale 或 WireGuard，然後從 runner 所在環境測試：

```bash
curl -fsS http://<private-jetson-address>:11434/v1/models
```

若使用 plain HTTP，必須限制在 localhost 或私有 VPN 介面。若 endpoint 需要 gateway authentication，設定 `OLLAMA_API_KEY`，並把它放在 GitHub Actions secret；不要把 Ollama 的 11434 port 直接暴露在公網。

## E. GitHub Actions 設定

| 類別 | 名稱 | 內容 |
| --- | --- | --- |
| Secret | `GROQ_API_KEY` | 已輪替的新 Groq key；主要 provider |
| Secret | `OLLAMA_URL` | 只有在 GitHub runner 可達 Jetson 時設定 |
| Secret | `OLLAMA_API_KEY` | 只有在 gateway 要求 Bearer token 時設定 |
| Variable | `LLM_PROVIDER` | 預設 `auto`；只測 Jetson 時可設 `ollama` |
| Variable | `GROQ_MODEL` | 預設 `openai/gpt-oss-20b` |
| Variable | `OLLAMA_MODEL` | Jetson 實際可用的 model tag |

完成設定後，先手動執行 workflow。確認 health check、provider/model、token/latency aggregate 與資料寫入都成功，再恢復每日排程。
