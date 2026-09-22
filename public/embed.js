/*!
 * BookKit embed.js — MIT. Contract: docs/EMBED-PROTOCOL.md
 *
 *   <script src="https://YOUR-INSTANCE/embed.js" defer></script>
 *
 * Popup:  <button data-bookkit-popup="strategy-call">Book a call</button>
 * Inline: <div data-bookkit-inline="strategy-call"></div>
 * Badge:  BookKit.badge({ slug: "strategy-call" })
 * JS API: BookKit.open(slug, { prefill, utm, duration, theme, accent, hideDetails })
 *
 * Events (also forwarded as DOM CustomEvents on window, e.g. "bookkit:booked"):
 *   ready | height | date_selected | slot_selected | payment_started | booked | close
 *
 * v1 compatibility: public/widget.js keeps working unchanged. This file does not
 * touch it and does not read window.BookKit set by it — a site swaps by changing
 * the script tag, per docs/MIGRATE-FROM-CALENDLY.md.
 */
(function () {
  "use strict";

  if (window.BookKit && window.BookKit.__bookkitEmbedV2) return;

  var script = document.currentScript;
  if (!script) {
    var all = document.getElementsByTagName("script");
    for (var i = all.length - 1; i >= 0; i--) {
      if (all[i].src && all[i].src.indexOf("embed.js") !== -1) {
        script = all[i];
        break;
      }
    }
  }

  // The trusted origin for every iframe src and every postMessage check. Read
  // from the script's own src by default; a site whose CDN/proxy rewrites or
  // strips that (or can't produce document.currentScript at all) sets
  // data-bookkit-origin="https://your-instance" on the <script> tag instead.
  // Deliberately NEVER falls back to window.location.origin — that would trust
  // whatever page happened to load this file, defeating the point of an origin
  // check.
  var ORIGIN = null;
  var declaredOrigin = script && script.getAttribute && script.getAttribute("data-bookkit-origin");
  if (declaredOrigin) {
    try {
      ORIGIN = new URL(declaredOrigin).origin;
    } catch (e) {
      ORIGIN = null;
    }
  }
  if (!ORIGIN && script && script.src) {
    try {
      ORIGIN = new URL(script.src).origin;
    } catch (e) {
      ORIGIN = null;
    }
  }
  if (!ORIGIN) {
    console.error(
      "BookKit embed.js: could not determine the BookKit instance's origin " +
        "(document.currentScript unavailable and no data-bookkit-origin attribute). " +
        'Add data-bookkit-origin="https://your-instance" to the <script> tag. Refusing to mount.'
    );
    return;
  }

  // ---------------------------------------------------------------------
  // Styles
  // ---------------------------------------------------------------------

  var STYLE_ID = "bookkit-embed-styles";

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    var css =
      ".bk-overlay{position:fixed;inset:0;z-index:2147483000;background:rgba(6,6,8,.72);" +
      "backdrop-filter:blur(3px);display:flex;align-items:center;justify-content:center;padding:16px;" +
      "opacity:0;transition:opacity .18s ease}" +
      ".bk-overlay.is-open{opacity:1}" +
      ".bk-overlay.bk-preloaded{visibility:hidden;pointer-events:none}" +
      ".bk-modal{position:relative;width:100%;max-width:720px;max-height:min(88vh,780px);" +
      "border-radius:16px;overflow-y:auto;-webkit-overflow-scrolling:touch;overscroll-behavior:contain;" +
      "box-shadow:0 24px 70px rgba(0,0,0,.5);background:#0b0b0c;" +
      "transform:translateY(8px);transition:transform .18s ease}" +
      ".bk-overlay.is-open .bk-modal{transform:none}" +
      // width:1px + min-width:100% is the proven iOS fix (kept from widget.js): without
      // it Safari sizes the iframe to its content's layout viewport, not the container.
      ".bk-popup-iframe{width:1px;min-width:100%;height:640px;border:0;display:block;background:transparent;" +
      "transition:height .15s ease;visibility:hidden}" +
      ".bk-close{position:sticky;top:10px;float:right;margin:10px 10px -42px 0;width:32px;height:32px;border:0;z-index:2;" +
      "border-radius:999px;background:rgba(20,20,22,.9);color:#fff;font-size:19px;line-height:1;" +
      "cursor:pointer;display:flex;align-items:center;justify-content:center}" +
      ".bk-close:hover{background:rgba(40,40,44,.95)}" +
      ".bk-close:focus-visible,.bk-popup-iframe:focus-visible{outline:2px solid #fff;outline-offset:2px}" +
      ".bk-inline-wrap{position:relative;width:100%}" +
      ".bk-inline-iframe{width:1px;min-width:100%;border:0;display:block;background:transparent;min-height:520px;" +
      "transition:height .15s ease;visibility:hidden}" +
      ".bk-skeleton{position:absolute;inset:0;min-height:320px;border-radius:12px;" +
      "background:linear-gradient(100deg,#161618 8%,#1f1f22 18%,#161618 33%);" +
      "background-size:200% 100%;animation:bk-shimmer 1.4s ease-in-out infinite}" +
      ".bk-skeleton-inline{min-height:520px}" +
      "@keyframes bk-shimmer{0%{background-position:0% 0}100%{background-position:-200% 0}}" +
      ".bk-badge{position:fixed;z-index:2147483000;padding:13px 20px;border-radius:999px;border:0;" +
      "background:#FF6A00;color:#fff;font:600 14px/1 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;" +
      "cursor:pointer;box-shadow:0 10px 30px rgba(0,0,0,.35)}" +
      ".bk-badge-bottom-right{right:20px;bottom:20px}" +
      ".bk-badge-bottom-left{left:20px;bottom:20px}" +
      "@media (max-width:640px){.bk-modal{max-height:100vh;max-width:100%;width:100%;height:100%;" +
      "border-radius:0;position:fixed;inset:0}}";
    var el = document.createElement("style");
    el.id = STYLE_ID;
    el.appendChild(document.createTextNode(css));
    document.head.appendChild(el);
  }

  // ---------------------------------------------------------------------
  // URL building
  // ---------------------------------------------------------------------

  var UTM_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "ref", "src"];

  function parentUtm() {
    var out = {};
    try {
      var params = new URLSearchParams(window.location.search);
      for (var i = 0; i < UTM_KEYS.length; i++) {
        var v = params.get(UTM_KEYS[i]);
        if (v) out[UTM_KEYS[i]] = v;
      }
    } catch (e) {
      /* no-op */
    }
    return out;
  }

  function genId() {
    return "bk_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 9);
  }

  function buildEmbedUrl(slug, opts) {
    opts = opts || {};
    var url = ORIGIN + "/embed/" + encodeURIComponent(slug);
    var params = new URLSearchParams();

    var prefill = opts.prefill || {};
    if (prefill.name) params.set("name", prefill.name);
    if (prefill.email) params.set("email", prefill.email);
    if (prefill.guests && prefill.guests.length) params.set("guests", prefill.guests.join(","));
    if (prefill.answers) {
      for (var qid in prefill.answers) {
        if (Object.prototype.hasOwnProperty.call(prefill.answers, qid)) {
          params.set("q_" + qid, prefill.answers[qid]);
        }
      }
    }

    if (opts.duration) params.set("duration", opts.duration);
    if (opts.theme) params.set("theme", opts.theme);
    if (opts.accent) params.set("accent", String(opts.accent).replace("#", ""));
    if (opts.tz) params.set("tz", opts.tz);
    if (opts.hideDetails) params.set("hide_details", "1");

    var utm = parentUtm();
    var extra = opts.utm || {};
    for (var k in extra) if (Object.prototype.hasOwnProperty.call(extra, k)) utm[k] = extra[k];
    for (var uk in utm) if (Object.prototype.hasOwnProperty.call(utm, uk)) params.set(uk, utm[uk]);

    params.set("embed_id", opts.embedId);
    var qs = params.toString();
    return qs ? url + "?" + qs : url;
  }

  // ---------------------------------------------------------------------
  // Event bus
  // ---------------------------------------------------------------------

  var listeners = {};

  function emit(shortType, detail) {
    try {
      window.dispatchEvent(new CustomEvent("bookkit:" + shortType, { detail: detail }));
    } catch (e) {
      /* very old browser */
    }
    var hs = listeners[shortType] || [];
    for (var i = 0; i < hs.length; i++) {
      try {
        hs[i](detail);
      } catch (e) {
        /* a host callback threw — don't let it break the bus */
      }
    }
  }

  function on(type, handler) {
    (listeners[type] = listeners[type] || []).push(handler);
    return function off() {
      listeners[type] = (listeners[type] || []).filter(function (h) {
        return h !== handler;
      });
    };
  }

  // ---------------------------------------------------------------------
  // Frame registry — tracks every mounted iframe (popup or inline) by embedId
  // ---------------------------------------------------------------------

  var frames = {}; // embedId -> { el, skeleton, kind }

  function markReady(embedId) {
    var rec = frames[embedId];
    if (!rec || rec.ready) return;
    rec.ready = true;
    if (rec.skeleton) rec.skeleton.style.display = "none";
    rec.el.style.visibility = "visible";
    try {
      var utm = parentUtm();
      if (Object.keys(utm).length && rec.el.contentWindow) {
        rec.el.contentWindow.postMessage({ type: "bookkit:parent_utm", utm: utm }, ORIGIN);
      }
    } catch (e) {
      /* no-op */
    }
  }

  // Clamped so a malformed or hostile bookkit:height message can't shrink the
  // frame to nothing or stretch the host page to an absurd height.
  var MIN_FRAME_HEIGHT = 200;
  var MAX_FRAME_HEIGHT = 6000;

  function resizeFrame(embedId, height) {
    var rec = frames[embedId];
    if (!rec) return;
    var h = Math.min(MAX_FRAME_HEIGHT, Math.max(MIN_FRAME_HEIGHT, Number(height) || 0));
    rec.el.style.height = h + "px";
  }

  // A frame that never signals ready (network hiccup, blocked script) shouldn't
  // stay skeletonized forever.
  var READY_FALLBACK_MS = 8000;
  function armReadyFallback(embedId) {
    setTimeout(function () {
      markReady(embedId);
    }, READY_FALLBACK_MS);
  }

  // ---------------------------------------------------------------------
  // Popup
  // ---------------------------------------------------------------------

  var popupState = null; // { overlay, frame, close, embedId, prevFocus, prevOverflow }

  var preloaded = null; // a hidden, already-loaded popup waiting for its first open

  // UTMs don't change what loads, so a preloaded popup is reusable from any button;
  // the clicked button's UTMs are sent in with bookkit:parent_utm on open.
  function popupKey(slug, opts) {
    var o = {};
    for (var k in opts || {}) if (k !== "utm" && Object.prototype.hasOwnProperty.call(opts, k)) o[k] = opts[k];
    return slug + "|" + JSON.stringify(o);
  }

  // Builds the overlay + iframe and puts it in the DOM (hidden). The iframe starts
  // loading immediately; opening later only reveals it, so it never reloads.
  function buildPopup(slug, opts) {
    injectStyles();
    opts = opts || {};
    var embedId = genId();

    var overlay = document.createElement("div");
    overlay.className = "bk-overlay bk-preloaded";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-label", "Book a meeting");

    var modal = document.createElement("div");
    modal.className = "bk-modal";

    var skeleton = document.createElement("div");
    skeleton.className = "bk-skeleton";
    skeleton.setAttribute("aria-hidden", "true");

    var frame = document.createElement("iframe");
    frame.className = "bk-popup-iframe";
    // preload=1: the page doesn't count a view until the popup is actually shown.
    frame.src = buildEmbedUrl(slug, mergeEmbedId(opts, embedId)) + "&preload=1";
    frame.title = "Book a meeting";
    frame.setAttribute("allow", "payment");

    var close = document.createElement("button");
    close.type = "button";
    close.className = "bk-close";
    close.setAttribute("aria-label", "Close booking dialog");
    close.innerHTML = "&times;";
    close.onclick = closePopup;

    // Close goes first so it sticks top-right (negative bottom margin: takes no height).
    modal.appendChild(close);
    modal.appendChild(skeleton);
    modal.appendChild(frame);
    overlay.appendChild(modal);

    overlay.addEventListener("mousedown", function (e) {
      if (e.target === overlay) closePopup();
    });

    document.body.appendChild(overlay);
    frames[embedId] = { el: frame, skeleton: skeleton, kind: "popup", ready: false };
    return { overlay: overlay, frame: frame, close: close, embedId: embedId, key: popupKey(slug, opts), slug: slug, opts: opts };
  }

  /** Load a popup in the background so the first click opens instantly. */
  function preloadPopup(slug, opts) {
    if (!slug || !document.body) return;
    var key = popupKey(slug, opts);
    if ((preloaded && preloaded.key === key) || (popupState && popupState.key === key)) return;
    if (preloaded && preloaded.overlay.parentNode) {
      delete frames[preloaded.embedId];
      preloaded.overlay.parentNode.removeChild(preloaded.overlay);
    }
    preloaded = buildPopup(slug, opts);
  }

  function openPopup(slug, opts) {
    if (!slug) throw new Error("BookKit.open(slug) needs a meeting type slug");
    opts = opts || {};
    closePopup();

    var st;
    if (preloaded && preloaded.key === popupKey(slug, opts)) {
      st = preloaded;
      preloaded = null;
    } else {
      st = buildPopup(slug, opts);
    }
    st.overlay.classList.remove("bk-preloaded");

    st.prevFocus = document.activeElement;
    st.prevOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";

    // Synchronous reflow + reveal, same reasoning as v1: never leave the popup
    // stuck at opacity 0 if a rAF callback gets throttled or deferred.
    void st.overlay.offsetWidth;
    st.overlay.classList.add("is-open");

    armReadyFallback(st.embedId);
    popupState = st;
    try {
      if (opts.utm) st.frame.contentWindow.postMessage({ type: "bookkit:parent_utm", utm: opts.utm }, ORIGIN);
      st.frame.contentWindow.postMessage({ type: "bookkit:shown" }, ORIGIN);
    } catch (e) {
      /* not loaded yet: the view is counted when it is */
    }

    st.overlay.firstChild.scrollTop = 0;
    st.close.focus({ preventScroll: true });
    return { close: closePopup, embedId: st.embedId };
  }

  function closePopup() {
    if (!popupState) return;
    var st = popupState;
    popupState = null;
    st.overlay.classList.remove("is-open");
    document.documentElement.style.overflow = st.prevOverflow || "";
    delete frames[st.embedId];
    emit("close", { embedId: st.embedId });
    setTimeout(function () {
      if (st.overlay.parentNode) st.overlay.parentNode.removeChild(st.overlay);
      if (st.slug && !preloaded) preloadPopup(st.slug, st.opts);
    }, 200);
    if (st.prevFocus && typeof st.prevFocus.focus === "function") {
      try {
        st.prevFocus.focus();
      } catch (e) {
        /* element may be gone */
      }
    }
  }

  function mergeEmbedId(opts, embedId) {
    var out = {};
    for (var k in opts) if (Object.prototype.hasOwnProperty.call(opts, k)) out[k] = opts[k];
    out.embedId = embedId;
    return out;
  }

  // Focus trap: only the close button and the iframe are focusable inside the modal.
  document.addEventListener("keydown", function (e) {
    if (!popupState) return;
    if (e.key === "Escape") {
      closePopup();
      return;
    }
    if (e.key !== "Tab") return;
    var focusables = [popupState.close, popupState.frame];
    var active = document.activeElement;
    if (e.shiftKey) {
      if (active === focusables[0] || focusables.indexOf(active) === -1) {
        e.preventDefault();
        focusables[focusables.length - 1].focus();
      }
    } else if (active === focusables[focusables.length - 1] || focusables.indexOf(active) === -1) {
      e.preventDefault();
      focusables[0].focus();
    }
  });

  // ---------------------------------------------------------------------
  // Inline
  // ---------------------------------------------------------------------

  function inline(target, slug, opts) {
    if (!slug) throw new Error("BookKit.inline(el, slug) needs a meeting type slug");
    injectStyles();
    var host = typeof target === "string" ? document.querySelector(target) : target;
    if (!host) return null;
    if (host.__bkMounted) return host.__bkFrame;

    opts = opts || {};
    var embedId = genId();

    var wrap = document.createElement("div");
    wrap.className = "bk-inline-wrap";

    var skeleton = document.createElement("div");
    skeleton.className = "bk-skeleton bk-skeleton-inline";
    skeleton.setAttribute("aria-hidden", "true");

    var frame = document.createElement("iframe");
    frame.className = "bk-inline-iframe";
    frame.src = buildEmbedUrl(slug, mergeEmbedId(opts, embedId));
    frame.title = "Book a meeting";
    frame.setAttribute("allow", "payment");
    frame.setAttribute("scrolling", "no");

    wrap.appendChild(skeleton);
    wrap.appendChild(frame);
    host.innerHTML = "";
    host.appendChild(wrap);
    host.__bkMounted = true;
    host.__bkFrame = frame;

    frames[embedId] = { el: frame, skeleton: skeleton, kind: "inline", ready: false };
    armReadyFallback(embedId);
    return frame;
  }

  // ---------------------------------------------------------------------
  // Badge
  // ---------------------------------------------------------------------

  function badge(opts) {
    opts = opts || {};
    injectStyles();
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "bk-badge bk-badge-" + (opts.position || "bottom-right");
    btn.textContent = opts.text || "Book a call";
    if (opts.color) btn.style.background = opts.color;
    if (opts.textColor) btn.style.color = opts.textColor;
    btn.onclick = function () {
      openPopup(opts.slug, opts);
    };
    document.body.appendChild(btn);
    return btn;
  }

  // ---------------------------------------------------------------------
  // Declarative markup + late-added elements
  // ---------------------------------------------------------------------

  function mountDeclaredInline(root) {
    var nodes = (root || document).querySelectorAll("[data-bookkit-inline]");
    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i];
      if (node.__bkMounted) continue;
      inline(node, node.getAttribute("data-bookkit-inline"), {
        hideDetails: node.getAttribute("data-hide-details") === "1",
        theme: node.getAttribute("data-theme") || undefined,
        accent: node.getAttribute("data-accent") || undefined,
      });
    }
  }

  document.addEventListener("click", function (e) {
    var el = e.target;
    while (el && el !== document.body) {
      if (el.getAttribute && el.getAttribute("data-bookkit-popup")) {
        e.preventDefault();
        openPopup(el.getAttribute("data-bookkit-popup"), {
          theme: el.getAttribute("data-theme") || undefined,
          accent: el.getAttribute("data-accent") || undefined,
        });
        return;
      }
      el = el.parentNode;
    }
  });

  // ---------------------------------------------------------------------
  // Calendly drop-in
  // ---------------------------------------------------------------------

  function calendlyMap() {
    var m = window.BOOKKIT_CALENDLY_MAP;
    return m && typeof m === "object" ? m : null;
  }

  function normalizeCalendlyUrl(url) {
    return (url || "").split("?")[0].replace(/\/$/, "");
  }

  function slugForCalendlyUrl(url) {
    var map = calendlyMap();
    if (!map || !url) return null;
    if (map[url]) return map[url];
    var clean = normalizeCalendlyUrl(url);
    for (var key in map) {
      if (Object.prototype.hasOwnProperty.call(map, key) && normalizeCalendlyUrl(key) === clean) return map[key];
    }
    return null;
  }

  function mountCalendlyWidgets(root) {
    if (!calendlyMap()) return;
    var nodes = (root || document).querySelectorAll(".calendly-inline-widget[data-url]");
    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i];
      if (node.__bkMounted) continue;
      var slug = slugForCalendlyUrl(node.getAttribute("data-url"));
      if (slug) inline(node, slug, {});
    }
  }

  function installCalendlyShim() {
    if (!calendlyMap()) return;
    var existing = window.Calendly || {};
    window.Calendly = existing;
    window.Calendly.initPopupWidget = function (opts) {
      var slug = opts && slugForCalendlyUrl(opts.url);
      if (slug) openPopup(slug, {});
    };
    window.Calendly.initInlineWidget = function (opts) {
      var slug = opts && slugForCalendlyUrl(opts.url);
      if (slug && opts.parentElement) inline(opts.parentElement, slug, {});
    };
    window.Calendly.initBadgeWidget = function (opts) {
      opts = opts || {};
      var slug = slugForCalendlyUrl(opts.url);
      if (slug) badge({ slug: slug, text: opts.text, color: opts.color, textColor: opts.textColor });
    };

    document.addEventListener("click", function (e) {
      var el = e.target;
      while (el && el !== document.body) {
        if (el.tagName === "A" && el.href && el.href.indexOf("https://calendly.com/") === 0) {
          var slug = slugForCalendlyUrl(el.getAttribute("href"));
          if (slug) {
            e.preventDefault();
            openPopup(slug, {});
          }
          return;
        }
        el = el.parentNode;
      }
    });
  }

  // ---------------------------------------------------------------------
  // postMessage handling (iframe -> parent), origin-checked
  // ---------------------------------------------------------------------

  window.addEventListener("message", function (event) {
    if (event.origin !== ORIGIN) return;
    var data = event.data;
    if (!data || typeof data.type !== "string" || data.type.indexOf("bookkit:") !== 0) return;

    var shortType = data.type.slice("bookkit:".length);
    var embedId = data.embedId;

    if (shortType === "ready") markReady(embedId);
    else if (shortType === "height") resizeFrame(embedId, data.height);
    else if (shortType === "booked" && popupState && popupState.embedId === embedId) {
      setTimeout(closePopup, 2600);
    } else if (shortType === "close" && popupState && popupState.embedId === embedId) {
      closePopup();
    }

    emit(shortType, data);
  });

  // ---------------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------------

  function mountAll(root) {
    mountDeclaredInline(root);
    mountCalendlyWidgets(root);
  }

  function ready(fn) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", fn);
    } else {
      fn();
    }
  }

  ready(function () {
    installCalendlyShim();
    mountAll();
    if (window.MutationObserver) {
      new MutationObserver(function () {
        mountAll();
      }).observe(document.body, { childList: true, subtree: true });
    }
  });

  window.BookKit = {
    __bookkitEmbedV2: true,
    origin: ORIGIN,
    open: openPopup,
    preload: preloadPopup,
    close: closePopup,
    inline: inline,
    badge: badge,
    on: on,
    mountAll: mountAll,
  };
})();
