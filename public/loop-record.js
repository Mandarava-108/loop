/* Loop session recording snippet.
 *
 * Add to every page of the site being tested:
 *   <script src="https://YOUR-LOOP-APP-DOMAIN/loop-record.js" defer></script>
 *
 * Records DOM interactions (rrweb) ONLY while the site is embedded in a Loop
 * test runner AND the participant has consented — the runner signals that by
 * appending ?loop_session=<id> to the iframe URL and/or posting a
 * {type:"loop:start", sessionId} message. Idle on all normal visits.
 * Text typed into form fields is masked (maskAllInputs) — we record that
 * typing happened, never what was typed.
 */
(function () {
  "use strict";
  if (window.__loopRecordLoaded) return;
  window.__loopRecordLoaded = true;

  // Only ever record inside an embedding frame (the Loop runner).
  var embedded;
  try {
    embedded = window.self !== window.top;
  } catch (e) {
    embedded = true;
  }
  if (!embedded) return;

  var script = document.currentScript;
  var origin;
  try {
    origin = new URL(script.src).origin;
  } catch (e) {
    return;
  }
  var INGEST = origin + "/api/rrweb/ingest";
  var MAX_BATCH_EVENTS = 200;
  var FLUSH_MS = 5000;

  var sessionId = null;
  var started = false;
  var stopped = false;
  var stopFn = null;
  var buf = [];

  function post(msg) {
    try {
      window.parent.postMessage(msg, "*");
    } catch (e) {}
  }

  function hello() {
    post({ type: "loop:rrweb:hello" });
  }

  function flush(useBeacon) {
    if (buf.length === 0 || !sessionId) return;
    var events = buf;
    buf = [];
    var body = JSON.stringify({ sessionId: sessionId, events: events });
    // text/plain keeps these "simple" cross-origin requests (no preflight);
    // the ingest endpoint parses the body as JSON regardless.
    if (useBeacon && navigator.sendBeacon) {
      try {
        // sendBeacon returns false when the payload is too large (~64KB) —
        // fall through to a normal fetch in that case.
        if (
          navigator.sendBeacon(INGEST, new Blob([body], { type: "text/plain" }))
        ) {
          return;
        }
      } catch (e) {}
    }
    // NOTE: no keepalive — Chrome rejects keepalive bodies over 64KB, and
    // rrweb full snapshots regularly exceed that.
    fetch(INGEST, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: body,
    })
      .then(function (res) {
        // Server hiccup (5xx): retry these events on the next flush.
        // 4xx (ineligible/invalid session) is final — don't loop forever.
        if (!res.ok && res.status >= 500) {
          buf = events.concat(buf);
        }
      })
      .catch(function () {
        // Network error: put events back so the next flush retries them.
        buf = events.concat(buf);
      });
  }

  function start(id) {
    if (started || stopped || !id) return;
    started = true;
    sessionId = id;
    try {
      sessionStorage.setItem("loop_session", id);
    } catch (e) {}

    loadRrweb(function () {
      if (!window.rrweb || typeof window.rrweb.record !== "function") return;
      try {
        stopFn = window.rrweb.record({
          emit: function (ev) {
            buf.push(ev);
            if (buf.length >= MAX_BATCH_EVENTS) flush(false);
          },
          maskAllInputs: true, // record THAT typing happened, not WHAT
          sampling: { mousemove: 50, scroll: 100 },
        });
      } catch (e) {
        return;
      }
      post({ type: "loop:rrweb:started", sessionId: id });
      setInterval(function () {
        flush(false);
      }, FLUSH_MS);
      window.addEventListener("pagehide", function () {
        flush(true);
      });
      document.addEventListener("visibilitychange", function () {
        if (document.visibilityState === "hidden") flush(true);
      });
    });
  }

  function stop() {
    stopped = true;
    if (stopFn) {
      try {
        stopFn();
      } catch (e) {}
      stopFn = null;
    }
    flush(true);
    try {
      sessionStorage.removeItem("loop_session");
    } catch (e) {}
  }

  function loadRrweb(cb) {
    if (window.rrweb) return cb();
    var s = document.createElement("script");
    s.src = origin + "/rrweb.min.js";
    s.onload = cb;
    document.head.appendChild(s);
  }

  window.addEventListener("message", function (e) {
    var d = e.data;
    if (!d || typeof d !== "object") return;
    if (d.type === "loop:probe") hello();
    else if (d.type === "loop:start" && d.sessionId) start(d.sessionId);
    else if (d.type === "loop:stop") stop();
  });

  // Announce presence so the runner knows rrweb capture is available here.
  hello();
  setTimeout(hello, 500);
  setTimeout(hello, 1500);

  // Session id via URL param (runner appends it after consent), or carried
  // over from a previous page of the same visit (in-site navigation).
  var fromUrl = null;
  try {
    fromUrl = new URL(window.location.href).searchParams.get("loop_session");
  } catch (e) {}
  var fromStorage = null;
  try {
    fromStorage = sessionStorage.getItem("loop_session");
  } catch (e) {}
  if (fromUrl || fromStorage) start(fromUrl || fromStorage);
})();
