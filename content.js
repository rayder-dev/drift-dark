// Drift-Dark: content script (runs in the page's own world, top frame only).
//
// Nothing secret lives here: the page can read this file. The browser injects it after the page has
// finished loading, so the flow is: decide from what the page looks like right now, apply at once with
// default settings, then ask background.js for the real ones and correct.
//
// Modes: "soft" (color-scheme: dark), "invert" (filter on <html>, media inverted back) and "auto"
// (soft first, invert when soft leaves the page light or unreadable).
var STYLE_ID = "drift-dark-style";
var MEDIA_ATTR = "data-drift-dark-media";
var INSTANCE_KEY = Symbol.for("drift-dark.instance");
var DARK_LUMA = 0.4; // a background darker than this counts as dark
var SOFT_CANVAS_LUMA = 0.07; // what the default canvas looks like under color-scheme: dark
var MODES = ["auto", "soft", "invert"];
var DEFAULTS = { enabled: true, mode: "auto", brightness: 100, contrast: 90, excluded: false };
var HTML_TYPES = ["text/html", "application/xhtml+xml", "text/plain"];
var HINT_KEY = "drift-dark-hint";
var FREEZE_CSS = "*,*::before,*::after{transition:none !important}";
var FREEZE_MS = 150;
var MIN_REFETCH_MS = 3000;
var OBSERVE_THROTTLE_MS = 250;
var MAX_EVALS_PER_10S = 20;
var SCAN_CHUNK = 300;
var SCAN_MAX = 6000;
var MEDIA_SELECTOR = 'img,video,canvas,iframe,embed,object,svg image,input[type="image"],[' + MEDIA_ATTR + "]";

// ---- pure functions (also exposed for the tests) ---------------------------------------------------

function parseColor(text) {
  if (typeof text !== "string") return null;
  var t = text.trim().toLowerCase();
  if (t === "transparent") return { r: 0, g: 0, b: 0, a: 0 };
  var m = /^rgba?\(\s*([\d.]+)\s*[, ]\s*([\d.]+)\s*[, ]\s*([\d.]+)\s*(?:[,/]\s*([\d.]+%?)\s*)?\)$/.exec(t);
  if (!m) return null;
  var a = 1;
  if (m[4] !== undefined) a = m[4].slice(-1) === "%" ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
  var c = { r: Number(m[1]), g: Number(m[2]), b: Number(m[3]), a: a };
  return isFinite(c.r + c.g + c.b + c.a) ? c : null;
}

function lumaOf(c) {
  return (0.299 * c.r + 0.587 * c.g + 0.114 * c.b) / 255;
}

// A color-scheme value ("light dark", "only dark", "normal") that renders dark. "light dark" follows
// the browser's preference, so it is dark only when the preference is.
function schemeIsDark(value, prefersDark) {
  var tokens = String(value || "").toLowerCase().split(/\s+/).filter(function (x) { return x && x !== "only"; });
  var dark = tokens.indexOf("dark") !== -1;
  var light = tokens.indexOf("light") !== -1;
  if (!dark) return false;
  return light ? prefersDark === true : true;
}

function median(values) {
  if (!values.length) return null;
  var s = values.slice().sort(function (a, b) { return a - b; });
  var mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

// info: { metaSchemes: string[], computedScheme: string, prefersDark: bool, bgLuma: number|null }
function decide(info) {
  var metas = info.metaSchemes || [];
  for (var i = 0; i < metas.length; i++) {
    if (schemeIsDark(metas[i], info.prefersDark)) return { dark: true, reason: "meta" };
  }
  if (schemeIsDark(info.computedScheme, info.prefersDark)) return { dark: true, reason: "computed" };
  if (typeof info.bgLuma === "number" && info.bgLuma < DARK_LUMA) return { dark: true, reason: "background" };
  return { dark: false, reason: "light" };
}

function clampInt(value, min, max, fallback) {
  var n = Math.round(Number(value));
  return isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

function sanitizeSettings(raw) {
  var r = raw && typeof raw === "object" ? raw : {};
  return {
    enabled: r.enabled !== false,
    mode: MODES.indexOf(r.mode) !== -1 ? r.mode : DEFAULTS.mode,
    brightness: clampInt(r.brightness, 80, 110, DEFAULTS.brightness),
    contrast: clampInt(r.contrast, 80, 110, DEFAULTS.contrast),
    excluded: r.excluded === true,
  };
}

function softCss() {
  return ":root{color-scheme:dark !important}";
}

// The filter sits on <html>, not <body>: a filter on <body> makes it the containing block of every
// position:fixed element, so they scroll away with the page. On <html> they stay put.
// Media get the same invert + hue-rotate(180deg) again, which undoes it exactly. Anything inside a
// restored element is left alone, or it would be flipped a third time.
function invertCss(brightness, contrast, needsHtmlBg) {
  var flip = "invert(1) hue-rotate(180deg)";
  var css =
    "html{filter:" + flip + " brightness(" + brightness / 100 + ") contrast(" + contrast / 100 + ") !important;" +
    "scrollbar-color:#6b6b6b #1e1e1e}" +
    MEDIA_SELECTOR + "{filter:" + flip + " !important}" +
    ":is(" + MEDIA_SELECTOR + ") :is(" + MEDIA_SELECTOR + "){filter:none !important}";
  if (needsHtmlBg) css += "html{background-color:#fff !important}";
  return css;
}

// ---- the page ------------------------------------------------------------------------------------

var expose = driftPlugin && driftPlugin.__expose;
if (typeof expose === "function") {
  expose({ parseColor: parseColor, lumaOf: lumaOf, schemeIsDark: schemeIsDark, decide: decide, sanitizeSettings: sanitizeSettings, softCss: softCss, invertCss: invertCss, median: median });
}

var doc = typeof document !== "undefined" ? document : null;
if (doc && doc.documentElement && HTML_TYPES.indexOf(String(doc.contentType || "text/html")) !== -1) {
  start();
}

function start() {
  // Put into the same page twice: the earlier copy stops and removes what it added.
  var previous = doc[INSTANCE_KEY];
  if (previous && typeof previous.dispose === "function") {
    try { previous.dispose(); } catch (e) { /* the old copy is gone either way */ }
  }

  var state = {
    settings: sanitizeSettings(DEFAULTS),
    css: "",
    applied: null, // "soft" | "invert" | null
    styleEl: null,
    sheet: null,
    observer: null,
    timer: 0,
    lastFetch: 0,
    fetching: false,
    evalTimes: [],
    scanned: typeof WeakSet === "function" ? new WeakSet() : null,
    scanTimer: 0,
    freezeTimer: 0,
    disposed: false,
  };

  // What the last visit to this site learned: "off" when the theme was not applied. Read at once, before the answer
  // from background.js, so a site that is excluded is not painted dark for the length of a round trip.
  var hint = readHint();
  if (hint === "off") state.settings.excluded = true;

  function readHint() {
    try {
      return window.localStorage.getItem(HINT_KEY);
    } catch (e) {
      return null;
    }
  }

  function writeHint(value) {
    if (value === hint) return;
    hint = value;
    try {
      window.localStorage.setItem(HINT_KEY, value);
    } catch (e) { /* storage may be blocked: the hint is only a convenience */ }
  }

  function guard(fn) {
    return function () {
      try {
        return fn.apply(this, arguments);
      } catch (e) {
        /* never break the site */
      }
    };
  }

  // -- the style: one <style id>, plus a constructable sheet when the page's CSP refuses inline styles --

  // The same css again touches nothing. A change is written with the page's transitions switched off for a moment:
  // a site with `transition: all` would otherwise fade the filter in, and pictures would flash negative on the way.
  function writeCss(css) {
    if (css === state.css && (!css || (state.styleEl && state.styleEl.isConnected))) return;
    state.css = css;
    clearTimeout(state.freezeTimer);
    render(css ? css + FREEZE_CSS : "");
    if (css) {
      state.freezeTimer = setTimeout(guard(function () { render(state.css); }), FREEZE_MS);
    }
  }

  function render(text) {
    var el = doc.getElementById(STYLE_ID);
    if (!text) {
      if (el) el.remove();
      state.styleEl = null;
      dropSheet();
      return;
    }
    if (!el) {
      el = doc.createElement("style");
      el.id = STYLE_ID;
      (doc.head || doc.documentElement).appendChild(el);
    }
    if (el.textContent !== text) el.textContent = text;
    state.styleEl = el;
    // A page whose CSP forbids inline styles ends up with an empty sheet: a constructable sheet is not subject to it.
    var blocked = !el.sheet || el.sheet.cssRules.length === 0;
    if (blocked) useSheet(text);
    else dropSheet();
  }

  function useSheet(css) {
    if (typeof CSSStyleSheet !== "function" || !("adoptedStyleSheets" in doc)) return;
    if (!state.sheet) state.sheet = new CSSStyleSheet();
    state.sheet.replaceSync(css);
    if (doc.adoptedStyleSheets.indexOf(state.sheet) === -1) doc.adoptedStyleSheets = doc.adoptedStyleSheets.concat([state.sheet]);
  }

  function dropSheet() {
    if (!state.sheet) return;
    try {
      doc.adoptedStyleSheets = doc.adoptedStyleSheets.filter(function (s) { return s !== state.sheet; });
    } catch (e) { /* nothing to drop */ }
    state.sheet = null;
  }

  // Runs `fn` with our style switched off, so the page is measured as the site made it. The sheet is only disabled
  // for the length of the call (same task, no paint in between); the <style> node itself is never removed and re-added.
  function withoutStyle(fn) {
    if (!state.css) return fn();
    var sheets = [];
    if (state.styleEl && state.styleEl.sheet) sheets.push(state.styleEl.sheet);
    if (state.sheet) sheets.push(state.sheet);
    var was = sheets.map(function (s) { return s.disabled; });
    sheets.forEach(function (s) { s.disabled = true; });
    try {
      return fn();
    } finally {
      sheets.forEach(function (s, i) { s.disabled = was[i]; });
    }
  }

  // -- looking at the page ------------------------------------------------------------------------

  function styleOf(el) {
    return doc.defaultView.getComputedStyle(el);
  }

  // Background and text color under a point: the first opaque background going up the tree.
  // Images and gradients make the answer unknown (null), not light.
  function sampleAt(el, canvasLuma) {
    var fg = null;
    for (var n = el; n && n.nodeType === 1; n = n.parentElement) {
      var cs = styleOf(n);
      if (fg === null) {
        var f = parseColor(cs.color);
        if (f) fg = lumaOf(f);
      }
      var bg = parseColor(cs.backgroundColor);
      if (bg && bg.a >= 0.9) return { bg: lumaOf(bg), fg: fg };
      if (cs.backgroundImage && cs.backgroundImage !== "none") return null;
    }
    return { bg: canvasLuma, fg: fg };
  }

  function samples(canvasLuma) {
    var out = [];
    var view = doc.defaultView;
    var w = view.innerWidth;
    var h = view.innerHeight;
    // Walking up from <body> reaches <html> anyway; a separate <html> sample would count the same canvas twice.
    var els = [doc.body || doc.documentElement];
    if (typeof doc.elementFromPoint === "function" && w > 0 && h > 0) {
      var pts = [[0.5, 0.5], [0.15, 0.5], [0.85, 0.5], [0.5, 0.15], [0.5, 0.85], [0.5, 0.95], [0.5, 0.02]];
      for (var i = 0; i < pts.length; i++) els.push(doc.elementFromPoint(Math.floor(w * pts[i][0]), Math.floor(h * pts[i][1])));
    }
    for (var j = 0; j < els.length; j++) {
      if (!els[j]) continue;
      var s = sampleAt(els[j], canvasLuma);
      if (s) out.push(s);
    }
    return out;
  }

  function probe() {
    var root = doc.documentElement;
    var view = doc.defaultView;
    var metas = [];
    var nodes = doc.querySelectorAll('meta[name="color-scheme" i]');
    for (var i = 0; i < nodes.length; i++) metas.push(nodes[i].getAttribute("content") || "");
    var rootBg = parseColor(styleOf(root).backgroundColor);
    var bodyBg = doc.body ? parseColor(styleOf(doc.body).backgroundColor) : null;
    var found = samples(1).map(function (s) { return s.bg; });
    return {
      metaSchemes: metas,
      computedScheme: styleOf(root).colorScheme || "",
      prefersDark: !!(view.matchMedia && view.matchMedia("(prefers-color-scheme: dark)").matches),
      bgLuma: median(found),
      needsHtmlBg: (!rootBg || rootBg.a < 0.1) && (!bodyBg || bodyBg.a < 0.1),
    };
  }

  // With color-scheme: dark in place: is the page dark and its text light?
  function softIsEnough() {
    var found = samples(SOFT_CANVAS_LUMA);
    var bgs = found.map(function (s) { return s.bg; });
    var fgs = found.map(function (s) { return s.fg; }).filter(function (x) { return x !== null; });
    var bg = median(bgs);
    var fg = median(fgs);
    // Not one light spot: a white header the page paints itself is exactly what soft cannot fix.
    var lightSpots = bgs.filter(function (x) { return x >= DARK_LUMA; }).length;
    return bg !== null && fg !== null && lightSpots === 0 && fg - bg > 0.35;
  }

  // -- deciding -----------------------------------------------------------------------------------

  function apply(kind, needsHtmlBg) {
    var s = state.settings;
    if (kind === "soft") writeCss(softCss());
    else if (kind === "invert") writeCss(invertCss(s.brightness, s.contrast, needsHtmlBg));
    else writeCss("");
    state.applied = kind;
    if (kind === "invert") scanBackgrounds();
  }

  function evaluate() {
    if (state.disposed) return;
    var s = state.settings;
    if (!s.enabled || s.excluded) return apply(null);
    var info = withoutStyle(probe);
    if (decide(info).dark) return apply(null);
    if (s.mode === "soft") return apply("soft");
    if (s.mode === "invert") return apply("invert", info.needsHtmlBg);
    apply("soft");
    if (!softIsEnough()) apply("invert", info.needsHtmlBg);
  }

  // Looking again costs a style recalculation; a page that keeps flipping its own classes is looked at a few times, then left.
  function reevaluate() {
    state.timer = 0;
    var now = Date.now();
    state.evalTimes = state.evalTimes.filter(function (t) { return now - t < 10000; });
    if (state.evalTimes.length >= MAX_EVALS_PER_10S) {
      stopObserving();
      return;
    }
    state.evalTimes.push(now);
    evaluate();
  }

  function scheduleReevaluate() {
    if (state.timer || state.disposed) return;
    state.timer = setTimeout(guard(reevaluate), OBSERVE_THROTTLE_MS);
  }

  function startObserving() {
    if (typeof MutationObserver !== "function") return;
    state.observer = new MutationObserver(guard(function () { scheduleReevaluate(); }));
    var opts = { attributes: true, attributeFilter: ["class", "style", "data-theme", "data-bs-theme", "data-color-mode", "data-mode"] };
    state.observer.observe(doc.documentElement, opts);
    if (doc.body) state.observer.observe(doc.body, opts);
  }

  function stopObserving() {
    if (state.observer) state.observer.disconnect();
    state.observer = null;
  }

  // -- pictures set as backgrounds are turned back too (a CSS selector cannot see a stylesheet's background-image) --

  function scanBackgrounds() {
    if (state.scanTimer || !state.scanned || state.applied !== "invert") return;
    var all = doc.body ? doc.body.querySelectorAll("*") : [];
    var limit = Math.min(all.length, SCAN_MAX);
    var i = 0;
    var view = doc.defaultView;
    function chunk() {
      state.scanTimer = 0;
      if (state.disposed || state.applied !== "invert") return;
      var end = Math.min(limit, i + SCAN_CHUNK);
      for (; i < end; i++) {
        var el = all[i];
        if (state.scanned.has(el)) continue;
        state.scanned.add(el);
        var image = styleOf(el).backgroundImage;
        if (!image || image.indexOf("url(") === -1 || image.indexOf("data:image/svg") !== -1) continue;
        var box = el.getBoundingClientRect();
        // Photo-sized only: icons and sprites look right inverted, and a page-sized wrapper would undo the whole page.
        if (box.width < 100 || box.height < 60) continue;
        if (box.width * box.height > 0.7 * view.innerWidth * view.innerHeight) continue;
        el.setAttribute(MEDIA_ATTR, "");
      }
      if (i < limit) state.scanTimer = (view.requestIdleCallback || setTimeout).call(view, guard(chunk), 50);
    }
    // The first slice is done now, so the photos near the top are not seen negative for a moment.
    guard(chunk)();
  }

  // -- settings from background.js ----------------------------------------------------------------

  function refresh() {
    if (state.fetching || state.disposed) return;
    if (Date.now() - state.lastFetch < MIN_REFETCH_MS) return;
    state.fetching = true;
    state.lastFetch = Date.now();
    var asked;
    try {
      asked = driftPlugin.runtime.sendMessage({ type: "get", host: location.hostname });
    } catch (e) {
      state.fetching = false;
      return;
    }
    Promise.resolve(asked).then(
      guard(function (reply) {
        state.fetching = false;
        if (state.disposed || !reply || typeof reply !== "object") return;
        var next = sanitizeSettings(reply);
        writeHint(!next.enabled || next.excluded ? "off" : "on");
        // Back in front with nothing changed: leave the page as it is.
        if (JSON.stringify(next) === JSON.stringify(state.settings) && state.answered) return;
        state.answered = true;
        state.settings = next;
        evaluate();
      }),
      function () { state.fetching = false; }
    );
  }

  // A tab put back in front reads the settings again, so a change made in the settings page shows up when you return.
  var onVisible = guard(function () {
    if (doc.visibilityState === "visible") refresh();
  });
  var onShow = guard(function () { refresh(); });

  state.dispose = function () {
    state.disposed = true;
    stopObserving();
    clearTimeout(state.timer);
    clearTimeout(state.freezeTimer);
    doc.removeEventListener("visibilitychange", onVisible);
    doc.defaultView.removeEventListener("pageshow", onShow);
    doc.defaultView.removeEventListener("focus", onShow);
    writeCss("");
    var marked = doc.querySelectorAll("[" + MEDIA_ATTR + "]");
    for (var i = 0; i < marked.length; i++) marked[i].removeAttribute(MEDIA_ATTR);
  };
  try {
    Object.defineProperty(doc, INSTANCE_KEY, { value: state, configurable: true, writable: true, enumerable: false });
  } catch (e) { /* the copy still works, it just cannot be replaced cleanly */ }

  // Dark by default until background.js answers, so a light page does not stay light for the length of a round trip.
  guard(evaluate)();
  guard(startObserving)();
  doc.addEventListener("visibilitychange", onVisible);
  doc.defaultView.addEventListener("pageshow", onShow);
  doc.defaultView.addEventListener("focus", onShow);
  guard(refresh)();
}
