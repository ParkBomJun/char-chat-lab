/** 판정 표시: BLOCK·ERROR에만 작은 빨간 표시, 그 밖(ALLOW)은 흐린 글 */
export function Verdict({ v }: { v: string }) {
  return v === "BLOCK" || v === "ERROR" ? <span className="tag-block">{v}</span> : <span className="dim">{v}</span>;
}
