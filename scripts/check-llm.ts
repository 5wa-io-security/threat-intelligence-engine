import { getLLMConfigWarnings, isLLMConfigured, loadLLMConfig } from '../src/llm/config.js';
import { LLMClient } from '../src/llm/llm-client.js';

async function main(): Promise<void> {
  const config = loadLLMConfig();

  for (const warning of getLLMConfigWarnings(config)) {
    console.warn(`Warning: ${warning}`);
  }

  if (!isLLMConfigured(config)) {
    console.error('No valid LLM provider is configured. Set GROQ_API_KEY or OLLAMA_URL.');
    process.exitCode = 1;
    return;
  }

  const health = await new LLMClient().checkHealth();
  console.log(
    JSON.stringify(
      {
        providerMode: config.providerMode,
        groqModel: config.groqModel,
        ollamaModel: config.ollamaModel,
        health,
      },
      null,
      2
    )
  );

  const usableProvider = health.some(
    (item) => item.reachable && item.modelAvailable !== false
  );
  if (!usableProvider) {
    console.error('No configured LLM provider is reachable with the requested model.');
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
