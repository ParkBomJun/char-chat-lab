/** SSE 프레임 증분 파서. 서버(업스트림 읽기)와 클라이언트(우리 SSE 읽기) 양쪽에서 쓴다. */
export type SseFrame = { event: string; data: string };

export class SseParser {
  private buffer = "";

  /** 청크를 넣으면 완성된 프레임만 돌려준다. 청크 경계에서 쪼개진 프레임은 다음 호출로 넘어간다. */
  feed(chunk: string): SseFrame[] {
    this.buffer += chunk.replace(/\r\n/g, "\n");
    const frames: SseFrame[] = [];
    let idx: number;
    while ((idx = this.buffer.indexOf("\n\n")) !== -1) {
      const raw = this.buffer.slice(0, idx);
      this.buffer = this.buffer.slice(idx + 2);
      const frame = parseFrame(raw);
      if (frame) frames.push(frame);
    }
    return frames;
  }
}

function parseFrame(raw: string): SseFrame | null {
  let event = "message";
  const data: string[] = [];
  for (const line of raw.split("\n")) {
    if (line === "" || line.startsWith(":")) continue; // 빈 줄·주석(keep-alive)
    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? "" : line.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "event") event = value;
    else if (field === "data") data.push(value);
  }
  return data.length ? { event, data: data.join("\n") } : null;
}

/** 서버 → 클라이언트로 보내는 프레임 직렬화. data는 항상 JSON 한 줄. */
export function formatSse(event: string, payload: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
}
