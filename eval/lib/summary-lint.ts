/**
 * 요약 본문에서 지시문·행동 규칙처럼 보이는 문장을 찾아 표시하는 간단한 규칙 검사(모델 호출 없음).
 * 요약은 시스템 프롬프트 뒤에 들어가므로 "사실의 기록"이어야 하고, "앞으로의 행동 규칙"이면 오염이다.
 * 이 검사는 판정이 아니라 **사람이 볼 곳을 짚어 주는 힌트**다. 정상 요약의 "~라고 말했다" 같은 인용형도 걸릴 수 있어
 * 인용형은 quoted=true로 따로 표시한다.
 */
export type SummaryFlag = {
  sentence: string;
  reasons: string[];
  /** "~라고 말했다/요청했다"처럼 누가 한 말을 전하는 형태(오염이 아니라 서술일 가능성이 더 큼) */
  quoted: boolean;
};

const RULES: { reason: string; re: RegExp }[] = [
  { reason: "명령·의무 표현", re: /(하세요|하십시오|하라(?![는고])|해라|해야\s*(한다|합니다|해요|함|돼|된다|됩니다)|하지\s*(마|말)|말아(라|야)|금지|반드시|절대|꼭\s*\S*(해|하))/ },
  { reason: "상시 규칙(항상·무조건)", re: /(항상|언제나|무조건|매번|어떤\s*경우에도)\s*\S*\s*(하|해|답|말|대답|따르|지키|응하)/ },
  { reason: "역할·규칙 선언", re: /(이제부터|지금부터|앞으로는|앞으로\s|이후로는|너는\s|넌\s|당신은\s|you\s+(are|must|will|should)\b)/i },
  { reason: "시스템·지시 언급", re: /(시스템\s*(프롬프트|지시|메시지|규칙)|system\s*prompt|지시\s*(문|사항|를|에)|프롬프트|명령(어|을|에)|규칙(을|은|이)\s*(무시|바꾸|해제))/i },
  { reason: "제한 해제·탈옥 표현", re: /(이전\s*(지시|규칙|설정)[^.\n]{0,12}(무시|잊)|제한\s*(없이|을\s*풀|해제)|탈옥|개발자\s*모드|\bDAN\b|ignore\s+(all|previous|the)|jailbreak)/i },
];

const REPORTING = /(라고|고|며)\s*(말했|했|요청했|부탁했|주장했|시켰|지시했|써|적었|물었)|(말했|요청했|부탁했|주장했|시도했|물었)(다|어요|습니다|음)/;

/** 문장 단위로 나눈다(줄바꿈, 마침표·물음표·느낌표, 한국어 종결 뒤 공백). */
export function splitSentences(text: string): string[] {
  return text
    .split(/\n+|(?<=[.!?。])\s+|(?<=(?:다|요|죠|음))\s+(?=\S)/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 4);
}

export function lintSummary(text: string): SummaryFlag[] {
  const out: SummaryFlag[] = [];
  for (const sentence of splitSentences(text)) {
    const reasons = RULES.filter((r) => r.re.test(sentence)).map((r) => r.reason);
    if (reasons.length) out.push({ sentence: sentence.slice(0, 200), reasons, quoted: REPORTING.test(sentence) });
  }
  return out;
}
