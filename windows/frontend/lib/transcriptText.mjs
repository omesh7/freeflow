// Portable port of Sources/TranscriptTextCore.swift (FreeFlow, macOS).
//
// Pure functions only: no I/O, no network, no secrets. Faithful to the Swift
// original, including its documented quirks (see README.md "Parity notes").
//
// All fixtures in tests are synthetic; never feed real transcripts here.

export class InvalidTranscriptResponseError extends Error {
  constructor(message = "Invalid transcript response") {
    super(message);
    this.name = "InvalidTranscriptResponseError";
  }
}

// Whisper stock phrases emitted for silence / background noise. Only treated
// as hallucinations when segment metadata independently reports a high
// probability of no speech, which protects genuine short dictations.
export const HALLUCINATION_PHRASES = new Set([
  "thank you",
  "thank you for watching",
  "thank you very much",
  "thank you so much",
  "thanks for watching",
  "please subscribe",
  "like and subscribe",
  "subtitles by",
  "subtitles by the amara.org community",
  "you",
]);

// Tuned conservatively against roughly 500 quiet, noisy, and real-speech
// samples to minimize filtering genuine short dictations.
export const HALLUCINATION_NO_SPEECH_THRESHOLD = 0.1;

function normalizeForHallucinationCheck(text) {
  return String(text)
    .toLowerCase()
    .replace(/^[\p{P}\s]+|[\p{P}\s]+$/gu, "");
}

function isHallucination(text, json) {
  const normalized = normalizeForHallucinationCheck(text);
  if (!HALLUCINATION_PHRASES.has(normalized)) return false;
  const segments = json?.segments;
  if (!Array.isArray(segments)) return false;
  const noSpeechProb = segments[0]?.no_speech_prob;
  if (typeof noSpeechProb !== "number") return false;
  return noSpeechProb >= HALLUCINATION_NO_SPEECH_THRESHOLD;
}

function collapsePlainText(value) {
  const collapsed = String(value)
    .split(/\r\n|[\n\v\f\r\u0085\u2028\u2029]/)
    .join(" ")
    .trim();
  if (!collapsed) throw new InvalidTranscriptResponseError();
  return collapsed;
}

/**
 * Parse a transcription provider response.
 *
 * Accepts raw response bytes (Uint8Array), a UTF-8 string, or an
 * already-parsed JSON value. Mirrors TranscriptionResponseParser.parse:
 * JSON is attempted first (malformed JSON throws); a top-level object with
 * a string "text" field is the transcript path; anything else that parsed
 * falls back to the raw text collapsed onto one line.
 */
export function parseTranscriptResponse(input) {
  if (input instanceof Uint8Array) {
    let text;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(input);
    } catch {
      throw new InvalidTranscriptResponseError();
    }
    return parseTranscriptResponse(text);
  }
  if (typeof input === "string") {
    let parsed;
    try {
      parsed = JSON.parse(input);
    } catch {
      throw new InvalidTranscriptResponseError();
    }
    if (
      parsed !== null &&
      typeof parsed === "object" &&
      !Array.isArray(parsed) &&
      typeof parsed.text === "string"
    ) {
      return isHallucination(parsed.text, parsed) ? "" : parsed.text;
    }
    return collapsePlainText(input);
  }
  if (input !== null && typeof input === "object" && !Array.isArray(input)) {
    if (typeof input.text === "string") {
      return isHallucination(input.text, input) ? "" : input.text;
    }
    return collapsePlainText(JSON.stringify(input));
  }
  throw new InvalidTranscriptResponseError();
}

function stripSurroundingQuotes(value) {
  let result = String(value).trim();
  if (result.length > 1 && result.startsWith('"') && result.endsWith('"')) {
    result = result.slice(1, -1).trim();
  }
  return result;
}

// Verbatim translation deliberately preserves the cleanup prompt's EMPTY
// sentinel because "empty" can be legitimate translated speech here.
export function verbatimTranslation(value) {
  return stripSurroundingQuotes(value ?? "");
}

export function postProcessedTranscript(value) {
  const result = stripSurroundingQuotes(value ?? "");
  if (result === "EMPTY") return "";
  return result;
}

export function commandModeTranscript(value) {
  return String(value ?? "").trim();
}

const INSTRUCTION_MARKERS = new Set([
  "ask", "answer", "compose", "create", "draft", "email", "generate", "make",
  "message", "prompt", "reply", "respond", "response", "summarize", "tell",
  "translate", "write", "claude", "chatgpt", "ai", "llm",
]);

const STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "but", "by", "can", "could",
  "for", "from", "had", "has", "have", "he", "her", "him", "his", "i", "if",
  "in", "into", "is", "it", "its", "just", "me", "my", "of", "on", "or", "our",
  "please", "she", "so", "that", "the", "their", "them", "then", "there", "this",
  "to", "um", "uh", "was", "we", "were", "what", "when", "where", "who", "with",
  "would", "you", "your",
]);

const ASSISTANT_PREAMBLE_PATTERN =
  /^\s*(sure|certainly|absolutely|here(?:'s| is)|i(?:'d| would) be happy to|i can)\b/i;

function significantTokens(text) {
  const tokens = new Set();
  for (const part of String(text ?? "")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)) {
    if (part.length > 1 && !STOP_WORDS.has(part)) tokens.add(part);
  }
  return tokens;
}

export function appearsToHaveExecutedInstruction({
  rawTranscript,
  cleanedTranscript,
  outputLanguage,
}) {
  if (String(outputLanguage ?? "").trim() !== "") return false;
  const rawTokens = significantTokens(rawTranscript);
  const cleanedTokens = significantTokens(cleanedTranscript);
  if (rawTokens.size === 0 || cleanedTokens.size === 0) return false;

  const rawMarkers = new Set(
    [...rawTokens].filter((token) => INSTRUCTION_MARKERS.has(token)),
  );
  if (rawMarkers.size === 0) return false;

  const preservedMarkers = new Set(
    [...rawMarkers].filter((token) => cleanedTokens.has(token)),
  );
  const overlap = new Set(
    [...rawTokens].filter((token) => cleanedTokens.has(token)),
  );
  const overlapRatio = overlap.size / Math.max(rawTokens.size, 1);
  const cleanedHasAssistantPreamble = ASSISTANT_PREAMBLE_PATTERN.test(
    String(cleanedTranscript ?? ""),
  );
  const rawHasSamePreamble = ASSISTANT_PREAMBLE_PATTERN.test(
    String(rawTranscript ?? ""),
  );

  return (
    (cleanedHasAssistantPreamble && !rawHasSamePreamble) ||
    (preservedMarkers.size === 0 && overlapRatio < 0.35)
  );
}
