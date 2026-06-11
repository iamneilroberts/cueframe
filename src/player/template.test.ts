import { describe, it, expect } from "vitest";
import type { Spec } from "../spec/index.js";
import { renderPlayerHtml } from "./template.js";
import { RUNTIME_JS } from "./runtime.js";

function baseSpec(): Spec {
  return {
    meta: { title: "My Demo", app: "todo", createdAt: "2026-01-01", viewport: { w: 800, h: 600 } },
    frames: [
      {
        id: "f1",
        n: 1,
        kind: "golden",
        img: "frames/f1.png",
        caption: "first",
        axDigest: "ax1",
        boxes: [{ selector: "#a", rect: { x: 1, y: 2, w: 3, h: 4 } }],
      },
    ],
    callouts: [{ id: "c1", frame: "f1", title: "Hello" }],
  };
}

describe("renderPlayerHtml", () => {
  it("produces a complete HTML document with the title", () => {
    const html = renderPlayerHtml(baseSpec());
    expect(html.startsWith("<!DOCTYPE html>")).toBe(true);
    expect(html).toContain("<title>My Demo</title>");
    expect(html).toContain('id="cueframe-stage"');
  });

  it("uses an explicit title option when given", () => {
    const html = renderPlayerHtml(baseSpec(), { title: "Override" });
    expect(html).toContain("<title>Override</title>");
  });

  it("embeds the serialized spec and a built timeline", () => {
    const html = renderPlayerHtml(baseSpec());
    expect(html).toContain("window.__CUEFRAME__ =");
    expect(html).toContain('"frames"');
    expect(html).toContain('"timeline"');
    expect(html).toContain('"segments"');
    // callout title survives serialization
    expect(html).toContain("Hello");
  });

  it("inlines the RUNTIME_JS", () => {
    const html = renderPlayerHtml(baseSpec());
    expect(html).toContain(RUNTIME_JS);
    expect(html).toContain("__CUEFRAME_PLAYER__");
    expect(html).toContain("__CUEFRAME_READY__");
  });

  it("does not break out of the script tag when spec contains </script>", () => {
    const s = baseSpec();
    s.callouts[0]!.title = "evil </script><script>alert(1)</script>";
    const html = renderPlayerHtml(s);
    // Isolate the data-script payload (between `= ` and the element's own `;</script>`).
    const dataLine = html.split("\n").find((l) => l.includes("window.__CUEFRAME__ ="))!;
    const payload = dataLine.slice(
      dataLine.indexOf("= ") + 2,
      dataLine.lastIndexOf(";</script>"),
    );
    // The injected closing tag must NOT survive un-escaped inside the JSON payload.
    expect(payload).not.toContain("</script>");
    expect(payload).toContain("\\u003c/script\\u003e");
  });

  it("with assets, contains data:image/png and no external http refs", () => {
    const assets = { "frames/f1.png": "data:image/png;base64,AAAA" };
    const html = renderPlayerHtml(baseSpec(), { assets });
    expect(html).toContain("data:image/png");
    // no external http(s) asset refs
    expect(/https?:\/\//.test(html)).toBe(false);
  });

  it("autoplay defaults to true, can be disabled", () => {
    expect(renderPlayerHtml(baseSpec())).toContain('"autoplay":true');
    expect(renderPlayerHtml(baseSpec(), { autoplay: false })).toContain('"autoplay":false');
  });
});
