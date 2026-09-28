// Portable port of Sources/ModelConfiguration.swift (FreeFlow, macOS).
//
// Pure data + pure functions. The config() table intentionally keeps the
// legacy entries (llama-*, allam-2-7b, orpheus, ...) exactly as Swift does:
// anything unlisted takes the generic fallback. See README.md "Parity notes".

export const LLM_MODELS = [
  "openai/gpt-oss-20b",
  "openai/gpt-oss-120b",
  "openai/gpt-oss-safeguard-20b",
  "qwen/qwen3.6-27b",
  "groq/compound",
  "groq/compound-mini",
];

// Models that accept image input. The context model must support vision for
// screenshot analysis to work.
export const VISION_MODELS = ["qwen/qwen3.6-27b"];

export const TRANSCRIPTION_MODELS = [
  "whisper-large-v3",
  "whisper-large-v3-turbo",
];

const GENERIC_FALLBACK = Object.freeze({
  maxCompletionTokens: null,
  reasoningEffort: null,
  includeReasoning: null,
  shouldStripThinkTags: false,
});

const CONFIG_TABLE = new Map(
  Object.entries({
    "openai/gpt-oss-20b": {
      maxCompletionTokens: 4096,
      reasoningEffort: "low",
      includeReasoning: false,
      shouldStripThinkTags: false,
    },
    "openai/gpt-oss-120b": { ...GENERIC_FALLBACK },
    "openai/gpt-oss-safeguard-20b": { ...GENERIC_FALLBACK },
    "qwen/qwen3-32b": { ...GENERIC_FALLBACK, shouldStripThinkTags: true },
    "qwen/qwen3.6-27b": {
      maxCompletionTokens: null,
      reasoningEffort: "none",
      includeReasoning: false,
      shouldStripThinkTags: true,
    },
    "llama-3.1-8b-instant": { ...GENERIC_FALLBACK },
    "llama-3.3-70b-versatile": { ...GENERIC_FALLBACK },
    "meta-llama/llama-4-scout-17b-16e-instruct": { ...GENERIC_FALLBACK },
    "meta-llama/llama-prompt-guard-2-22m": { ...GENERIC_FALLBACK },
    "meta-llama/llama-prompt-guard-2-86m": { ...GENERIC_FALLBACK },
    "allam-2-7b": { ...GENERIC_FALLBACK },
    "canopylabs/orpheus-arabic-saudi": { ...GENERIC_FALLBACK },
    "canopylabs/orpheus-v1-english": { ...GENERIC_FALLBACK },
    "groq/compound": { ...GENERIC_FALLBACK },
    "groq/compound-mini": { ...GENERIC_FALLBACK },
    "whisper-large-v3": { ...GENERIC_FALLBACK },
    "whisper-large-v3-turbo": { ...GENERIC_FALLBACK },
  }),
);

const PROVIDERLESS_ALIASES = new Map(
  Object.entries({
    "qwen3-32b": "qwen/qwen3-32b",
    "qwen3.6-27b": "qwen/qwen3.6-27b",
    "gpt-oss-20b": "openai/gpt-oss-20b",
    "gpt-oss-120b": "openai/gpt-oss-120b",
    "gpt-oss-safeguard-20b": "openai/gpt-oss-safeguard-20b",
  }),
);

export function normalizeModelId(model) {
  let clean = String(model ?? "").trim().toLowerCase();
  if (PROVIDERLESS_ALIASES.has(clean)) clean = PROVIDERLESS_ALIASES.get(clean);
  return clean;
}

export function configForModel(model) {
  const clean = normalizeModelId(model);
  return { ...(CONFIG_TABLE.get(clean) ?? GENERIC_FALLBACK) };
}

/**
 * Remove <think>...</think> reasoning blocks.
 *
 * Faithful to ModelConfiguration.stripThinkTags: only LEADING think blocks
 * (and a trailing unclosed one) are stripped. A <think> marker appearing
 * mid-output is preserved -- that is a known Swift-side limitation, kept
 * here for parity and covered by tests. Use stripAllThinkTags() when the
 * caller wants reasoning removed wherever it appears.
 */
export function stripThinkTags(text) {
  let cleaned = String(text ?? "");
  cleaned = cleaned.replace(/^(?:\s*<think>[\s\S]*?<\/think>)+/, "");
  cleaned = cleaned.replace(/^\s*<think>[\s\S]*$/, "");
  return cleaned.trim();
}

/** Improvement over stripThinkTags: removes every think block, anywhere. */
export function stripAllThinkTags(text) {
  let cleaned = String(text ?? "").replace(/<think>[\s\S]*?(?:<\/think>|$)/g, "");
  return cleaned.trim();
}
