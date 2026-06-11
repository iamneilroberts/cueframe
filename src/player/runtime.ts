/**
 * Cueframe player runtime (D5) — self-contained vanilla browser JS as a string.
 *
 * This string is inlined into the exported HTML (see template.ts). It must NOT import
 * anything or rely on any framework, so the HTML export is one self-contained file.
 *
 * It reads `window.__CUEFRAME__ = { spec, timeline, assets?, baseHref?, autoplay? }` and:
 *   - Builds a stage sized to spec.meta.viewport aspect, scaled to fit its container.
 *   - Renders the active golden frame's screenshot + the callouts whose appear window
 *     contains the current time, anchored via the frame's matching `box.rect`
 *     (scaled to stage size), else the callout's manual rect, else parked centre.
 *   - Exposes `window.__CUEFRAME_PLAYER__ = { renderAt(ms), durationMs, totalFrames, segments }`
 *     where renderAt is a PURE function of time (deterministic for headless recording).
 *   - Autoplays via requestAnimationFrame (a virtual clock) unless autoplay === false.
 *   - Sets `window.__CUEFRAME_READY__ = true` after the first render.
 */

export const RUNTIME_JS = String.raw`(function () {
  "use strict";
  var DATA = window.__CUEFRAME__ || {};
  var spec = DATA.spec || { meta: { viewport: { w: 1280, h: 800 } }, frames: [], callouts: [] };
  var timeline = DATA.timeline || { segments: [], durationMs: 0 };
  var assets = DATA.assets || {};
  var baseHref = DATA.baseHref || "";
  var autoplay = DATA.autoplay !== false;

  var viewport = (spec.meta && spec.meta.viewport) || { w: 1280, h: 800 };
  var VW = viewport.w || 1280;
  var VH = viewport.h || 800;

  // --- index helpers ---
  var framesById = {};
  (spec.frames || []).forEach(function (f) { framesById[f.id] = f; });
  var calloutsById = {};
  (spec.callouts || []).forEach(function (c) { calloutsById[c.id] = c; });

  // --- DOM scaffold ---
  function el(tag, cls) { var e = document.createElement(tag); if (cls) e.className = cls; return e; }

  var host = document.getElementById("cueframe-stage") || document.body;
  var root = el("div", "cf-root");
  var stage = el("div", "cf-stage");
  var imgEl = el("img", "cf-frame-img");
  imgEl.alt = "";
  imgEl.draggable = false;
  var layer = el("div", "cf-callout-layer");
  stage.appendChild(imgEl);
  stage.appendChild(layer);
  root.appendChild(stage);
  host.appendChild(root);

  // --- styles (inlined, scoped to .cf- classes) ---
  var css = ""
    + ".cf-root{position:relative;width:100%;height:100%;display:flex;align-items:center;justify-content:center;overflow:hidden;background:#0b0d10;}"
    + ".cf-stage{position:relative;overflow:hidden;background:#fff;box-shadow:0 10px 40px rgba(0,0,0,.45);}"
    + ".cf-frame-img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block;}"
    + ".cf-callout-layer{position:absolute;inset:0;pointer-events:none;}"
    + ".cf-dim{position:absolute;inset:0;background:rgba(8,10,14,.55);transition:opacity .2s;}"
    + ".cf-ring{position:absolute;border:3px solid #5b9dff;border-radius:8px;box-shadow:0 0 0 3px rgba(91,157,255,.35),0 0 24px rgba(91,157,255,.5);}"
    + ".cf-card{position:absolute;max-width:300px;min-width:160px;background:rgba(17,20,26,.96);color:#f4f6fb;border:1px solid rgba(255,255,255,.12);border-radius:12px;padding:12px 14px;box-shadow:0 12px 32px rgba(0,0,0,.5);font:14px/1.45 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;}"
    + ".cf-eyebrow{font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#8fb4ff;margin:0 0 4px;font-weight:600;}"
    + ".cf-title{font-size:15px;font-weight:650;margin:0 0 4px;}"
    + ".cf-body{font-size:13px;color:#c9d2e0;margin:0;}"
    + ".cf-arrow{position:absolute;width:0;height:0;}"
    + ".cf-arrow-line{position:absolute;height:2px;background:#5b9dff;transform-origin:0 50%;box-shadow:0 0 6px rgba(91,157,255,.6);}"
    + ".cf-arrow-head{position:absolute;width:0;height:0;border-left:9px solid #5b9dff;border-top:6px solid transparent;border-bottom:6px solid transparent;}";
  var styleEl = el("style");
  styleEl.textContent = css;
  document.head.appendChild(styleEl);

  // --- sizing: fit stage into root while preserving viewport aspect ---
  var stageW = VW, stageH = VH, scale = 1;
  function fit() {
    var rw = root.clientWidth || VW;
    var rh = root.clientHeight || VH;
    if (rw <= 0 || rh <= 0) { rw = VW; rh = VH; }
    var s = Math.min(rw / VW, rh / VH);
    if (!isFinite(s) || s <= 0) s = 1;
    scale = s;
    stageW = Math.round(VW * s);
    stageH = Math.round(VH * s);
    stage.style.width = stageW + "px";
    stage.style.height = stageH + "px";
  }
  fit();
  window.addEventListener("resize", function () { fit(); renderAt(currentMs); });

  // --- frame image resolution ---
  function imgSrc(frame) {
    if (!frame) return "";
    if (assets && Object.prototype.hasOwnProperty.call(assets, frame.img)) return assets[frame.img];
    return (baseHref || "") + frame.img;
  }

  // --- anchor resolution: selector -> frame box rect; else manual rect; else null (park) ---
  function resolveRect(frame, callout) {
    var anchor = callout && callout.anchor;
    if (anchor && anchor.selector && frame && frame.boxes) {
      for (var i = 0; i < frame.boxes.length; i++) {
        if (frame.boxes[i].selector === anchor.selector) return frame.boxes[i].rect;
      }
    }
    if (anchor && anchor.rect) return anchor.rect;
    return null;
  }

  // scale a capture-viewport rect to stage pixels
  function scaleRect(r) {
    return { x: r.x * scale, y: r.y * scale, w: r.w * scale, h: r.h * scale };
  }

  // --- segment lookup for a given time (clamped) ---
  function segmentAt(ms) {
    var segs = timeline.segments || [];
    if (segs.length === 0) return null;
    var t = ms;
    if (t < 0) t = 0;
    if (t >= timeline.durationMs) t = timeline.durationMs - 1;
    for (var i = 0; i < segs.length; i++) {
      if (t >= segs[i].startMs && t < segs[i].endMs) return segs[i];
    }
    return segs[segs.length - 1];
  }

  // --- callout element builders ---
  function clampCardPos(left, top, cardW, cardH) {
    if (left + cardW > stageW) left = stageW - cardW - 8;
    if (left < 8) left = 8;
    if (top + cardH > stageH) top = stageH - cardH - 8;
    if (top < 8) top = 8;
    return { left: left, top: top };
  }

  function buildCard(callout) {
    var card = el("div", "cf-card");
    if (callout.eyebrow) { var eb = el("div", "cf-eyebrow"); eb.textContent = callout.eyebrow; card.appendChild(eb); }
    var ti = el("div", "cf-title"); ti.textContent = callout.title || ""; card.appendChild(ti);
    if (callout.body) { var bd = el("div", "cf-body"); bd.textContent = callout.body; card.appendChild(bd); }
    return card;
  }

  function renderCallout(frame, callout) {
    var style = callout.style || "card";
    var rect = resolveRect(frame, callout);
    var sRect = rect ? scaleRect(rect) : null;

    if (style === "spotlight") {
      var dim = el("div", "cf-dim");
      layer.appendChild(dim);
      if (sRect) {
        var ring = el("div", "cf-ring");
        var pad = 6;
        ring.style.left = (sRect.x - pad) + "px";
        ring.style.top = (sRect.y - pad) + "px";
        ring.style.width = (sRect.w + pad * 2) + "px";
        ring.style.height = (sRect.h + pad * 2) + "px";
        layer.appendChild(ring);
      }
    } else if (style === "arrow" && sRect) {
      // arrow drawn from card toward the rect; handled after card placement below
    }

    // card placement: beside the rect if present, else parked centre
    var card = buildCard(callout);
    card.style.visibility = "hidden";
    layer.appendChild(card);
    // measure
    var cardW = card.offsetWidth || 220;
    var cardH = card.offsetHeight || 80;

    var pos;
    var targetCx = stageW / 2, targetCy = stageH / 2;
    if (sRect) {
      targetCx = sRect.x + sRect.w / 2;
      targetCy = sRect.y + sRect.h / 2;
      // prefer placing card to the right of the rect, else left, else below
      var left = sRect.x + sRect.w + 16;
      var top = sRect.y;
      if (left + cardW > stageW) left = sRect.x - cardW - 16;
      if (left < 8) { left = sRect.x; top = sRect.y + sRect.h + 16; }
      pos = clampCardPos(left, top, cardW, cardH);
    } else {
      pos = clampCardPos((stageW - cardW) / 2, (stageH - cardH) / 2, cardW, cardH);
    }
    card.style.left = pos.left + "px";
    card.style.top = pos.top + "px";
    card.style.visibility = "visible";

    if (style === "arrow" && sRect) {
      var fromX = pos.left + cardW / 2;
      var fromY = pos.top + cardH / 2;
      var dx = targetCx - fromX, dy = targetCy - fromY;
      var len = Math.sqrt(dx * dx + dy * dy);
      var ang = Math.atan2(dy, dx) * 180 / Math.PI;
      var line = el("div", "cf-arrow-line");
      line.style.left = fromX + "px";
      line.style.top = fromY + "px";
      line.style.width = Math.max(0, len - 10) + "px";
      line.style.transform = "rotate(" + ang + "deg)";
      layer.appendChild(line);
      var head = el("div", "cf-arrow-head");
      head.style.left = targetCx + "px";
      head.style.top = (targetCy - 6) + "px";
      head.style.transform = "rotate(" + ang + "deg)";
      head.style.transformOrigin = "0 50%";
      layer.appendChild(head);
    }
  }

  // --- the pure render: given ms, paint frame + active callouts ---
  var currentMs = 0;
  var currentFrameId = null;
  function renderAt(ms) {
    currentMs = ms;
    var seg = segmentAt(ms);
    layer.innerHTML = "";
    if (!seg) return;
    var frame = framesById[seg.frameId];
    var src = imgSrc(frame);
    if (currentFrameId !== seg.frameId) {
      imgEl.src = src;
      currentFrameId = seg.frameId;
    } else if (imgEl.src === "" && src) {
      imgEl.src = src;
    }
    // active callouts: appearMs <= ms < appearMs + dwellMs
    var cos = seg.callouts || [];
    for (var i = 0; i < cos.length; i++) {
      var tc = cos[i];
      if (ms >= tc.appearMs && ms < tc.appearMs + tc.dwellMs) {
        var callout = calloutsById[tc.id];
        if (callout) renderCallout(frame, callout);
      }
    }
  }

  // --- public API for headless recorder ---
  window.__CUEFRAME_PLAYER__ = {
    renderAt: renderAt,
    durationMs: timeline.durationMs || 0,
    totalFrames: (timeline.segments || []).length,
    segments: timeline.segments || []
  };

  // first render + readiness signal
  function signalReady() {
    if (imgEl.complete || !imgEl.src) {
      window.__CUEFRAME_READY__ = true;
    } else {
      imgEl.addEventListener("load", function () { window.__CUEFRAME_READY__ = true; }, { once: true });
      imgEl.addEventListener("error", function () { window.__CUEFRAME_READY__ = true; }, { once: true });
    }
  }
  renderAt(0);
  signalReady();

  // --- autoplay: virtual clock via rAF; optional play/pause + scrub ---
  var playing = autoplay;
  var lastTs = null;
  var dur = timeline.durationMs || 0;
  function loop(ts) {
    if (lastTs == null) lastTs = ts;
    var delta = ts - lastTs;
    lastTs = ts;
    if (playing && dur > 0) {
      currentMs += delta;
      if (currentMs >= dur) currentMs = currentMs % dur;
      renderAt(currentMs);
    }
    requestAnimationFrame(loop);
  }
  if (autoplay && dur > 0) {
    requestAnimationFrame(loop);
  }

  // light keyboard controls (no-op when autoplay false and dur 0)
  window.addEventListener("keydown", function (e) {
    if (e.code === "Space") { e.preventDefault(); playing = !playing; lastTs = null; }
    else if (e.code === "ArrowRight") { playing = false; currentMs = Math.min(dur, currentMs + 1000); renderAt(currentMs); }
    else if (e.code === "ArrowLeft") { playing = false; currentMs = Math.max(0, currentMs - 1000); renderAt(currentMs); }
  });
})();`;
