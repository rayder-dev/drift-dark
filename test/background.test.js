const test = require("node:test");
const assert = require("node:assert");
const { load, plain } = require("./load");

const b = load("background.js");

test("normalizeHost takes hosts, urls and wildcards", () => {
  assert.strictEqual(b.normalizeHost("https://www.Example.com/a?b=1"), "www.example.com");
  assert.strictEqual(b.normalizeHost("Example.com."), "example.com");
  assert.strictEqual(b.normalizeHost("*.example.com"), "example.com");
  assert.strictEqual(b.normalizeHost("localhost"), "localhost");
});

test("normalizeHost refuses what is not a site", () => {
  assert.strictEqual(b.normalizeHost("com"), null); // would cover every .com
  assert.strictEqual(b.normalizeHost(""), null);
  assert.strictEqual(b.normalizeHost("ftp://example.com"), null);
  assert.strictEqual(b.normalizeHost("exa mple.com"), null);
  assert.strictEqual(b.normalizeHost(42), null);
});

test("a rule covers its subdomains, not look-alikes", () => {
  const list = ["example.com"];
  assert.strictEqual(b.isExcluded(list, "example.com"), true);
  assert.strictEqual(b.isExcluded(list, "www.example.com"), true);
  assert.strictEqual(b.isExcluded(list, "notexample.com"), false);
  assert.strictEqual(b.isExcluded(list, "example.com.evil.org"), false);
});

test("toggleHost adds, and lifts every covering rule", () => {
  const added = b.toggleHost([], "a.example.com");
  assert.deepStrictEqual(plain(added.list), ["a.example.com"]);
  assert.strictEqual(added.excluded, true);
  const lifted = b.toggleHost(["example.com", "other.org"], "a.example.com");
  assert.deepStrictEqual(plain(lifted.list), ["other.org"]);
  assert.strictEqual(lifted.excluded, false);
});

test("removeHost drops covering rules only", () => {
  assert.deepStrictEqual(plain(b.removeHost(["example.com", "x.org"], "www.example.com")), ["x.org"]);
});

test("overrideFor: the longest covering rule wins", () => {
  const o = { "example.com": "soft", "docs.example.com": "invert" };
  assert.strictEqual(b.overrideFor(o, "docs.example.com"), "invert");
  assert.strictEqual(b.overrideFor(o, "a.docs.example.com"), "invert");
  assert.strictEqual(b.overrideFor(o, "www.example.com"), "soft");
  assert.strictEqual(b.overrideFor(o, "other.org"), null);
});

test("hostOff reads the list as skip or as only", () => {
  assert.strictEqual(b.hostOff({ siteMode: "except", excluded: ["a.com"] }, "a.com"), true);
  assert.strictEqual(b.hostOff({ siteMode: "except", excluded: ["a.com"] }, "b.com"), false);
  assert.strictEqual(b.hostOff({ siteMode: "only", excluded: ["a.com"] }, "a.com"), false);
  assert.strictEqual(b.hostOff({ siteMode: "only", excluded: ["a.com"] }, "b.com"), true);
});

test("inNight handles a window across midnight", () => {
  assert.strictEqual(b.inNight(23, 20, 7), true);
  assert.strictEqual(b.inNight(3, 20, 7), true);
  assert.strictEqual(b.inNight(12, 20, 7), false);
  assert.strictEqual(b.inNight(7, 20, 7), false);
  assert.strictEqual(b.inNight(12, 9, 17), true);
  assert.strictEqual(b.inNight(18, 9, 17), false);
  assert.strictEqual(b.inNight(5, 8, 8), true);
});

test("sanitize gives defaults for nothing and clamps the rest", () => {
  assert.deepStrictEqual(plain(b.sanitize(null)), {
    enabled: true,
    mode: "auto",
    brightness: 100,
    contrast: 90,
    excluded: [],
    siteMode: "except",
    schedule: "always",
    nightFrom: 20,
    nightTo: 7,
    overrides: {},
  });
  const s = b.sanitize({
    enabled: false,
    mode: "nonsense",
    brightness: 500,
    contrast: -5,
    excluded: ["A.com", "a.com", "com", 7],
    siteMode: "only",
    schedule: "night",
    nightFrom: 99,
    overrides: { "x.org": "soft", "y.org": "bogus", com: "soft" },
  });
  assert.strictEqual(s.enabled, false);
  assert.strictEqual(s.mode, "auto");
  assert.strictEqual(s.brightness, 110);
  assert.strictEqual(s.contrast, 80);
  assert.deepStrictEqual(plain(s.excluded), ["a.com"]);
  assert.strictEqual(s.siteMode, "only");
  assert.strictEqual(s.schedule, "night");
  assert.strictEqual(s.nightFrom, 23);
  assert.deepStrictEqual(plain(s.overrides), { "x.org": "soft" });
});
