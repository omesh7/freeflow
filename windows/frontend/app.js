// Spike-1 frontend: plain ES modules, no build step, no dependencies.
// Transcription + update logic is the tested companion core (see lib/).
import {
  DEFAULT_CLOUD_BASE_URL,
  DEFAULT_CLOUD_MODEL,
  transcribeWithCloud,
  transcribeWithLocalServer,
} from "./lib/transcriptionProviders.mjs";
import {
  DEFAULT_RELEASES_URL,
  checkForUpdates,
} from "./lib/updateCheck.mjs";

const APP_VERSION = "0.1.0";

const $ = (id) => document.getElementById(id);

async function readFileBytes(file) {
  return new Uint8Array(await file.arrayBuffer());
}

async function runTranscription({ local }) {
  const out = $("transcribeOut");
  const key = $("apiKey").value;
  const file = $("audioFile").files[0];
  if (!file) {
    out.textContent = "Pick an audio file first.";
    return;
  }
  out.textContent = "Working…";
  const started = performance.now();
  try {
    let text;
    if (local) {
      text = await transcribeWithLocalServer({
        filename: file.name,
        fileBytes: await readFileBytes(file),
      });
    } else {
      if (!key.trim()) {
        out.textContent = "Enter your API key (kept in memory only).";
        return;
      }
      text = await transcribeWithCloud({
        baseURL: $("baseUrl").value.trim() || DEFAULT_CLOUD_BASE_URL,
        apiKey: key,
        model: $("model").value.trim() || DEFAULT_CLOUD_MODEL,
        filename: file.name,
        fileBytes: await readFileBytes(file),
      });
    }
    const ms = Math.round(performance.now() - started);
    out.textContent = `OK in ${ms}ms (${text.length} chars):\n${text}`;
  } catch (err) {
    out.textContent = `FAILED: ${err instanceof Error ? err.message : String(err)}`;
  }
}

$("cloudBtn").addEventListener("click", () => runTranscription({ local: false }));
$("localBtn").addEventListener("click", () => runTranscription({ local: true }));

$("feedUrl").textContent = `Stream: ${DEFAULT_RELEASES_URL}`;

$("updateBtn").addEventListener("click", async () => {
  const out = $("updateOut");
  out.textContent = "Checking…";
  try {
    const response = await fetch(DEFAULT_RELEASES_URL, {
      headers: { Accept: "application/vnd.github+json" },
    });
    if (response.status === 404) {
      out.textContent = "No releases published on the fork yet — you are up to date.";
      return;
    }
    if (!response.ok) {
      out.textContent = `GitHub returned HTTP ${response.status}.`;
      return;
    }
    const releases = await response.json();
    const decision = checkForUpdates({
      currentVersionString: APP_VERSION,
      releases,
      nowMs: Date.now(),
    });
    out.textContent =
      `Current: ${APP_VERSION}\n` +
      `Decision: update=${decision.update} reason=${decision.reason}` +
      (decision.version ? ` latest=${decision.version}` : "");
  } catch (err) {
    out.textContent = `FAILED: ${err instanceof Error ? err.message : String(err)}`;
  }
});
