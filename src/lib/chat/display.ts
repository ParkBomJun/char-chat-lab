/** 화면 표시 전용 도우미. 저장된 글은 건드리지 않는다. */

/** 이름 뒤 주격 조사: 받침이 있으면 "이", 없으면 "가". 한글이 아니면 "가". */
export function subjectParticle(name: string): "이" | "가" {
  const last = name.trim().slice(-1);
  const code = last.charCodeAt(0);
  if (Number.isNaN(code) || code < 0xac00 || code > 0xd7a3) return "가";
  return (code - 0xac00) % 28 === 0 ? "가" : "이";
}

export type Piece = { text: string; act: boolean };

/** 괄호 안 행동 묘사(40자 이하)를 가려낸다. 조각을 이어 붙이면 원문과 같다. */
export function splitActions(line: string): Piece[] {
  const out: Piece[] = [];
  const re = /\([^()]{1,40}\)/g;
  let last = 0;
  for (const m of line.matchAll(re)) {
    if (m.index > last) out.push({ text: line.slice(last, m.index), act: false });
    out.push({ text: m[0], act: true });
    last = m.index + m[0].length;
  }
  if (last < line.length) out.push({ text: line.slice(last), act: false });
  return out;
}

/** 안내문에서 전화번호(109·112·119)를 가려낸다. 조각을 이어 붙이면 원문과 같다. */
export function splitHotlines(line: string): { text: string; strong: boolean }[] {
  return line
    .split(/(?<!\d)(109|112|119)(?!\d)/)
    .filter((t) => t !== "")
    .map((text) => ({ text, strong: text === "109" || text === "112" || text === "119" }));
}
