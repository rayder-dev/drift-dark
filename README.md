# Forced Dark Theme

A plugin for the Drift browser (0.2.0 or newer). Makes light websites dark. A site that already has a dark theme is left alone.

## What it does

- **Decides per page.** Nothing is done when the page has `<meta name="color-scheme">` with `dark`, when the root's computed `color-scheme` is dark, or when the page background is dark (median of a few sampled points, brightness below 0.4). `light dark` counts as dark only while the browser prefers dark. The decision is repeated when `class`, `style` or a `data-theme`-like attribute of `html` or `body` changes (at most every 250 ms, and a page that keeps flipping its classes is looked at 20 times per 10 s, then left).
- **Modes** (switch in the settings page):
  - **Automatic (default).** Puts `color-scheme: dark` on the root. If that leaves a light spot or dark text, switches to inversion.
  - **Gentle.** Only `color-scheme: dark`: dark scrollbars, forms and default background. Pages with their own white background stay white.
  - **Inversion.** `filter: invert(1) hue-rotate(180deg) brightness() contrast()` on `html`. Images, video, canvas, iframe, embed, object, `svg image` and photo-sized CSS background images get the same filter again, which turns them back.
- **Why the filter is on `html`.** Checked in headless Chrome: with the filter on `body`, a `position: fixed` element scrolls away with the page (top = -1000 after scrolling 1000 px); with the filter on `html` it stays put. Anything inside a restored element is left alone, or it would be flipped a third time.
- **Dynamic recolouring (CSS variables, per-element colours) is not implemented.** It is the best-looking approach and also the one with the most ways to break a site; the three modes above are what is here.
- **Exceptions.** A list of sites (a site covers its subdomains). Toolbar button and command "toggle on this site", command "toggle everywhere", command "doesn't work on this site" (adds the site to the list), and a right-click item "Dark theme: toggle on this site". Seeded on first run with maps and canvas editors (maps.google.com, earth.google.com, www.openstreetmap.org, figma.com, excalidraw.com, photopea.com); remove any of them in the settings.
- **Settings page.** Global switch, mode, brightness and contrast (80-110%), the site list. English and Russian.

## How it is built, and what the platform limits

- `content.js` is injected by the browser after the page finished loading (on `did-stop-loading`), in the top frame only, through `executeJavaScript`. `runAt: document_start` makes no difference.
- **A white flash on the first paint cannot be removed.** The page is already painted when the script runs. What is done: the decision and the style are applied synchronously at once with the default settings (dark on, automatic), before asking for the real ones, so the flash lasts as long as the page needed to load plus one frame. On an excluded site, or when the theme is switched off, the page is briefly dark until `background.js` answers (usually milliseconds, up to a few seconds if the background page was asleep).
- **Less flicker on top of that.** The theme is applied with the page's CSS transitions switched off for 150 ms, so a site with `transition: all` does not fade the filter in. Measuring the page disables the plugin's stylesheet for the length of one call instead of removing and re-adding it, and coming back to a tab with unchanged settings touches nothing. The last answer for a site ("off" or "on") is kept in that site's own `localStorage` under `drift-dark-hint`, so a site you excluded is not painted dark while `background.js` is still answering. The site can read this one word; delete it by clearing the site's data.
- The content script only has `runtime.sendMessage`. `background.js` owns storage and answers `{type: "get", host}` with the settings and one flag, `excluded`; the content script never receives the site list.
- **Open tabs are not pushed.** The background cannot reach a tab, so a tab asks again when it comes back to the front (`visibilitychange`, `focus`, `pageshow`, at most once every 3 s) and on every navigation. There is no timer, so the background page is not kept awake. Change a setting, switch to a tab, and it updates.
- Toolbar button and palette commands get no page address from the browser (only the right-click menu does). They ask for the active tab (`tabs_snapshot`), so they do not work on **pinned tabs** and browser pages; use the right-click item there. The toolbar tooltip shows what was done.
- Style: one `<style id="drift-dark-style">`; installing the script into the same page twice does not duplicate it. If the page's CSP leaves that style empty, a constructable stylesheet is used instead.
- Not touched: private tabs (the browser injects nothing there), non-HTML documents (PDF, images, XML), pages that are not `http`/`https`.
- Permissions: `storage`, `ui`, `context_menu`, `tabs_snapshot`. No network.

## Honest limits

Inversion is never perfect. Expect: photos used as CSS backgrounds that are smaller than 100x60 px or are SVG data URLs showing inverted; embedded iframes (ads, widgets) shown in their original, light colours; semi-transparent overlays and shadows looking different; slightly dull media (brightness and contrast act on the whole page); gradients and colours shifted by `hue-rotate`. On heavy pages the filter costs GPU time. Where a site looks wrong, use "doesn't work on this site". The settings page is dark in any browser theme.

## Install

Drift installs plugins only from its catalogue: a repository of the `rayder-dev` GitHub account with the topic `drift-plugin`, a release tag, and a release signed by the author's key (`scripts/sign-plugin.mjs` in the browser project). Then open the Plugins page in Drift, install it and grant the permissions. There is no "install from folder" in the browser.

## Русский

Плагин для браузера Drift (0.2.0 и новее). Делает светлые сайты тёмными. Сайты со своей тёмной темой не трогает.

- **Когда не вмешивается:** есть `meta color-scheme` с `dark`, у корня вычисленный `color-scheme` тёмный, или фон страницы тёмный. Решение пересматривается при смене `class`, `style` и `data-theme` у `html` и `body` (не чаще раза в 250 мс).
- **Режимы:** автоматический (сначала `color-scheme: dark`, если мало – инверсия), мягкий, инверсия. Инверсия – фильтр на `html` (на `body` ломается `position: fixed`, проверено), картинки, видео, canvas, iframe и крупные CSS-фоны возвращаются обратно. Динамическая перекраска не сделана.
- **Исключения:** список сайтов (с поддоменами), кнопка и команды «включить/выключить на этом сайте» и «везде», «не работает на этом сайте», пункт контекстного меню. При первом запуске в список занесены карты и редакторы на canvas, их можно убрать.
- **Белую вспышку при загрузке убрать нельзя:** браузер вставляет скрипт после полной загрузки страницы. Тема применяется сразу, до ответа фона, с настройками по умолчанию.
- **Открытые вкладки** подхватывают изменения, когда вы к ним возвращаетесь (и при каждой навигации). Таймера нет, чтобы не держать фоновую страницу.
- **Кнопка тулбара и палитра** определяют сайт по активной вкладке и не работают на закреплённых вкладках и страницах браузера. Там используйте пункт контекстного меню.
- **Приватные вкладки:** скрипт туда не вставляется.
- **Инверсия не идеальна:** мелкие CSS-картинки, iframe (реклама, виджеты), полупрозрачные оверлеи, нагрузка на GPU на тяжёлых страницах. Если сайт выглядит плохо – «не работает на этом сайте».
- **Установка:** только через каталог Drift: репозиторий аккаунта `rayder-dev` с темой `drift-plugin`, релиз и подпись `scripts/sign-plugin.mjs`. Установки из папки в браузере нет.
