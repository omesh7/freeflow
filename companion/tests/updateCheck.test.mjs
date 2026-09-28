// Synthetic fixtures only. No network: releases are inline objects.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  checkForUpdates,
  compareSemanticVersions,
  normalizedVersionString,
  parseSemanticVersion,
} from "../src/updateCheck.mjs";

const v = (value) => {
  const parsed = parseSemanticVersion(value);
  assert.ok(parsed, `Expected valid semantic version: ${value}`);
  return parsed;
};

describe("parseSemanticVersion", () => {
  it("orders core versions numerically", () => {
    assert.equal(compareSemanticVersions(v("1.2.3"), v("1.2.4")), -1);
    assert.equal(compareSemanticVersions(v("1.2.9"), v("1.3.0")), -1);
    assert.equal(compareSemanticVersions(v("1.9.9"), v("2.0.0")), -1);
  });

  it("handles prefixes and build metadata", () => {
    assert.deepEqual(v(" v1.2.3 "), v("V1.2.3"));
    assert.deepEqual(v("1.2.3+build.1"), v("1.2.3+build.2"));
    assert.equal(compareSemanticVersions(v("1.2.3-alpha"), v("1.2.3")), -1);
    assert.equal(compareSemanticVersions(v("1.2.3-1"), v("1.2.3-alpha")), -1);
    assert.equal(
      compareSemanticVersions(v("1.2.3-alpha"), v("1.2.3-alpha.1")),
      -1,
    );
  });

  it("follows the semver prerelease chain", () => {
    const ordered = [
      "1.0.0-alpha",
      "1.0.0-alpha.1",
      "1.0.0-alpha.beta",
      "1.0.0-beta",
      "1.0.0-beta.2",
      "1.0.0-beta.11",
      "1.0.0-rc.1",
      "1.0.0",
    ].map(v);
    for (let i = 0; i < ordered.length - 1; i++) {
      assert.equal(compareSemanticVersions(ordered[i], ordered[i + 1]), -1);
    }
  });

  it("rejects invalid versions", () => {
    for (const bad of ["", "1.2", "1.2.3.4", "one.2.3", "1.2.3-", "1.2.3-alpha..1"]) {
      assert.equal(parseSemanticVersion(bad), null, `reject: ${bad}`);
    }
  });

  it("normalizes tag names", () => {
    assert.equal(normalizedVersionString("  v1.2.3 "), "1.2.3");
    assert.equal(normalizedVersionString("V2.0.0"), "2.0.0");
  });
});

describe("checkForUpdates", () => {
  const DAY = 24 * 60 * 60 * 1000;
  const NOW = Date.parse("2026-09-28T00:00:00Z");
  const rel = (tag, daysAgo) => ({
    tag_name: tag,
    published_at: new Date(NOW - daysAgo * DAY).toISOString(),
  });

  it("offers a newer stable release past the buffer", () => {
    const decision = checkForUpdates({
      currentVersionString: "1.2.0",
      releases: [rel("v1.2.0", 30), rel("v1.3.0", 10)],
      nowMs: NOW,
    });
    assert.deepEqual(decision, {
      update: true,
      reason: "available",
      version: "1.3.0",
      tagName: "v1.3.0",
    });
  });

  it("stays quiet when up to date or on the same tag", () => {
    assert.equal(
      checkForUpdates({ currentVersionString: "1.3.0", releases: [rel("v1.3.0", 10)], nowMs: NOW }).reason,
      "up-to-date",
    );
    assert.equal(
      checkForUpdates({
        currentVersionString: "0.0.0",
        currentBuildTag: "v1.3.0",
        releases: [rel("v1.3.0", 10)],
        nowMs: NOW,
      }).reason,
      "same-tag",
    );
  });

  it("holds back releases inside the stability buffer", () => {
    const decision = checkForUpdates({
      currentVersionString: "1.3.0",
      releases: [rel("v1.3.0", 30), rel("v1.4.0", 1)],
      nowMs: NOW,
    });
    assert.equal(decision.update, false);
    assert.equal(decision.reason, "too-new");
  });

  it("handles empty lists, bad versions and skipped tags", () => {
    assert.equal(
      checkForUpdates({ currentVersionString: "1.0.0", releases: [], nowMs: NOW }).reason,
      "no-releases",
    );
    assert.equal(
      checkForUpdates({ currentVersionString: "nope", releases: [rel("v1.0.0", 9)], nowMs: NOW }).reason,
      "bad-current-version",
    );
    assert.equal(
      checkForUpdates({
        currentVersionString: "1.0.0",
        releases: [rel("v1.1.0", 9)],
        skippedVersion: "v1.1.0",
        nowMs: NOW,
      }).reason,
      "skipped",
    );
  });

  it("ignores non-semantic and undated entries", () => {
    const decision = checkForUpdates({
      currentVersionString: "1.0.0",
      releases: [
        { tag_name: "nightly", published_at: new Date(NOW - 9 * DAY).toISOString() },
        { tag_name: "v1.1.0", published_at: "not-a-date" },
        rel("v1.0.1", 9),
      ],
      nowMs: NOW,
    });
    assert.equal(decision.update, true);
    assert.equal(decision.tagName, "v1.0.1");
  });
});
