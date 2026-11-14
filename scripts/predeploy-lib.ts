import { signupEnabled } from "../src/lib/demo-mode";

/** 배포 전 환경 점검(순수 함수). 오류가 있으면 배포하면 안 되고, 경고는 알고 넘어갈 수 있다. */
export type Finding = { level: "error" | "warn"; message: string };

type Env = Record<string, string | undefined>;

/** .env.example의 개발용 값. 이 값 그대로 공개 배포하면 안 된다. */
const EXAMPLE_PASSWORDS = new Set(["demo-password-1234", "admin-password-1234"]);
const EXAMPLE_EMAILS = new Set(["demo@example.com", "admin@example.com"]);

const v = (env: Env, k: string) => env[k]?.trim() ?? "";

export function checkDeployEnv(env: Env, opts: { pricedModels?: string[] } = {}): Finding[] {
  const out: Finding[] = [];
  const err = (message: string) => out.push({ level: "error", message });
  const warn = (message: string) => out.push({ level: "warn", message });

  // docker-compose.prod.yml은 POSTGRES_PASSWORD로 DATABASE_URL을 조립한다. 다른 호스팅이면 DATABASE_URL을 직접 준다.
  const dbPw = v(env, "POSTGRES_PASSWORD");
  if (!v(env, "DATABASE_URL") && !dbPw) err("DATABASE_URL(또는 compose용 POSTGRES_PASSWORD)이 비어 있습니다.");
  if (!v(env, "DATABASE_URL") && dbPw && (dbPw.length < 12 || dbPw === "chatlab")) err("POSTGRES_PASSWORD가 약합니다(12자 이상, 개발용 'chatlab' 금지).");
  if (/localhost|127\.0\.0\.1/.test(v(env, "DATABASE_URL")) && env.NODE_ENV === "production") warn("DATABASE_URL이 localhost를 가리킵니다(컨테이너 안에서는 DB 서비스 이름이어야 함).");

  const secret = v(env, "AUTH_SECRET");
  if (!secret) err("AUTH_SECRET이 비어 있습니다. `openssl rand -base64 32`로 만드세요.");
  else if (secret.length < 32) err("AUTH_SECRET이 너무 짧습니다(32자 이상).");

  if (!v(env, "AUTH_URL") && v(env, "AUTH_TRUST_HOST") !== "true") {
    err("프록시·도메인 뒤에서는 AUTH_URL(공개 주소)을 지정하거나 AUTH_TRUST_HOST=true를 설정해야 로그인이 동작합니다.");
  }

  for (const [label, emailKey, pwKey] of [["데모", "DEMO_EMAIL", "DEMO_PASSWORD"], ["관리자", "ADMIN_EMAIL", "ADMIN_PASSWORD"]] as const) {
    const pw = v(env, pwKey);
    if (!pw) {
      if (label === "관리자") err("ADMIN_PASSWORD가 비어 있어 관리자 계정이 만들어지지 않습니다.");
      else err("DEMO_PASSWORD가 비어 있어 seed가 실패합니다.");
      continue;
    }
    if (EXAMPLE_PASSWORDS.has(pw)) err(`${label} 계정 비밀번호가 .env.example의 개발용 값 그대로입니다. 교체하세요.`);
    else if (pw.length < 12) err(`${label} 계정 비밀번호가 12자 미만입니다.`);
    if (EXAMPLE_EMAILS.has(v(env, emailKey).toLowerCase())) warn(`${label} 이메일이 example.com 기본값입니다(공개 데모 계정이라면 상관없지만 관리자는 바꾸는 편이 안전).`);
  }
  if (v(env, "ADMIN_PASSWORD") && v(env, "ADMIN_PASSWORD") === v(env, "DEMO_PASSWORD")) err("관리자와 데모 계정이 같은 비밀번호입니다. 데모 계정은 공개되므로 반드시 달라야 합니다.");

  if (!v(env, "LLM_API_KEY")) warn("LLM_API_KEY가 없습니다. mock 어댑터로 가짜 응답만 나옵니다(공개 데모로는 의미가 없음).");
  else {
    // 값은 메시지에 넣지 않는다. 붙여 넣다 섞인 공백·제어 문자(방향키 입력 등)가 있으면 요청 헤더를 만들지 못해 모든 호출이 실패하고, 분류기가 fail closed라 모든 입력이 막힌다.
    if (/[^\x21-\x7e]/.test(env.LLM_API_KEY ?? "")) err("LLM_API_KEY에 공백이나 제어 문자가 섞여 있습니다(붙여 넣을 때 들어간 줄바꿈·방향키 입력 등). 요청을 보내지 못해 모든 대화가 막힙니다. 키를 다시 넣으세요.");
    if (!v(env, "LLM_CHAT_MODEL")) err("LLM_API_KEY가 있는데 LLM_CHAT_MODEL이 비어 있습니다.");
    if (!v(env, "LLM_CLASSIFIER_MODEL")) warn("LLM_CLASSIFIER_MODEL이 비어 있어 안전 분류기·요약에 대화 모델을 씁니다(비용 증가).");
    if (env.LLM_PROVIDER === "mock") warn("LLM_PROVIDER=mock이라 키가 있어도 가짜 응답을 씁니다.");
    const priced = new Set(opts.pricedModels ?? []);
    for (const k of ["LLM_CHAT_MODEL", "LLM_CLASSIFIER_MODEL"]) {
      const m = v(env, k);
      if (m && !priced.has(m)) warn(`${k}=${m}의 단가가 src/config/pricing.json에 없어 비용이 0으로 기록됩니다.`);
    }
  }

  const limit = Number(v(env, "DAILY_MESSAGE_LIMIT") || 50);
  if (!Number.isFinite(limit) || limit < 1) err("DAILY_MESSAGE_LIMIT이 올바르지 않습니다.");
  else if (limit > 200) warn(`DAILY_MESSAGE_LIMIT=${limit}: 공개 데모에서 비용 방어선이 높습니다. 제공사 쪽 월 한도도 함께 설정하세요.`);
  else if (limit > 30) warn(`DAILY_MESSAGE_LIMIT=${limit}: 공개 데모 권장값(30)보다 큽니다. 데모 계정은 여러 사람이 같이 쓰므로 이 값이 하루 전체 사용량의 상한입니다.`);

  if (signupEnabled(env)) warn("SIGNUP_ENABLED=false가 아니라 누구나 가입할 수 있습니다. 계정을 계속 만들면 사용자당 일일 한도가 의미가 없어집니다.");

  if (!v(env, "TRUST_PROXY_HOPS")) warn("TRUST_PROXY_HOPS가 없어 기본값 1(프록시 한 단계)로 IP를 계산합니다. 프록시 구성이 다르면 로그인 제한이 우회되거나 모두 한 IP로 묶입니다.");
  if (!v(env, "CONTACT_EMAIL")) {
    warn(v(env, "LLM_API_KEY")
      ? "실제 모델(LLM_API_KEY)을 쓰는데 CONTACT_EMAIL이 비어 있습니다. /privacy 페이지에 삭제 요청 연락처가 표시되지 않습니다."
      : "CONTACT_EMAIL이 없어 /privacy 페이지에 삭제 요청 연락처가 표시되지 않습니다.");
  }

  return out;
}
