/*!
 * BookKit embed widget — MIT.
 *
 *   <script src="https://YOUR-INSTANCE/widget.js" defer></script>
 *
 * Popup:  <button onclick="BookKit.popup('strategy-call')">Book a call</button>
 * Inline: <div data-bookkit="strategy-call" data-theme="dark" data-primary-color="#FF6A00"></div>
 *
 * Events (also forwarded as DOM CustomEvents on window):
 *   bookkit.time_selected | bookkit.booked | bookkit.checkout | bookkit.closed
 */
(function () {
  "use strict";

  if (window.BookKit && window.BookKit.__loaded) return;

  var script = document.currentScript;
  if (!script) {
    var all = document.getElementsByTagName("script");
    for (var i = all.length - 1; i >= 0; i--) {
      if (all[i].src && all[i].src.indexOf("widget.js") !== -1) {
        script = all[i];
        break;
      }
    }
  }

  var ORIGIN = (function () {
    try {
      return new URL(script.src).origin;
    } catch (e) {
      return window.location.origin;
    }
  })();

  var STYLE_ID = "bookkit-styles";

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    var css =
      ".bookkit-overlay{position:fixed;inset:0;z-index:2147483000;background:rgba(6,6,8,.72);" +
      "backdrop-filter:blur(3px);display:flex;align-items:center;justify-content:center;padding:16px;" +
      "opacity:0;transition:opacity .18s ease}" +
      ".bookkit-overlay.is-open{opacity:1}" +
      ".bookkit-modal{position:relative;width:100%;max-width:860px;height:min(88vh,760px);" +
      "border-radius:16px;overflow:hidden;box-shadow:0 24px 70px rgba(0,0,0,.5);" +
      "transform:translateY(8px);transition:transform .18s ease}" +
      ".bookkit-overlay.is-open .bookkit-modal{transform:none}" +
      ".bookkit-modal iframe{width:100%;height:100%;border:0;display:block;background:transparent}" +
      ".bookkit-close{position:absolute;top:10px;right:10px;width:32px;height:32px;border:0;" +
      "border-radius:999px;background:rgba(20,20,22,.9);color:#fff;font-size:19px;line-height:1;" +
      "cursor:pointer;display:flex;align-items:center;justify-content:center}" +
      ".bookkit-close:hover{background:rgba(40,40,44,.95)}" +
      ".bookkit-inline{width:100%;border:0;display:block;background:transparent;min-height:520px;" +
      "transition:height .15s ease}" +
      "@media (max-width:640px){.bookkit-modal{height:92vh;max-width:100%}}";
    var el = document.createElement("style");
    el.id = STYLE_ID;
    el.appendChild(document.createTextNode(css));
    document.head.appendChild(el);
  }

  function embedUrl(slug, opts) {
    opts = opts || {};
    var url = ORIGIN + "/embed/" + encodeURIComponent(slug);
    var params = [];
    if (opts.theme) params.push("theme=" + encodeURIComponent(opts.theme));
    if (opts.primaryColor) {
      params.push("primaryColor=" + encodeURIComponent(String(opts.primaryColor).replace("#", "")));
    }
    if (opts.hideDescription) params.push("hideDescription=1");
    if (opts.hideHeader) params.push("hideHeader=1");
    return params.length ? url + "?" + params.join("&") : url;
  }

  function emit(type, detail) {
    try {
      window.dispatchEvent(new CustomEvent(type, { detail: detail }));
    } catch (e) {
      /* very old browser */
    }
    var handlers = listeners[type] || [];
    for (var i = 0; i < handlers.length; i++) {
      try {
        handlers[i](detail);
      } catch (e) {
        /* host callback threw */
      }
    }
  }

  var listeners = {};
  var openOverlay = null;

  function closeOverlay() {
    if (!openOverlay) return;
    var node = openOverlay;
    openOverlay = null;
    node.classList.remove("is-open");
    document.documentElement.style.overflow = node.__prevOverflow || "";
    setTimeout(function () {
      if (node.parentNode) node.parentNode.removeChild(node);
    }, 180);
    emit("bookkit.closed", {});
  }

  function popup(slug, opts) {
    if (!slug) throw new Error("BookKit.popup(slug) needs a meeting type slug");
    injectStyles();
    closeOverlay();

    var overlay = document.createElement("div");
    overlay.className = "bookkit-overlay";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");

    var modal = document.createElement("div");
    modal.className = "bookkit-modal";

    var frame = document.createElement("iframe");
    frame.src = embedUrl(slug, opts);
    frame.setAttribute("title", "Booking");
    frame.setAttribute("allow", "payment");

    var close = document.createElement("button");
    close.className = "bookkit-close";
    close.setAttribute("aria-label", "Close booking");
    close.innerHTML = "&times;";
    close.onclick = closeOverlay;

    modal.appendChild(frame);
    modal.appendChild(close);
    overlay.appendChild(modal);

    overlay.addEventListener("click", function (e) {
      if (e.target === overlay) closeOverlay();
    });

    overlay.__prevOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    document.body.appendChild(overlay);

    // next frame so the transition runs
    requestAnimationFrame(function () {
      overlay.classList.add("is-open");
    });

    openOverlay = overlay;
    return { close: closeOverlay };
  }

  function inline(target, slug, opts) {
    injectStyles();
    var host = typeof target === "string" ? document.querySelector(target) : target;
    if (!host) return null;
    if (host.__bookkitMounted) return host.__bookkitFrame;

    var frame = document.createElement("iframe");
    frame.className = "bookkit-inline";
    frame.src = embedUrl(slug, opts);
    frame.setAttribute("title", "Booking");
    frame.setAttribute("allow", "payment");
    frame.setAttribute("scrolling", "no");

    host.innerHTML = "";
    host.appendChild(frame);
    host.__bookkitMounted = true;
    host.__bookkitFrame = frame;
    return frame;
  }

  function mountAll(root) {
    var nodes = (root || document).querySelectorAll("[data-bookkit]");
    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i];
      if (node.__bookkitMounted) continue;
      inline(node, node.getAttribute("data-bookkit"), {
        theme: node.getAttribute("data-theme") || undefined,
        primaryColor: node.getAttribute("data-primary-color") || undefined,
        hideDescription: node.getAttribute("data-hide-description") === "true",
        hideHeader: node.getAttribute("data-hide-header") === "true",
      });
    }
  }

  window.addEventListener("message", function (event) {
    if (event.origin !== ORIGIN) return;
    var data = event.data;
    if (!data || typeof data.type !== "string" || data.type.indexOf("bookkit.") !== 0) return;

    if (data.type === "bookkit.resize") {
      var frames = document.querySelectorAll("iframe.bookkit-inline");
      for (var i = 0; i < frames.length; i++) {
        if (frames[i].contentWindow === event.source) {
          frames[i].style.height = Math.max(320, data.height) + "px";
        }
      }
      return;
    }

    emit(data.type, data);

    // A popup that completed a free booking closes itself shortly after.
    if (data.type === "bookkit.booked" && openOverlay) {
      setTimeout(closeOverlay, 2600);
    }
  });

  function ready(fn) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", fn);
    } else {
      fn();
    }
  }

  ready(function () {
    mountAll();
    // Pick up divs injected later (SPA routes, CMS blocks).
    if (window.MutationObserver) {
      new MutationObserver(function () {
        mountAll();
      }).observe(document.body, { childList: true, subtree: true });
    }
  });

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") closeOverlay();
  });

  // <a href="..." data-bookkit-popup="slug"> also opens the popup.
  document.addEventListener("click", function (e) {
    var el = e.target;
    while (el && el !== document.body) {
      if (el.getAttribute && el.getAttribute("data-bookkit-popup")) {
        e.preventDefault();
        popup(el.getAttribute("data-bookkit-popup"), {
          theme: el.getAttribute("data-theme") || undefined,
          primaryColor: el.getAttribute("data-primary-color") || undefined,
        });
        return;
      }
      el = el.parentNode;
    }
  });

  window.BookKit = {
    __loaded: true,
    origin: ORIGIN,
    popup: popup,
    inline: inline,
    mountAll: mountAll,
    close: closeOverlay,
    url: embedUrl,
    on: function (type, handler) {
      (listeners[type] = listeners[type] || []).push(handler);
      return function off() {
        listeners[type] = (listeners[type] || []).filter(function (h) {
          return h !== handler;
        });
      };
    },
  };
})();
