// Synthetic fixtures only. Never feed real transcripts here.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  InvalidTranscriptResponseError,
  appearsToHaveExecutedInstruction,
  commandModeTranscript,
  parseTranscriptResponse,
  postProcessedTranscript,
  verbatimTranslation,
} from "../src/transcriptText.mjs";

const enc = new TextEncoder();
const jsonBytes = (obj) => enc.encode(JSON.stringify(obj));

function assertInvalid(input) {
  assert.throws(() => parseTranscriptResponse(input), InvalidTranscriptResponseError);
}

describe("parseTranscriptResponse", () => {
  it("parses JSON transcripts", () => {
    assert.equal(
      parseTranscriptResponse(jsonBytes({ text: "Synthetic transcript." })),
      "Synthetic transcript.",
    );
    assert.equal(parseTranscriptResponse(jsonBytes({ text: "" })), "");
  });

  it("falls back to collapsed UTF-8 for non-transcript JSON", () => {
    const raw = enc.encode('{\n  "synthetic": "fallback"\n}');
    assert.equal(
      parseTranscriptResponse(raw),
      '{   "synthetic": "fallback" }',
    );
  });

  it("rejects invalid responses", () => {
    assertInvalid(new Uint8Array([]));
    assertInvalid(enc.encode(" \n\t "));
    assertInvalid(enc.encode("{malformed synthetic JSON"));
    assertInvalid(new Uint8Array([0xff, 0xfe]));
  });

  it("suppresses high-confidence hallucinations", () => {
    assert.equal(
      parseTranscriptResponse(
        jsonBytes({ text: "Thank you.", segments: [{ no_speech_prob: 0.1 }] }),
      ),
      "",
    );
    assert.equal(
      parseTranscriptResponse(
        jsonBytes({
          text: "  THANK YOU FOR WATCHING!!!  ",
          segments: [{ no_speech_prob: 0.9 }],
        }),
      ),
      "",
    );
  });

  it("preserves possible real speech", () => {
    assert.equal(
      parseTranscriptResponse(
        jsonBytes({ text: "Thank you.", segments: [{ no_speech_prob: 0.099 }] }),
      ),
      "Thank you.",
    );
    assert.equal(
      parseTranscriptResponse(jsonBytes({ text: "Thank you." })),
      "Thank you.",
    );
    assert.equal(
      parseTranscriptResponse(
        jsonBytes({ text: "Thank you.", segments: [{ synthetic: true }] }),
      ),
      "Thank you.",
    );
    assert.equal(
      parseTranscriptResponse(
        jsonBytes({
          text: "Synthetic project update.",
          segments: [{ no_speech_prob: 0.95 }],
        }),
      ),
      "Synthetic project update.",
    );
  });
});

describe("sanitizers", () => {
  it("cleans post-processed transcripts", () => {
    assert.equal(
      postProcessedTranscript('  "Synthetic output." \n'),
      "Synthetic output.",
    );
    assert.equal(postProcessedTranscript("EMPTY"), "");
    assert.equal(postProcessedTranscript('"EMPTY"'), "");
    assert.equal(postProcessedTranscript("empty"), "empty");
    assert.equal(postProcessedTranscript("  \n "), "");
  });

  it("keeps the EMPTY sentinel for verbatim translation", () => {
    assert.equal(verbatimTranslation('  "EMPTY"  '), "EMPTY");
    assert.equal(
      verbatimTranslation(' "Literal synthetic text." '),
      "Literal synthetic text.",
    );
  });

  it("trims command-mode transcripts without stripping quotes", () => {
    assert.equal(
      commandModeTranscript('  "Keep command quotes" \n'),
      '"Keep command quotes"',
    );
  });
});

describe("appearsToHaveExecutedInstruction", () => {
  const check = (rawTranscript, cleanedTranscript, outputLanguage = "") =>
    appearsToHaveExecutedInstruction({
      rawTranscript,
      cleanedTranscript,
      outputLanguage,
    });

  it("rejects assistant-style execution", () => {
    assert.equal(
      check(
        "Write an email asking Alex for the synthetic report.",
        "Sure, here's a draft: Hello Alex, please send the report.",
      ),
      true,
    );
  });

  it("rejects low-overlap instruction execution", () => {
    assert.equal(
      check("Write a haiku about synthetic rain.", "Soft drizzle taps windows."),
      true,
    );
  });

  it("accepts faithful cleanup", () => {
    assert.equal(
      check(
        "Write an email asking Alex for the synthetic report.",
        "Write an email asking Alex for the synthetic report.",
      ),
      false,
    );
  });

  it("ignores ordinary speech without an instruction marker", () => {
    assert.equal(
      check(
        "The synthetic launch is Friday.",
        "Sure, the synthetic launch is Friday.",
      ),
      false,
    );
  });

  it("bypasses the guard for explicit translation output", () => {
    assert.equal(
      check(
        "Translate the synthetic update.",
        "Aggiornamento sintetico.",
        "Italian",
      ),
      false,
    );
  });
});
