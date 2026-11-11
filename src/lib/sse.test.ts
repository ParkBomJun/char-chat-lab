import { describe, expect, it } from "vitest";
import { SseParser, formatSse } from "./sse";

describe("SseParser", () => {
  it("한 청크에 여러 프레임", () => {
    const p = new SseParser();
    expect(p.feed('event: delta\ndata: {"t":"a"}\n\ndata: [DONE]\n\n')).toEqual([
      { event: "delta", data: '{"t":"a"}' },
      { event: "message", data: "[DONE]" },
    ]);
  });
  it("청크 경계에서 쪼개진 프레임을 이어 붙인다", () => {
    const p = new SseParser();
    expect(p.feed("event: de")).toEqual([]);
    expect(p.feed("lta\ndata: 안")).toEqual([]);
    expect(p.feed("녕\n\n")).toEqual([{ event: "delta", data: "안녕" }]);
  });
  it("CRLF와 주석 줄 처리", () => {
    const p = new SseParser();
    expect(p.feed(": keep-alive\r\n\r\ndata: x\r\n\r\n")).toEqual([{ event: "message", data: "x" }]);
  });
  it("formatSse 왕복", () => {
    const p = new SseParser();
    const frames = p.feed(formatSse("delta", { text: "줄\n바꿈" }));
    expect(JSON.parse(frames[0].data)).toEqual({ text: "줄\n바꿈" });
  });
});
