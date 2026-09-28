import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  LLM_MODELS,
  TRANSCRIPTION_MODELS,
  VISION_MODELS,
  configForModel,
  stripAllThinkTags,
  stripThinkTags,
} from "../src/modelConfig.mjs";

function assertSameConfig(alias, canonical) {
  assert.deepEqual(configForModel(alias), configForModel(canonical));
}

describe("providerless aliases", () => {
  it("resolve to the canonical model config", () => {
    assertSameConfig(" GPT-OSS-20B ", "openai/gpt-oss-20b");
    assertSameConfig("gpt-oss-120b", "openai/gpt-oss-120b");
    assertSameConfig("gpt-oss-safeguard-20b", "openai/gpt-oss-safeguard-20b");
    assertSameConfig("qwen3-32b", "qwen/qwen3-32b");
    assertSameConfig(" QWEN3.6-27B ", "qwen/qwen3.6-27b");
  });
});

describe("known model settings", () => {
  it("stay stable", () => {
    assert.deepEqual(configForModel("openai/gpt-oss-20b"), {
      maxCompletionTokens: 4096,
      reasoningEffort: "low",
      includeReasoning: false,
      shouldStripThinkTags: false,
    });
    assert.deepEqual(configForModel("qwen/qwen3.6-27b"), {
      maxCompletionTokens: null,
      reasoningEffort: "none",
      includeReasoning: false,
      shouldStripThinkTags: true,
    });
    assert.deepEqual(configForModel("example/unknown-model"), {
      maxCompletionTokens: null,
      reasoningEffort: null,
      includeReasoning: null,
      shouldStripThinkTags: false,
    });
  });
});

describe("model lists", () => {
  it("are consistent", () => {
    assert.equal(new Set(LLM_MODELS).size, LLM_MODELS.length);
    assert.equal(new Set(VISION_MODELS).size, VISION_MODELS.length);
    assert.equal(
      new Set(TRANSCRIPTION_MODELS).size,
      TRANSCRIPTION_MODELS.length,
    );
    for (const model of VISION_MODELS) {
      assert.ok(
        LLM_MODELS.includes(model),
        `Every vision model must also be selectable as an LLM: ${model}`,
      );
    }
  });
});

describe("stripThinkTags (Swift parity)", () => {
  it("strips leading think blocks", () => {
    assert.equal(
      stripThinkTags("<think>hidden</think> Visible output"),
      "Visible output",
    );
    assert.equal(
      stripThinkTags("<think>one</think>\n<think>two</think>\nResult"),
      "Result",
    );
  });

  it("handles truncated reasoning", () => {
    assert.equal(stripThinkTags("<think>unfinished"), "");
  });

  it("preserves mid-output markers (known Swift limitation, kept for parity)", () => {
    assert.equal(
      stripThinkTags("Ordinary output with a later <think> marker"),
      "Ordinary output with a later <think> marker",
    );
  });
});

describe("stripAllThinkTags (improvement)", () => {
  it("removes reasoning wherever it appears", () => {
    assert.equal(
      stripAllThinkTags("Answer <think>hidden reasoning</think> continues"),
      "Answer  continues",
    );
    assert.equal(stripAllThinkTags("<think>unfinished"), "");
    assert.equal(stripAllThinkTags("Plain output"), "Plain output");
  });
});
