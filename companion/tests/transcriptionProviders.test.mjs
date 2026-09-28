// Synthetic fixtures only. fetch is always mocked; no live network, no keys.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  audioContentTypeForFilename,
  buildMultipartBody,
  friendlyHTTPMessage,
  normalizeBaseURL,
  responseFormatForModel,
  sanitizeMultipartFilename,
  transcribeWithCloud,
  transcribeWithLocalServer,
} from "../src/transcriptionProviders.mjs";

const enc = new TextEncoder();
const dec = new TextDecoder("latin1");

function mockFetch({ status = 200, body = { text: "Synthetic transcript." } } = {}) {
  const calls = [];
  const fetchFn = async (url, opts) => {
    calls.push({ url, opts });
    return {
      ok: status >= 200 && status < 300,
      status,
      arrayBuffer: async () =>
        enc.encode(typeof body === "string" ? body : JSON.stringify(body)).buffer,
    };
  };
  return { fetchFn, calls };
}

describe("responseFormatForModel", () => {
  it("selects verbose_json for segment-capable models", () => {
    assert.equal(responseFormatForModel("whisper-large-v3"), "verbose_json");
    assert.equal(responseFormatForModel(" Whisper-Large-V3-Turbo "), "verbose_json");
    assert.equal(responseFormatForModel("whisper-1"), "verbose_json");
  });

  it("falls back to json otherwise", () => {
    assert.equal(responseFormatForModel("gpt-4o-transcribe"), "json");
    assert.equal(responseFormatForModel(""), "json");
  });
});

describe("normalizeBaseURL", () => {
  it("accepts valid provider URLs and trims slashes", () => {
    assert.equal(
      normalizeBaseURL("https://api.groq.com/openai/v1"),
      "https://api.groq.com/openai/v1",
    );
    assert.equal(
      normalizeBaseURL("  https://api.groq.com/openai/v1/// "),
      "https://api.groq.com/openai/v1",
    );
    assert.equal(normalizeBaseURL("http://127.0.0.1:8080/v1"), "http://127.0.0.1:8080/v1");
  });

  it("rejects bad URLs with the Swift error messages", () => {
    assert.throws(() => normalizeBaseURL(""), /Provider URL is empty/);
    assert.throws(() => normalizeBaseURL("not a url"), /malformed/);
    assert.throws(() => normalizeBaseURL("ftp://example.com/v1"), /http or https/);
  });
});

describe("friendlyHTTPMessage", () => {
  it("maps statuses to one-line messages", () => {
    assert.match(friendlyHTTPMessage(401, "api.example.com"), /Invalid API key/);
    assert.match(friendlyHTTPMessage(404, "api.example.com"), /Base URL/);
    assert.match(friendlyHTTPMessage(429, "api.example.com"), /Rate limit/);
    assert.match(friendlyHTTPMessage(500, "api.example.com"), /Provider error/);
    assert.match(friendlyHTTPMessage(418, "api.example.com"), /HTTP 418/);
  });
});

describe("sanitizeMultipartFilename (fix vs Swift)", () => {
  it("neutralizes header injection", () => {
    assert.equal(sanitizeMultipartFilename('rec"oding.wav'), "recoding.wav");
    assert.equal(sanitizeMultipartFilename("a\r\nb.wav"), "ab.wav");
  });

  it("strips directory components", () => {
    assert.equal(sanitizeMultipartFilename("../evil.wav"), "evil.wav");
    assert.equal(sanitizeMultipartFilename("C:\\temp\\a.wav"), "a.wav");
  });

  it("keeps benign names and falls back when empty", () => {
    assert.equal(sanitizeMultipartFilename("my rec.wav"), "my rec.wav");
    assert.equal(sanitizeMultipartFilename(""), "audio.wav");
    assert.equal(sanitizeMultipartFilename('"""'), "audio.wav");
  });
});

describe("audioContentTypeForFilename", () => {
  it("mirrors the Swift mapping", () => {
    assert.equal(audioContentTypeForFilename("a.WAV"), "audio/wav");
    assert.equal(audioContentTypeForFilename("a.mp3"), "audio/mpeg");
    assert.equal(audioContentTypeForFilename("a.m4a"), "audio/mp4");
    assert.equal(audioContentTypeForFilename("a.ogg"), "audio/mp4");
  });
});

describe("buildMultipartBody", () => {
  it("emits a binary-safe body with the sanitized filename", () => {
    const fileBytes = new Uint8Array([0, 1, 2, 250, 255, 0]);
    const { body, filename } = buildMultipartBody({
      model: "whisper-large-v3",
      responseFormat: "verbose_json",
      language: undefined,
      filename: 'x"y.wav',
      fileBytes,
      boundary: "testboundary",
    });
    assert.equal(filename, "xy.wav");
    const text = dec.decode(body);
    assert.ok(text.includes('filename="xy.wav"'));
    assert.ok(!text.includes('filename="x"y.wav"'));
    assert.ok(text.includes("Content-Type: audio/wav"));
    assert.ok(text.includes('name="model"'));
    assert.ok(text.includes("whisper-large-v3"));
    assert.ok(text.endsWith("--testboundary--\r\n"));
    // Raw audio bytes survive verbatim inside the body.
    assert.ok(body.includes(250));
  });

  it("includes the language field only when set", () => {
    const withLang = dec.decode(
      buildMultipartBody({
        model: "m",
        responseFormat: "json",
        language: "hi",
        filename: "a.wav",
        fileBytes: new Uint8Array([1]),
        boundary: "b",
      }).body,
    );
    assert.ok(withLang.includes('name="language"'));
    const withoutLang = dec.decode(
      buildMultipartBody({
        model: "m",
        responseFormat: "json",
        language: "  ",
        filename: "a.wav",
        fileBytes: new Uint8Array([1]),
        boundary: "b",
      }).body,
    );
    assert.ok(!withoutLang.includes('name="language"'));
  });
});

describe("transcribeWithCloud (mocked fetch)", () => {
  it("posts multipart with auth and returns the transcript", async () => {
    const { fetchFn, calls } = mockFetch();
    const text = await transcribeWithCloud({
      baseURL: "https://api.example.com/openai/v1/",
      apiKey: "synthetic-key",
      model: "whisper-large-v3",
      fileBytes: new Uint8Array([1, 2, 3]),
      filename: "note.m4a",
      fetchFn,
      timeoutMs: 5000,
    });
    assert.equal(text, "Synthetic transcript.");
    assert.equal(calls.length, 1);
    assert.equal(
      calls[0].url,
      "https://api.example.com/openai/v1/audio/transcriptions",
    );
    assert.equal(calls[0].opts.headers.Authorization, "Bearer synthetic-key");
    assert.match(calls[0].opts.headers["Content-Type"], /multipart\/form-data; boundary=/);
    const sent = dec.decode(calls[0].opts.body);
    assert.ok(sent.includes('name="response_format"'));
    assert.ok(sent.includes("verbose_json"));
  });

  it("maps HTTP errors to host-only messages without leaking the key", async () => {
    const { fetchFn } = mockFetch({ status: 401, body: "unauthorized" });
    await assert.rejects(
      transcribeWithCloud({
        apiKey: "super-secret-synthetic-key",
        fileBytes: new Uint8Array([1]),
        fetchFn,
      }),
      (err) => {
        assert.match(err.message, /Invalid API key for api\.groq\.com/);
        assert.ok(!err.message.includes("super-secret-synthetic-key"));
        return true;
      },
    );
  });

  it("refuses an empty API key without touching the network", async () => {
    const { fetchFn, calls } = mockFetch();
    await assert.rejects(
      transcribeWithCloud({ apiKey: "  ", fileBytes: new Uint8Array([1]), fetchFn }),
      /API key is empty/,
    );
    assert.equal(calls.length, 0);
  });
});

describe("transcribeWithLocalServer (mocked fetch)", () => {
  it("posts without auth to the local endpoint", async () => {
    const { fetchFn, calls } = mockFetch();
    const text = await transcribeWithLocalServer({
      baseURL: "http://127.0.0.1:8080/v1",
      fileBytes: new Uint8Array([9, 9]),
      filename: "note.wav",
      fetchFn,
    });
    assert.equal(text, "Synthetic transcript.");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "http://127.0.0.1:8080/v1/audio/transcriptions");
    assert.ok(!("Authorization" in calls[0].opts.headers));
  });
});
