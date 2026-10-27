// Forced Dark Theme: the plugin's settings page. Runs in a sandboxed frame; `driftPlugin` comes from
// drift-page.js. It never writes storage itself: every change is a message to background.js.
(function () {
  var TEXT = {
    en: {
      title: "Forced Dark Theme",
      subtitle: "Makes light websites dark. Sites with their own dark theme are left alone.",
      enabled: "Dark theme everywhere",
      enabledHint: "Turn it off to leave every site as it is.",
      mode: "Mode",
      auto: "Automatic",
      autoHint: "Tries the gentle way first, inverts the page when that is not enough.",
      soft: "Gentle",
      softHint: "Only asks for dark scrollbars, forms and default background. Pages with their own white background stay white.",
      invert: "Inversion",
      invertHint: "Inverts the whole page and turns pictures and video back. Works on almost any site, never perfect.",
      tune: "Brightness and contrast",
      brightness: "Brightness",
      contrast: "Contrast",
      reset: "Reset",
      schedule: "When",
      always: "Always",
      alwaysHint: "The theme is on whenever the settings allow it.",
      system: "Like the system",
      systemHint: "Only while the browser prefers a dark scheme.",
      night: "At night",
      nightHint: "Only between the hours below (checked when a page loads or you come back to it).",
      from: "From",
      to: "To",
      hourUnit: "h",
      sites: "Sites without dark theme",
      sitesOnly: "Sites with dark theme",
      sitesHint: "A site here also covers its subdomains.",
      siteMode: "List means",
      except: "Skip these",
      only: "Only these",
      exceptHint: "Every site gets the dark theme except the ones in the list.",
      onlyHint: "Only the sites in the list get the dark theme.",
      none: "No sites yet.",
      remove: "Remove",
      placeholder: "example.com",
      add: "Add site",
      exportList: "Show list",
      importList: "Add from text",
      transferHint: "One site per line. Show list fills the box, Add from text adds what is in it.",
      overrides: "Mode per site",
      overridesHint: "Overrides the mode above for a site and its subdomains.",
      overridesNone: "No overrides.",
      invalid: "That does not look like a site address.",
      failed: "Couldn't save that.",
      full: "This plugin's storage is full.",
      applyNote: "Open tabs pick up changes when the mouse comes back over the page, or when you switch back to them.",
    },
    ru: {
      title: "Принудительная тёмная тема",
      subtitle: "Делает светлые сайты тёмными. Сайты со своей тёмной темой не трогает.",
      enabled: "Тёмная тема везде",
      enabledHint: "Выключите, чтобы все сайты остались как есть.",
      mode: "Режим",
      auto: "Автоматически",
      autoHint: "Сначала мягкий способ, если его мало – инверсия страницы.",
      soft: "Мягкий",
      softHint: "Только тёмные полосы прокрутки, формы и фон по умолчанию. Страницы со своим белым фоном остаются белыми.",
      invert: "Инверсия",
      invertHint: "Инвертирует всю страницу, картинки и видео возвращает обратно. Подходит почти любому сайту, но не идеальна.",
      tune: "Яркость и контраст",
      brightness: "Яркость",
      contrast: "Контраст",
      reset: "Сбросить",
      schedule: "Когда",
      always: "Всегда",
      alwaysHint: "Тема включена всегда, когда это позволяют настройки.",
      system: "Как в системе",
      systemHint: "Только пока браузер предпочитает тёмную схему.",
      night: "Ночью",
      nightHint: "Только в часы ниже (проверяется при загрузке страницы и возвращении на неё).",
      from: "С",
      to: "До",
      hourUnit: "ч",
      sites: "Сайты без тёмной темы",
      sitesOnly: "Сайты с тёмной темой",
      sitesHint: "Сайт из списка действует и на его поддомены.",
      siteMode: "Что значит список",
      except: "Пропускать",
      only: "Только эти",
      exceptHint: "Тёмная тема на всех сайтах, кроме тех, что в списке.",
      onlyHint: "Тёмная тема только на сайтах из списка.",
      none: "Сайтов пока нет.",
      remove: "Убрать",
      placeholder: "example.com",
      add: "Добавить сайт",
      exportList: "Показать список",
      importList: "Добавить из текста",
      transferHint: "Один сайт на строку. «Показать список» заполняет поле, «Добавить из текста» добавляет то, что в нём.",
      overrides: "Режим для сайта",
      overridesHint: "Заменяет режим выше для сайта и его поддоменов.",
      overridesNone: "Исключений нет.",
      invalid: "Это не похоже на адрес сайта.",
      failed: "Не удалось сохранить.",
      full: "Хранилище плагина заполнено.",
      applyNote: "Открытые вкладки подхватят изменения, когда мышь вернётся на страницу или когда вы к ним вернётесь.",
    },
  };

  var lang = "en";
  var settings = null;
  var noticeText = "";
  var noticeError = false;
  var sliderTimers = {}; // one per slider: a quick move of the other must not cancel this one
  var transferText = "";
  var pendingRender = false;

  function t(key) {
    return (TEXT[lang] || TEXT.en)[key];
  }

  function el(tag, props, children) {
    var node = document.createElement(tag);
    Object.keys(props || {}).forEach(function (key) {
      if (key === "text") node.textContent = props[key];
      else if (key.slice(0, 2) === "on") node.addEventListener(key.slice(2), props[key]);
      else node.setAttribute(key, props[key]);
    });
    (children || []).forEach(function (child) {
      if (child) node.appendChild(child);
    });
    return node;
  }

  function send(message) {
    return driftPlugin.runtime.sendMessage(message).then(
      function (answer) {
        if (answer && answer.ok) {
          settings = answer.settings;
          noticeText = "";
          return true;
        }
        noticeText = answer && answer.error === "invalid" ? t("invalid") : answer && answer.error === "full" ? t("full") : t("failed");
        noticeError = true;
        return false;
      },
      function () {
        noticeText = t("failed");
        noticeError = true;
        return false;
      }
    );
  }

  // A control being used (a slider being dragged, a field being typed in) must not be rebuilt under the hand:
  // the redraw waits until it loses focus.
  function busy() {
    var a = document.activeElement;
    return !!a && (a.tagName === "INPUT" || a.tagName === "SELECT" || a.tagName === "TEXTAREA");
  }

  function load() {
    return send({ type: "getSettings" }).then(function () {
      if (busy()) pendingRender = true;
      else render();
    });
  }

  document.addEventListener("focusout", function () {
    if (!pendingRender) return;
    setTimeout(function () {
      if (pendingRender && !busy()) render();
    }, 0);
  });

  function patch(p) {
    return send({ type: "set", patch: p }).then(render);
  }

  // A group of exclusive choices: one tab stop, arrow keys move between them.
  function segment(label, ids, current, onPick, hintOf) {
    var group = ids.join("-");
    var buttons = ids.map(function (id) {
      return el("button", {
        type: "button",
        role: "radio",
        tabindex: id === current ? "0" : "-1",
        title: t(hintOf ? hintOf(id) : id),
        text: t(id),
        "aria-checked": String(id === current),
        onclick: function () {
          onPick(id);
        },
      });
    });
    var box = el("div", { class: "seg n" + ids.length, role: "radiogroup", "aria-label": label, "data-group": group }, buttons);
    box.addEventListener("keydown", function (e) {
      var step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
      if (!step) return;
      e.preventDefault();
      var next = (ids.indexOf(current) + step + ids.length) % ids.length;
      // The page is rebuilt after a change, so the focus is put back on the chosen button.
      Promise.resolve(onPick(ids[next])).then(function () {
        var chosen = document.querySelector('[data-group="' + group + '"] [aria-checked="true"]');
        if (chosen) chosen.focus();
      });
    });
    return box;
  }

  function slider(key, min, max) {
    var out = el("output", { text: settings[key] + "%" });
    var input = el("input", { type: "range", min: String(min), max: String(max), step: "1", "aria-label": t(key) });
    input.value = String(settings[key]);
    input.addEventListener("input", function () {
      out.textContent = input.value + "%";
      clearTimeout(sliderTimers[key]);
      sliderTimers[key] = setTimeout(function () {
        var p = {};
        p[key] = Number(input.value);
        send({ type: "set", patch: p });
      }, 150);
    });
    return el("label", { class: "slider" }, [el("span", { text: t(key) }), input, out]);
  }

  function chip(label, title, removeMessage) {
    return el("li", {}, [
      el("span", { text: label, title: title }),
      el("button", {
        type: "button",
        class: "chip-x",
        text: "×",
        title: t("remove"),
        "aria-label": t("remove") + ": " + title,
        onclick: function () {
          send(removeMessage).then(render);
        },
      }),
    ]);
  }

  function listOrEmpty(items, emptyKey) {
    return items.length ? el("ul", { class: "sites" }, items) : el("div", { class: "empty", text: t(emptyKey) });
  }

  function hourInput(key) {
    var input = el("input", { type: "number", min: "0", max: "23", step: "1", "aria-label": t(key === "nightFrom" ? "from" : "to") });
    input.value = String(settings[key]);
    input.addEventListener("change", function () {
      if (input.value.trim() === "") return; // an empty box is not hour 0
      var p = {};
      p[key] = Number(input.value);
      send({ type: "set", patch: p });
    });
    return input;
  }

  function hint(key) {
    return function (id) {
      return id + key;
    };
  }

  function render() {
    pendingRender = false;
    var root = document.getElementById("root");
    root.textContent = "";
    document.title = t("title");
    if (!settings) return;

    var toggle = el("button", {
      type: "button",
      class: "switch",
      role: "switch",
      "aria-checked": String(settings.enabled),
      "aria-label": t("enabled"),
      onclick: function () {
        patch({ enabled: !settings.enabled });
      },
    });

    var only = settings.siteMode === "only";
    var list = listOrEmpty(
      settings.excluded.map(function (host) {
        return chip(host, host, { type: "removeSite", host: host });
      }),
      "none"
    );

    var input = el("input", { type: "text", placeholder: t("placeholder"), "aria-label": t(only ? "sitesOnly" : "sites"), maxlength: "300", autocomplete: "off" });
    function add() {
      var value = input.value;
      if (value.trim() === "") return;
      send({ type: "addSite", input: value }).then(function (ok) {
        if (ok) input.value = "";
        render();
      });
    }
    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter") add();
    });

    var transfer = el("textarea", { rows: "3", "aria-label": t("transferHint"), title: t("transferHint"), spellcheck: "false" });
    transfer.value = transferText;
    transfer.addEventListener("input", function () {
      transferText = transfer.value;
    });

    var tune = el("div", { class: "card" }, [
      el("div", { class: "head" }, [
        el("h2", { text: t("tune") }),
        el("button", {
          type: "button",
          class: "btn",
          text: t("reset"),
          onclick: function () {
            patch({ brightness: 100, contrast: 90 });
          },
        }),
      ]),
      slider("brightness", 80, 110),
      slider("contrast", 80, 110),
    ]);

    var mode = el("div", { class: "card" }, [
      el("div", { class: "head" }, [el("h2", { text: t("mode") })]),
      segment(t("mode"), ["auto", "soft", "invert"], settings.mode, function (id) {
        return patch({ mode: id });
      }, hint("Hint")),
      el("p", { class: "hint", text: t(settings.mode + "Hint") }),
    ]);

    var schedule = el("div", { class: "card" }, [
      el("div", { class: "head" }, [el("h2", { text: t("schedule") })]),
      segment(t("schedule"), ["always", "system", "night"], settings.schedule, function (id) {
        return patch({ schedule: id });
      }, hint("Hint")),
      settings.schedule === "night"
        ? el("div", { class: "hours" }, [
            el("label", {}, [el("span", { text: t("from") }), hourInput("nightFrom"), el("span", { text: t("hourUnit") })]),
            el("label", {}, [el("span", { text: t("to") }), hourInput("nightTo"), el("span", { text: t("hourUnit") })]),
          ])
        : null,
      el("p", { class: "hint", text: t(settings.schedule + "Hint") }),
    ]);

    var sites = el("div", { class: "card" }, [
      el("div", { class: "head" }, [el("h2", { text: t(only ? "sitesOnly" : "sites") })]),
      segment(t("siteMode"), ["except", "only"], settings.siteMode, function (id) {
        return patch({ siteMode: id });
      }, hint("Hint")),
      el("p", { class: "hint", text: t(settings.siteMode + "Hint") + " " + t("sitesHint") }),
      list,
      el("div", { class: "add" }, [input, el("button", { type: "button", class: "btn", text: t("add"), onclick: add })]),
      el("div", { class: "add transfer" }, [
        transfer,
        el("div", { class: "stack" }, [
          el("button", {
            type: "button",
            class: "btn",
            text: t("exportList"),
            onclick: function () {
              transferText = settings.excluded.join("\n");
              render();
            },
          }),
          el("button", {
            type: "button",
            class: "btn",
            text: t("importList"),
            onclick: function () {
              var inputs = transferText.split(/[\s,;]+/).filter(Boolean);
              if (!inputs.length) return;
              send({ type: "addSites", inputs: inputs }).then(function (ok) {
                if (ok) transferText = "";
                render();
              });
            },
          }),
        ]),
      ]),
      el("div", { class: noticeError ? "notice error" : "notice", role: "status", text: noticeText }),
    ]);

    var overrideHost = el("input", { type: "text", placeholder: t("placeholder"), "aria-label": t("overrides"), maxlength: "300", autocomplete: "off" });
    var overrideMode = el(
      "select",
      { "aria-label": t("mode") },
      ["auto", "soft", "invert"].map(function (id) {
        return el("option", { value: id, text: t(id) });
      })
    );
    function addOverride() {
      if (overrideHost.value.trim() === "") return;
      send({ type: "setOverride", input: overrideHost.value, mode: overrideMode.value }).then(render);
    }
    overrideHost.addEventListener("keydown", function (e) {
      if (e.key === "Enter") addOverride();
    });
    var overrides = el("div", { class: "card" }, [
      el("div", { class: "head" }, [el("h2", { text: t("overrides") })]),
      el("p", { class: "hint", text: t("overridesHint") }),
      listOrEmpty(
        Object.keys(settings.overrides).map(function (host) {
          return chip(host + " · " + t(settings.overrides[host]), host, { type: "setOverride", input: host, mode: "" });
        }),
        "overridesNone"
      ),
      el("div", { class: "add" }, [overrideHost, overrideMode, el("button", { type: "button", class: "btn", text: t("add"), onclick: addOverride })]),
    ]);

    root.appendChild(
      el("div", { class: "page" }, [
        el("div", { class: "top" }, [
          el("div", {}, [el("h1", { class: "title", text: t("title") }), el("p", { class: "subtitle", text: t("subtitle") })]),
          el("label", { class: "master", title: t("enabledHint") }, [el("span", { text: t("enabled") }), toggle]),
        ]),
        el("div", { class: "grid" }, [el("div", { class: "col" }, [mode, schedule, tune]), el("div", { class: "col" }, [sites, overrides])]),
        el("p", { class: "foot", text: t("applyNote") }),
      ])
    );
    noticeError = false;
  }

  driftPlugin.onTheme(function (info) {
    lang = info && info.lang && String(info.lang).slice(0, 2) === "ru" ? "ru" : "en";
    render();
  });
  driftPlugin.onStorageChanged(function () {
    load();
  });
  driftPlugin.ready.then(load, load);
})();
