// Forced Dark Theme: the plugin's settings page. Runs in a sandboxed frame; `driftPlugin` comes from
// drift-page.js. It never writes storage itself: every change is a message to background.js.
(function () {
  var TEXT = {
    en: {
      title: "Forced Dark Theme",
      subtitle: "Makes light websites dark. Sites with their own dark theme are left alone.",
      general: "General",
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
      sites: "Sites without dark theme",
      sitesHint: "A site here also covers its subdomains.",
      none: "No sites yet.",
      remove: "Remove",
      placeholder: "example.com",
      add: "Add site",
      invalid: "That does not look like a site address.",
      failed: "Couldn't save that.",
      full: "This plugin's storage is full.",
      applyNote: "Open tabs pick up changes when you switch back to them.",
    },
    ru: {
      title: "Принудительная тёмная тема",
      subtitle: "Делает светлые сайты тёмными. Сайты со своей тёмной темой не трогает.",
      general: "Общее",
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
      sites: "Сайты без тёмной темы",
      sitesHint: "Сайт из списка действует и на его поддомены.",
      none: "Сайтов пока нет.",
      remove: "Убрать",
      placeholder: "example.com",
      add: "Добавить сайт",
      invalid: "Это не похоже на адрес сайта.",
      failed: "Не удалось сохранить.",
      full: "Хранилище плагина заполнено.",
      applyNote: "Открытые вкладки подхватят изменения, когда вы к ним вернётесь.",
    },
  };

  var lang = "en";
  var settings = null;
  var noticeText = "";
  var noticeError = false;
  var sliderTimer = 0;

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

  function load() {
    return send({ type: "getSettings" }).then(render);
  }

  function modeButton(id) {
    return el(
      "button",
      {
        type: "button",
        class: "mode",
        role: "radio",
        "aria-checked": String(settings.mode === id),
        onclick: function () {
          send({ type: "set", patch: { mode: id } }).then(render);
        },
      },
      [el("b", { text: t(id) }), el("span", { text: t(id + "Hint") })]
    );
  }

  function slider(key, min, max) {
    var out = el("output", { text: settings[key] + "%" });
    var input = el("input", { type: "range", min: String(min), max: String(max), step: "1", "aria-label": t(key) });
    input.value = String(settings[key]);
    input.addEventListener("input", function () {
      out.textContent = input.value + "%";
      clearTimeout(sliderTimer);
      sliderTimer = setTimeout(function () {
        var patch = {};
        patch[key] = Number(input.value);
        send({ type: "set", patch: patch });
      }, 150);
    });
    return el("label", { class: "slider" }, [el("span", { text: t(key) }), input, out]);
  }

  function siteRow(host) {
    return el("li", {}, [
      el("span", { text: host }),
      el("button", {
        type: "button",
        class: "btn",
        text: t("remove"),
        "aria-label": t("remove") + ": " + host,
        onclick: function () {
          send({ type: "removeSite", host: host }).then(render);
        },
      }),
    ]);
  }

  function render() {
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
        send({ type: "set", patch: { enabled: !settings.enabled } }).then(render);
      },
    });

    var list = el("ul", { class: "sites" }, settings.excluded.map(siteRow));
    if (!settings.excluded.length) list = el("div", { class: "empty", text: t("none") });

    var input = el("input", { type: "text", placeholder: t("placeholder"), "aria-label": t("sites"), maxlength: "300", autocomplete: "off" });
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

    var tune = el("div", { class: "card" }, [
      el("h2", { text: t("tune") }),
      slider("brightness", 80, 110),
      slider("contrast", 80, 110),
      el("button", {
        type: "button",
        class: "btn",
        text: t("reset"),
        onclick: function () {
          send({ type: "set", patch: { brightness: 100, contrast: 90 } }).then(render);
        },
      }),
    ]);

    root.appendChild(
      el("div", { class: "page" }, [
        el("h1", { class: "title", text: t("title") }),
        el("p", { class: "subtitle", text: t("subtitle") }),
        el("div", { class: "card" }, [
          el("h2", { text: t("general") }),
          el("div", { class: "row" }, [el("div", {}, [el("div", { text: t("enabled") }), el("p", { class: "hint", text: t("enabledHint") })]), toggle]),
        ]),
        el("div", { class: "card" }, [el("h2", { text: t("mode") }), el("div", { class: "modes", role: "radiogroup", "aria-label": t("mode") }, [modeButton("auto"), modeButton("soft"), modeButton("invert")])]),
        tune,
        el("div", { class: "card" }, [
          el("h2", { text: t("sites") }),
          el("p", { class: "hint", text: t("sitesHint") }),
          list,
          el("div", { class: "add" }, [input, el("button", { type: "button", class: "btn", text: t("add"), onclick: add })]),
          el("div", { class: noticeError ? "notice error" : "notice", role: "status", text: noticeText }),
        ]),
        el("p", { class: "hint", text: t("applyNote") }),
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
