# Local AI for Atlas HCM — Ollama + optional LM Studio / Jan / AnythingLLM

Research (2026):
- https://machinelearningmastery.com/ollama-vs-lm-studio-vs-llama-cpp-which-local-ai-runtime-should-you-use-in-2026/
- https://lmstudio.ai/docs/developer/openai-compat
- AnythingLLM OpenAI endpoints: `http://localhost:3001/api/v1/openai/*` (Bearer API key; `model` = workspace slug)

Your PC (~16GB RAM, Intel Iris Xe): keep 1.5B–3B instruct models.

## Roles (why Ollama stays primary)

| Tool | What it is | Atlas use |
|------|------------|-----------|
| **Ollama** | Model runner (daemon) | **Primary** for AI Insights |
| **LM Studio / Jan** | GUI + OpenAI server | Optional fallback |
| **AnythingLLM** | Docs RAG workspace **on top of** a runner | Optional OpenAI-compat path |
| **llama.cpp** | Engine under many GUIs | Not needed raw |

AnythingLLM does **not** replace Ollama as the model engine — it usually still calls Ollama/LM Studio underneath. You *can* point Atlas at AnythingLLM’s OpenAI API when you want RAG over uploaded docs.

## Verify

```powershell
cd "C:\HCM Airfare"
$env:PYTHONPATH="C:\HCM Airfare\src"
.\.venv\Scripts\python.exe scripts\verify_local_ai.py
```

## .env — primary (recommended)

```
AIRFARE_AI_LLM_PROVIDER=auto
AIRFARE_AI_OLLAMA_ENABLED=true
AIRFARE_AI_OLLAMA_BASE_URL=http://127.0.0.1:11434
AIRFARE_AI_OLLAMA_MODEL=qwen2.5:3b-instruct
```

## Optional — LM Studio / Jan

```
AIRFARE_AI_OPENAI_COMPAT_ENABLED=true
AIRFARE_AI_OPENAI_COMPAT_BASE_URL=http://127.0.0.1:1234
AIRFARE_AI_OPENAI_COMPAT_MODEL=<model id>
AIRFARE_AI_OPENAI_COMPAT_API_KEY=local
```

Jan uses `http://127.0.0.1:1337`.

## Optional — AnythingLLM (docs RAG via API)

1. Install/start AnythingLLM (default UI/API port **3001**).
2. Point its LLM provider at **Ollama** (or LM Studio).
3. Create a workspace, upload docs, note the **workspace slug**.
4. Settings → API Keys → create a key.
5. `.env`:

```
AIRFARE_AI_OPENAI_COMPAT_ENABLED=true
AIRFARE_AI_OPENAI_COMPAT_BASE_URL=http://127.0.0.1:3001/api/v1/openai
AIRFARE_AI_OPENAI_COMPAT_MODEL=<workspace-slug>
AIRFARE_AI_OPENAI_COMPAT_API_KEY=<anythingllm-api-key>
# Force this path (else auto still prefers Ollama when online):
AIRFARE_AI_LLM_PROVIDER=anythingllm
```

List workspace “models”: `GET http://127.0.0.1:3001/api/v1/openai/models` with `Authorization: Bearer <key>`.
