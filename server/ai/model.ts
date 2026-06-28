import { createDeepSeek } from "@ai-sdk/deepseek";
import { createAnthropic } from "@ai-sdk/anthropic";
import type { LanguageModel } from "ai";

export function resolveModelId(provider: string): {
  provider: "deepseek" | "anthropic";
  modelId: string;
} {
  if (provider === "deepseek") return { provider: "deepseek", modelId: "deepseek-chat" };
  if (provider === "anthropic") return { provider: "anthropic", modelId: "claude-sonnet-4-6" };
  throw new Error(`unknown LLM provider: ${provider}`);
}

export function makeModel(env: Record<string, string | undefined> = process.env): LanguageModel {
  const { provider, modelId } = resolveModelId(env.LLM_PROVIDER ?? "deepseek");
  if (provider === "deepseek") {
    return createDeepSeek({ apiKey: env.DEEPSEEK_API_KEY ?? "" })(modelId);
  }
  return createAnthropic({ apiKey: env.ANTHROPIC_API_KEY ?? "" })(modelId);
}
