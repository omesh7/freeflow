// Update-check core for the Windows companion.
//
// Port of the pure logic in Sources/UpdateManager.swift:
// SemanticVersion parsing/ordering plus release-candidate selection
// (latest semantic release, same-tag short-circuit, stability buffer).
// UI (alerts), downloading, DMG mounting and relaunch are platform code
// and intentionally not ported. UserDefaults state (skipped version,
// reminder dates) stays with the caller.
//
// DEFAULT_RELEASES_URL points at the omesh7/freeflow fork -- the same
// stream the macOS UpdateManager now polls. An empty release list (or a
// 404, surfaced by the caller) means "no update", mirroring Swift.

export const DEFAULT_RELEASES_URL =
  "https://api.github.com/repos/omesh7/freeflow/releases?per_page=100";

export const STABILITY_BUFFER_DAYS = 3;

function isDigitString(value) {
  return /^[+]?\d+$/.test(value);
}

/**
 * Parse "v1.2.3", "1.2.3-alpha.1", "1.2.3+build.5". Returns
 * {major, minor, patch, prerelease[]} or null when invalid.
 */
export function parseSemanticVersion(value) {
  let normalized = String(value ?? "").trim();
  if (normalized.startsWith("v") || normalized.startsWith("V")) {
    normalized = normalized.slice(1);
  }
  const withoutBuild = normalized.split("+", 1)[0] ?? normalized;
  const dashIndex = withoutBuild.indexOf("-");
  const core = dashIndex === -1 ? withoutBuild : withoutBuild.slice(0, dashIndex);
  const prereleaseRaw = dashIndex === -1 ? null : withoutBuild.slice(dashIndex + 1);
  const parts = core.split(".");
  if (parts.length !== 3 || !parts.every(isDigitString)) return null;
  const [major, minor, patch] = parts.map(Number);
  if (!Number.isSafeInteger(major) || !Number.isSafeInteger(minor) || !Number.isSafeInteger(patch)) {
    return null;
  }
  let prerelease = [];
  if (prereleaseRaw !== null) {
    if (prereleaseRaw === "") return null;
    prerelease = prereleaseRaw.split(".");
    if (prerelease.some((id) => id === "")) return null;
  }
  return { major, minor, patch, prerelease };
}

function compareIdentifiers(left, right) {
  if (left === right) return 0;
  const leftNum = /^\d+$/.test(left) ? Number(left) : null;
  const rightNum = /^\d+$/.test(right) ? Number(right) : null;
  if (leftNum !== null && rightNum !== null) return leftNum < rightNum ? -1 : 1;
  if (leftNum !== null) return -1;
  if (rightNum !== null) return 1;
  return left < right ? -1 : 1;
}

/** -1 | 0 | 1, mirroring SemanticVersion's Comparable + Equatable. */
export function compareSemanticVersions(a, b) {
  for (const key of ["major", "minor", "patch"]) {
    if (a[key] !== b[key]) return a[key] < b[key] ? -1 : 1;
  }
  if (a.prerelease.length === 0 && b.prerelease.length === 0) return 0;
  if (a.prerelease.length === 0) return 1;
  if (b.prerelease.length === 0) return -1;
  const count = Math.min(a.prerelease.length, b.prerelease.length);
  for (let i = 0; i < count; i++) {
    const order = compareIdentifiers(a.prerelease[i], b.prerelease[i]);
    if (order !== 0) return order;
  }
  if (a.prerelease.length === b.prerelease.length) return 0;
  return a.prerelease.length < b.prerelease.length ? -1 : 1;
}

export function normalizedVersionString(tagName) {
  return String(tagName ?? "")
    .trim()
    .replace(/^v/i, "");
}

function publishedTimeMs(publishedAt) {
  const ms = Date.parse(publishedAt);
  return Number.isNaN(ms) ? null : ms;
}

/**
 * Decide whether an update is available.
 *
 * releases: array of {tag_name, published_at} (only these fields are read).
 * Returns {update, reason, version?, tagName?} where reason is one of:
 * bad-current-version | no-releases | same-tag | up-to-date | too-new |
 * skipped | available
 */
export function checkForUpdates({
  currentVersionString,
  currentBuildTag = null,
  releases = [],
  skippedVersion = null,
  nowMs = Date.now(),
  stabilityBufferDays = STABILITY_BUFFER_DAYS,
}) {
  const current = parseSemanticVersion(currentVersionString);
  if (!current) return { update: false, reason: "bad-current-version" };

  const candidates = [];
  for (const release of releases) {
    const version = parseSemanticVersion(release?.tag_name);
    const publishedMs = publishedTimeMs(release?.published_at);
    if (!version || publishedMs === null) continue;
    candidates.push({ release, version, publishedMs });
  }
  candidates.sort((x, y) => {
    const order = compareSemanticVersions(x.version, y.version);
    if (order !== 0) return order;
    return x.publishedMs - y.publishedMs;
  });
  if (candidates.length === 0) return { update: false, reason: "no-releases" };

  const latest = candidates[candidates.length - 1];
  const versionString = normalizedVersionString(latest.release.tag_name);
  if (currentBuildTag && latest.release.tag_name === currentBuildTag) {
    return { update: false, reason: "same-tag" };
  }
  if (compareSemanticVersions(latest.version, current) <= 0) {
    return { update: false, reason: "up-to-date" };
  }
  const daysSincePublished =
    (nowMs - latest.publishedMs) / (24 * 60 * 60 * 1000);
  if (daysSincePublished < stabilityBufferDays) {
    return { update: false, reason: "too-new", version: versionString };
  }
  if (skippedVersion && skippedVersion === latest.release.tag_name) {
    return { update: false, reason: "skipped", version: versionString };
  }
  return {
    update: true,
    reason: "available",
    version: versionString,
    tagName: latest.release.tag_name,
  };
}
