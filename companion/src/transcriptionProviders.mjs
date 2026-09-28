// Transcription provider layer for the Windows companion.
//
// Covers both legs the project needs:
//   - cloud: any OpenAI-compatible /audio/transcriptions endpoint
//     (Groq default, but baseURL/model are free -- support stays broad)
//   - local: a localhost OpenAI-compatible server (e.g. whisper.cpp server
//     or any sidecar exposing POST {baseURL}/audio/transcriptions)
//
// Pure helpers (URL normalization, multipart building, filename sanitizing,
// HTTP error mapping) are runtime-agnostic (Node 18+, browser, Tauri) and
// fully unit-tested with a mocked fetch. No live network in tests, no
// secrets in logs: error strings carry the host only, never the API key.
//
// Ports the relevant logic of Sources/TranscriptionService.swift, with two
// deliberate fixes (see README.md "Parity notes"):
//   1. multipart filenames are sanitized (Swift interpolates them raw);
//   2. whole-file Data(contentsOf:) buffering is the caller's choice --
//      transcribe*() accepts Uint8Array, so streaming/chunked readers can
//      feed it without a second copy held by this module.

import { parseTranscriptResponse } from "./transcriptText.mjs";

export const DEFAULT_CLOUD_BASE_URL = "https://api.groq.com/openai/v1";
export const DEFAULT_CLOUD_MODEL = "whisper-large-v3";
export const DEFAULT_LOCAL_BASE_URL = "http://127.0.0.1:8080/v1";
export const DEFAULT_LOCAL_MODEL = "whisper-1";
export const DEFAULT_TIMEOUT_MS = 20_000;

const VERBOSE_JSON_MODELS = new Set([
  // OpenAI's Whisper model supports segment metadata. The newer
  // gpt-4o-transcribe family only supports the plain JSON format.
  "whisper-1",
  // Groq's hosted Whisper models support verbose_json and expose the
  // segment metadata used by the hallucination filter.
  "whisper-large-v3",
  "whisper-large-v3-turbo",
]);

export function responseFormatForModel(model) {
  const normalized = String(model ?? "").trim().toLowerCase();
  return VERBOSE_JSON_MODELS.has(normalized) ? "verbose_json" : "json";
}

export function normalizeBaseURL(raw) {
  const trimmed = String(raw ?? "").trim();
  if (!trimmed) throw new Error("Provider URL is empty.");
  let url;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error("Provider URL is malformed.");
  }
  const scheme = url.protocol.replace(/:$/, "").toLowerCase();
  if (scheme !== "http" && scheme !== "https") {
    throw new Error("Provider URL must use http or https.");
  }
  if (!url.hostname) throw new Error("Provider URL must include a host.");
  let path = url.pathname;
  if (path === "/") path = "";
  else path = path.replace(/\/+$/, "");
  return `${scheme}://${url.host}${path}${url.search}`;
}

export function hostOfBaseURL(normalizedBaseURL) {
  try {
    return new URL(normalizedBaseURL).host;
  } catch {
    return "the provider";
  }
}

// Map a non-200 HTTP status into a one-line user-readable message, mirroring
// TranscriptionService.friendlyHTTPMessage. Host only, never credentials.
export function friendlyHTTPMessage(status, host) {
  const provider = host ?? "the provider";
  switch (status) {
    case 401:
      return `Invalid API key for ${provider}. Open Settings to fix it.`;
    case 403:
      return `Key lacks permission for this endpoint at ${provider} (HTTP 403). Check the key's scopes.`;
    case 404:
      return `Endpoint not found at ${provider} (HTTP 404). Base URL is likely wrong for this provider.`;
    case 413:
      return `Audio file too large for ${provider} (HTTP 413). Try a shorter recording.`;
    case 400:
      return "Provider rejected the request (HTTP 400). Check your model name and Base URL in Settings.";
    case 429:
      return `Rate limit reached at ${provider} (HTTP 429). Wait a moment and try again.`;
    default:
      if (status >= 500 && status < 600) {
        return `Provider error at ${provider} (HTTP ${status}). Try again in a moment.`;
      }
      return `Request failed at ${provider} (HTTP ${status}).`;
  }
}

function stripControlChars(value) {
  let out = "";
  for (const ch of String(value)) {
    const code = ch.charCodeAt(0);
    if (code >= 32 && code !== 127) out += ch;
  }
  return out;
}

/**
 * Sanitize a filename for a multipart Content-Disposition header.
 * FIX vs Swift: TranscriptionService.makeMultipartBody interpolates the raw
 * lastPathComponent, so a `"` / CR / LF in the name breaks the header.
 * This takes the basename and drops `"`, CR, LF and other control chars.
 */
export function sanitizeMultipartFilename(name) {
  const base = String(name ?? "").split(/[\\/]/).pop() ?? "";
  const clean = stripControlChars(base.replace(/["\r\n]/g, "")).trim();
  return clean || "audio.wav";
}

export function audioContentTypeForFilename(fileName) {
  const lower = String(fileName ?? "").toLowerCase();
  if (lower.endsWith(".wav")) return "audio/wav";
  if (lower.endsWith(".mp3")) return "audio/mpeg";
  if (lower.endsWith(".m4a")) return "audio/mp4";
  return "audio/mp4";
}

export function buildMultipartBody({
  model,
  responseFormat,
  language,
  filename,
  fileBytes,
  boundary,
}) {
  if (!boundary) throw new Error("boundary is required.");
  const bytes =
    fileBytes instanceof Uint8Array ? fileBytes : Uint8Array.from(fileBytes ?? []);
  const safeName = sanitizeMultipartFilename(filename);
  const enc = new TextEncoder();
  const chunks = [];
  const field = (fieldName, value) => {
    chunks.push(
      enc.encode(
        `--${boundary}\r\nContent-Disposition: form-data; name="${fieldName}"\r\n\r\n${value}\r\n`,
      ),
    );
  };
  field("model", model);
  field("response_format", responseFormat);
  if (typeof language === "string" && language.trim() !== "") {
    field("language", language);
  }
  chunks.push(
    enc.encode(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${safeName}"\r\n` +
        `Content-Type: ${audioContentTypeForFilename(safeName)}\r\n\r\n`,
    ),
  );
  chunks.push(bytes);
  chunks.push(enc.encode(`\r\n--${boundary}--\r\n`));
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.length;
  }
  return { body, filename: safeName };
}

function randomBoundary() {
  const rand = Math.random().toString(36).slice(2, 10);
  return `----freeflow-${Date.now().toString(36)}-${rand}`;
}

async function postTranscription({
  endpoint,
  headers,
  body,
  fetchFn,
  timeoutMs,
}) {
  const fetchImpl = fetchFn ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    throw new Error("No fetch implementation available.");
  }
  const response = await fetchImpl(endpoint, {
    method: "POST",
    headers,
    body,
    signal: AbortSignal.timeout(timeoutMs),
  });
  const respBytes = new Uint8Array(await response.arrayBuffer());
  if (!response.ok && response.status !== 200) {
    throw new Error(
      friendlyHTTPMessage(response.status, hostOfBaseURL(endpoint)),
    );
  }
  return parseTranscriptResponse(respBytes);
}

/**
 * Cloud transcription against any OpenAI-compatible endpoint.
 * apiKey is sent as a Bearer header and never appears in error strings.
 */
export async function transcribeWithCloud({
  baseURL = DEFAULT_CLOUD_BASE_URL,
  apiKey,
  model = DEFAULT_CLOUD_MODEL,
  language,
  filename = "audio.m4a",
  fileBytes,
  fetchFn,
  timeoutMs = DEFAULT_TIMEOUT_MS,
}) {
  const key = String(apiKey ?? "").trim();
  if (!key) throw new Error("API key is empty.");
  const normalizedBase = normalizeBaseURL(baseURL);
  const trimmedModel = String(model ?? "").trim() || DEFAULT_CLOUD_MODEL;
  const boundary = randomBoundary();
  const { body } = buildMultipartBody({
    model: trimmedModel,
    responseFormat: responseFormatForModel(trimmedModel),
    language,
    filename,
    fileBytes,
    boundary,
  });
  return postTranscription({
    endpoint: `${normalizedBase}/audio/transcriptions`,
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": `multipart/form-data; boundary=${boundary}`,
    },
    body,
    fetchFn,
    timeoutMs,
  });
}

/**
 * Local transcription against a localhost OpenAI-compatible server
 * (whisper.cpp --server or equivalent sidecar). No API key; same
 * response parsing pipeline as cloud, so local/cloud stay consistent.
 */
export async function transcribeWithLocalServer({
  baseURL = DEFAULT_LOCAL_BASE_URL,
  model = DEFAULT_LOCAL_MODEL,
  language,
  filename = "audio.wav",
  fileBytes,
  fetchFn,
  timeoutMs = DEFAULT_TIMEOUT_MS,
}) {
  const normalizedBase = normalizeBaseURL(baseURL);
  const trimmedModel = String(model ?? "").trim() || DEFAULT_LOCAL_MODEL;
  const boundary = randomBoundary();
  const { body } = buildMultipartBody({
    model: trimmedModel,
    responseFormat: "json",
    language,
    filename,
    fileBytes,
    boundary,
  });
  return postTranscription({
    endpoint: `${normalizedBase}/audio/transcriptions`,
    headers: {
      "Content-Type": `multipart/form-data; boundary=${boundary}`,
    },
    body,
    fetchFn,
    timeoutMs,
  });
}
