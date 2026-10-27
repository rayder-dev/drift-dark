// Drift-Dark: the plugin's background page.
//
// The one writer of the plugin's data. content.js asks it for the settings that apply to a host; the
// settings page (page.html) reads and changes them through messages.
//
// Storage key (driftPlugin.storage):
//   settings  { enabled: boolean, mode: "auto" | "soft" | "invert",
//               brightness: 80..110, contrast: 80..110, excluded: [host, ...],
//               siteMode: "except" | "only"   (the list is sites to skip, or the only sites to darken),
//               schedule: "always" | "system" | "night", nightFrom: 0..23, nightTo: 0..23,
//               overrides: { host: mode } }
//             a host in `excluded` or `overrides` covers its subdomains too
(function () {
  var MODES = ["auto", "soft", "invert"];
  var MAX_EXCLUDED = 500;
  // Sites where a forced theme is known to do more harm than good (canvas maps and editors). Seeded on the
  // first run only, so the person can remove any of them.
  var DEFAULT_EXCLUDED = ["maps.google.com", "earth.google.com", "www.openstreetmap.org", "figma.com", "excalidraw.com", "photopea.com"];

  function log(error) {
    console.error("[drift-dark]", error);
  }

  // ---- pure helpers (exposed for the tests) ---------------------------------------------------

  // "https://www.Example.com/a", "Example.com.", "*.example.com" -> "www.example.com" / "example.com"; null when it is not a host.
  function normalizeHost(input) {
    if (typeof input !== "string") return null;
    var text = input.trim();
    if (text === "" || text.length > 300) return null;
    var url;
    try {
      url = new URL(text.indexOf("://") === -1 ? "http://" + text.replace(/^\*\./, "") : text);
    } catch (e) {
      return null;
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    var host = url.hostname.toLowerCase().replace(/\.$/, "").replace(/^\*\./, "");
    if (host === "" || host.length > 253) return null;
    if (!/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/.test(host) || host.indexOf("..") !== -1) return null;
    // A bare "com" would cover every .com site.
    if (host.indexOf(".") === -1 && host !== "localhost") return null;
    return host;
  }

  function covers(rule, host) {
    return host === rule || host.slice(-(rule.length + 1)) === "." + rule;
  }

  function isExcluded(list, host) {
    var h = normalizeHost(host);
    if (!h || !Array.isArray(list)) return false;
    return list.some(function (rule) {
      return typeof rule === "string" && covers(rule, h);
    });
  }

  // Excluded -> every rule that covers the host goes (so a parent-domain rule is lifted too); else the host is added.
  function toggleHost(list, host) {
    var h = normalizeHost(host);
    if (!h) return { list: list, excluded: isExcluded(list, host), changed: false };
    if (isExcluded(list, h)) {
      return { list: list.filter(function (rule) { return !covers(rule, h); }), excluded: false, changed: true };
    }
    return { list: addHost(list, h), excluded: true, changed: true };
  }

  function removeHost(list, host) {
    var h = normalizeHost(host);
    return h ? list.filter(function (rule) { return !covers(rule, h); }) : list;
  }

  // The longest rule that covers the host wins, so "docs.example.com" can differ from "example.com".
  function overrideFor(overrides, host) {
    var h = normalizeHost(host);
    if (!h || !overrides || typeof overrides !== "object") return null;
    var best = null;
    Object.keys(overrides).forEach(function (rule) {
      if (covers(rule, h) && (best === null || rule.length > best.length)) best = rule;
    });
    return best === null ? null : overrides[best];
  }

  // Is the theme off for this host, going by the site list alone?
  function hostOff(settings, host) {
    var listed = isExcluded(settings.excluded, host);
    return settings.siteMode === "only" ? !listed : listed;
  }

  function inNight(hour, from, to) {
    if (from === to) return true;
    return from < to ? hour >= from && hour < to : hour >= from || hour < to;
  }

  function addHost(list, host) {
    var h = normalizeHost(host);
    if (!h || list.indexOf(h) !== -1) return list;
    return list.concat([h]).slice(-MAX_EXCLUDED);
  }

  function clampInt(value, min, max, fallback) {
    var n = Math.round(Number(value));
    return isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
  }

  var SCHEDULES = ["always", "system", "night"];
  var MAX_OVERRIDES = 100;

  function sanitize(raw) {
    var r = raw && typeof raw === "object" ? raw : {};
    var overrides = {};
    var oRaw = r.overrides && typeof r.overrides === "object" ? r.overrides : {};
    Object.keys(oRaw).forEach(function (key) {
      var h = normalizeHost(key);
      if (h && MODES.indexOf(oRaw[key]) !== -1 && Object.keys(overrides).length < MAX_OVERRIDES) overrides[h] = oRaw[key];
    });
    var seen = {};
    var excluded = [];
    (Array.isArray(r.excluded) ? r.excluded : []).forEach(function (x) {
      var h = normalizeHost(x);
      if (h && !seen[h] && excluded.length < MAX_EXCLUDED) {
        seen[h] = true;
        excluded.push(h);
      }
    });
    return {
      enabled: r.enabled !== false,
      mode: MODES.indexOf(r.mode) !== -1 ? r.mode : "auto",
      brightness: clampInt(r.brightness, 80, 110, 100),
      contrast: clampInt(r.contrast, 80, 110, 90),
      excluded: excluded,
      siteMode: r.siteMode === "only" ? "only" : "except",
      schedule: SCHEDULES.indexOf(r.schedule) !== -1 ? r.schedule : "always",
      nightFrom: clampInt(r.nightFrom, 0, 23, 20),
      nightTo: clampInt(r.nightTo, 0, 23, 7),
      overrides: overrides,
    };
  }

  if (typeof driftPlugin !== "undefined" && typeof driftPlugin.__expose === "function") {
    driftPlugin.__expose({ normalizeHost: normalizeHost, isExcluded: isExcluded, toggleHost: toggleHost, addHost: addHost, removeHost: removeHost, overrideFor: overrideFor, hostOff: hostOff, inNight: inNight, sanitize: sanitize });
  }

  // ---- storage --------------------------------------------------------------------------------

  // Changes go one after another, so two quick clicks cannot read the same list and overwrite each other.
  var queue = Promise.resolve();
  function serial(task) {
    var run = queue.then(task);
    queue = run.catch(function () {});
    return run;
  }

  // Only this page writes the settings, so the last value read or written stays valid: pages asking on every load
  // do not each go to storage. `undefined` means "not read yet" (storage itself answers null for "never saved").
  var cache;

  function read() {
    if (cache !== undefined) return Promise.resolve(sanitize(cache));
    return driftPlugin.storage.get("settings").then(function (value) {
      cache = value === null || value === undefined ? { excluded: DEFAULT_EXCLUDED } : value;
      return sanitize(cache);
    });
  }

  function change(edit) {
    return serial(function () {
      return read().then(function (settings) {
        var next = sanitize(edit(settings) || settings);
        return driftPlugin.storage.set("settings", next).then(function () {
          cache = next;
          return next;
        });
      });
    });
  }

  // ---- what content.js is told ------------------------------------------------------------------

  // Only what applies to the asking page: never the list of sites.
  driftPlugin.runtime.onMessage(function (message) {
    if (!message || message.type !== "get") return null;
    return read().then(function (s) {
      var host = String(message.host || "");
      var scheduled = s.schedule !== "night" || inNight(new Date().getHours(), s.nightFrom, s.nightTo);
      return {
        enabled: s.enabled && scheduled,
        mode: overrideFor(s.overrides, host) || s.mode,
        brightness: s.brightness,
        contrast: s.contrast,
        excluded: hostOff(s, host),
        system: s.schedule === "system",
      };
    }).catch(function (e) {
      log(e);
      return null;
    });
  });

  // ---- commands ---------------------------------------------------------------------------------

  // The toolbar button and the palette pass no address; only the context menu does. For the others the
  // active tab is asked for. Pinned and browser-internal pages are not in that snapshot.
  function hostOfCommand(windowLabel, context) {
    var fromMenu = context && context.pageUrl ? normalizeHost(context.pageUrl) : null;
    if (fromMenu) return Promise.resolve(fromMenu);
    return driftPlugin.tabs.snapshot({ windowLabel: windowLabel, scope: "active" }).then(
      function (snap) {
        var tab = snap && snap.tabs && snap.tabs[0];
        return tab ? normalizeHost(tab.url) : null;
      },
      function () {
        return null;
      }
    );
  }

  function say(text) {
    return driftPlugin.ui.setButton({ title: text }).catch(log);
  }

  function handleCommand(id, context) {
    var windowLabel = context.windowLabel;
    if (id === "open-settings") return driftPlugin.ui.openPage({ windowLabel: windowLabel });
    if (id === "toggle-global") {
      return change(function (s) {
        s.enabled = !s.enabled;
        return s;
      }).then(function (s) {
        return say(s.enabled ? "Dark theme: on everywhere" : "Dark theme: off everywhere");
      });
    }
    if (id === "toggle-site" || id === "@toolbar" || id === "broken-here") {
      return hostOfCommand(windowLabel, context.context).then(function (host) {
        if (!host) return say("Dark theme: open an ordinary web page first");
        var off = false;
        return change(function (s) {
          var only = s.siteMode === "only";
          if (id === "broken-here") {
            // "Doesn't work here" always means off: skip the site, or drop it from the list of sites to darken.
            s.excluded = only ? removeHost(s.excluded, host) : addHost(s.excluded, host);
          } else {
            s.excluded = toggleHost(s.excluded, host).list;
          }
          off = hostOff(s, host);
          return s;
        }).then(function () {
          return say(off ? "Dark theme: off on " + host : "Dark theme: on for " + host);
        });
      });
    }
    return null;
  }

  driftPlugin.runtime.onCommand(function (id, context) {
    Promise.resolve()
      .then(function () {
        return handleCommand(id, context || {});
      })
      .catch(log);
  });

  // ---- the settings page --------------------------------------------------------------------------

  function fail(error) {
    return { ok: false, error: error };
  }

  driftPlugin.runtime.onPageMessage(function (message) {
    var m = message || {};
    var done = function (s) {
      return { ok: true, settings: s };
    };
    var task;
    switch (m.type) {
      case "getSettings":
        task = read().then(done);
        break;
      case "set":
        task = change(function (s) {
          var p = m.patch && typeof m.patch === "object" ? m.patch : {};
          if (typeof p.enabled === "boolean") s.enabled = p.enabled;
          if (MODES.indexOf(p.mode) !== -1) s.mode = p.mode;
          if (p.siteMode === "except" || p.siteMode === "only") s.siteMode = p.siteMode;
          if (SCHEDULES.indexOf(p.schedule) !== -1) s.schedule = p.schedule;
          if (p.nightFrom !== undefined) s.nightFrom = p.nightFrom;
          if (p.nightTo !== undefined) s.nightTo = p.nightTo;
          if (p.brightness !== undefined) s.brightness = p.brightness;
          if (p.contrast !== undefined) s.contrast = p.contrast;
          return s;
        }).then(done);
        break;
      case "addSite": {
        var host = normalizeHost(m.input);
        if (!host) return Promise.resolve(fail("invalid"));
        task = change(function (s) {
          s.excluded = addHost(s.excluded, host);
          return s;
        }).then(done);
        break;
      }
      case "addSites": {
        var hosts = (Array.isArray(m.inputs) ? m.inputs : []).map(normalizeHost).filter(Boolean);
        if (!hosts.length) return Promise.resolve(fail("invalid"));
        task = change(function (s) {
          hosts.forEach(function (h) { s.excluded = addHost(s.excluded, h); });
          return s;
        }).then(done);
        break;
      }
      case "setOverride": {
        var target = normalizeHost(m.input);
        if (!target) return Promise.resolve(fail("invalid"));
        task = change(function (s) {
          if (MODES.indexOf(m.mode) !== -1) s.overrides[target] = m.mode;
          else delete s.overrides[target];
          return s;
        }).then(done);
        break;
      }
      case "removeSite": {
        var gone = normalizeHost(m.host);
        task = change(function (s) {
          s.excluded = s.excluded.filter(function (h) { return h !== gone; });
          return s;
        }).then(done);
        break;
      }
      default:
        return Promise.resolve(fail("unknown"));
    }
    return task.catch(function (e) {
      log(e);
      return fail(/storage is full/i.test(String(e && e.message ? e.message : e)) ? "full" : "failed");
    });
  });
})();
