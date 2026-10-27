const test = require("node:test");
const assert = require("node:assert");
const { load, plain } = require("./load");

const c = load("content.js");
const b = load("background.js");

test("parseColor reads rgb, rgba, slash alpha and transparent", () => {
  assert.deepStrictEqual(plain(c.parseColor("rgb(255, 0, 10)")), { r: 255, g: 0, b: 10, a: 1 });
  assert.strictEqual(c.parseColor("rgba(0, 0, 0, 0.5)").a, 0.5);
  assert.strictEqual(c.parseColor("rgb(0 0 0 / 50%)").a, 0.5);
  assert.strictEqual(c.parseColor("transparent").a, 0);
  assert.strictEqual(c.parseColor("red"), null);
  assert.strictEqual(c.parseColor(null), null);
});

test("schemeIsDark: 'light dark' follows the preference", () => {
  assert.strictEqual(c.schemeIsDark("dark", false), true);
  assert.strictEqual(c.schemeIsDark("only dark", false), true);
  assert.strictEqual(c.schemeIsDark("light dark", false), false);
  assert.strictEqual(c.schemeIsDark("light dark", true), true);
  assert.strictEqual(c.schemeIsDark("normal", true), false);
});

test("decide: meta, computed scheme and background each win", () => {
  const base = { metaSchemes: [], computedScheme: "normal", prefersDark: false, bgLuma: 0.9 };
  assert.strictEqual(c.decide(base).dark, false);
  assert.strictEqual(c.decide({ ...base, metaSchemes: ["dark"] }).reason, "meta");
  assert.strictEqual(c.decide({ ...base, computedScheme: "dark" }).reason, "computed");
  assert.strictEqual(c.decide({ ...base, bgLuma: 0.1 }).reason, "background");
  assert.strictEqual(c.decide({ ...base, metaSchemes: ["light dark"] }).dark, false);
});

test("pageLuma: a dark header over a white page is a light page", () => {
  assert.strictEqual(c.pageLuma(0.9, [0.1, 0.9, 0.1]), 0.9);
  assert.strictEqual(c.pageLuma(0.9, [0.1, 0.1, 0.1]), 0.1);
  assert.strictEqual(c.pageLuma(0.1, [0.9, 0.9, 0.9]), 0.1);
  assert.strictEqual(c.pageLuma(null, []), null);
});

test("invertCss puts the filter on <html> and turns media back", () => {
  const css = c.invertCss(100, 90, true);
  assert.match(css, /^html\{filter:invert\(1\) hue-rotate\(180deg\) brightness\(1\) contrast\(0\.9\) !important/);
  assert.ok(css.includes(c.mediaCss()));
  assert.match(css, /html\{background-color:#fff !important\}/);
  assert.doesNotMatch(c.invertCss(100, 90, false), /background-color/);
});

test("mediaCss turns media back once, not twice", () => {
  const css = c.mediaCss();
  assert.match(css, /img,video/);
  assert.match(css, /filter:none !important/);
});

test("sanitizeSettings keeps the flags the background sends", () => {
  assert.strictEqual(c.sanitizeSettings({ system: true }).system, true);
  assert.strictEqual(c.sanitizeSettings({}).system, false);
  assert.strictEqual(c.sanitizeSettings({ excluded: true }).excluded, true);
});

// content.js and background.js each carry a copy of the sanitising rules (a content script cannot import):
// they must agree on the fields they share.
test("both copies of the settings rules agree", () => {
  const samples = [
    null,
    {},
    { enabled: false, mode: "soft", brightness: 85, contrast: 105 },
    { mode: "x", brightness: "abc", contrast: 1e9 },
    { brightness: 79.6, contrast: 110.4 },
  ];
  for (const raw of samples) {
    const fromBackground = b.sanitize(raw);
    const fromContent = c.sanitizeSettings(raw);
    for (const key of ["enabled", "mode", "brightness", "contrast"]) {
      assert.strictEqual(fromContent[key], fromBackground[key], key + " for " + JSON.stringify(raw));
    }
  }
});
