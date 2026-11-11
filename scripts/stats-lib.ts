/** 스크립트용 통계 도우미(순수 함수). */

/** 선형 보간 분위수. q는 0~1. 빈 배열이면 null. */
export function quantile(values: readonly number[], q: number): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const pos = (s.length - 1) * Math.min(1, Math.max(0, q));
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}

export type CalibRow = { model: string; input: number; est: number };

export type Calibration = {
  n: number;
  /** Σ실제 / Σ추정: 토큰이 많은 요청에 가중된 배율. 조립기 환산 계수 후보 */
  weighted: number | null;
  /** 요청별 배율(실제/추정)의 중앙값·p10·p90 */
  median: number | null;
  p10: number | null;
  p90: number | null;
  /** 최소제곱 직선 실제 = a × 추정 + b. 점이 2개 미만이거나 추정값이 모두 같으면 null */
  fit: { a: number; b: number } | null;
};

/** 실제 prompt_tokens와 조립기 추정(blockTokens.total)을 비교한다. 추정이 0 이하인 행은 제외. */
export function calibrate(rows: readonly CalibRow[]): Calibration {
  const ok = rows.filter((r) => r.est > 0 && r.input > 0);
  const ratios = ok.map((r) => r.input / r.est);
  const sumIn = ok.reduce((n, r) => n + r.input, 0);
  const sumEst = ok.reduce((n, r) => n + r.est, 0);
  let fit: Calibration["fit"] = null;
  if (ok.length >= 2) {
    const mx = sumEst / ok.length;
    const my = sumIn / ok.length;
    const sxx = ok.reduce((n, r) => n + (r.est - mx) ** 2, 0);
    if (sxx > 0) {
      const a = ok.reduce((n, r) => n + (r.est - mx) * (r.input - my), 0) / sxx;
      fit = { a, b: my - a * mx };
    }
  }
  return {
    n: ok.length,
    weighted: sumEst > 0 ? sumIn / sumEst : null,
    median: quantile(ratios, 0.5),
    p10: quantile(ratios, 0.1),
    p90: quantile(ratios, 0.9),
    fit,
  };
}
