/** 공개 데모용 스위치(순수 함수). 가입 차단은 서버 액션이 이 값으로 거부하는 것이 기준이고, 화면은 같은 값을 보고 안내만 바꾼다. */
type Env = Record<string, string | undefined>;

export const SIGNUP_CLOSED_MESSAGE = "지금은 새 계정을 만들 수 없습니다. 데모 계정으로 둘러보세요.";
export const DEMO_SHARED_NOTICE = "데모 계정은 여러 사람이 함께 씁니다. 대화가 다른 방문자에게 보일 수 있으니 개인 정보는 적지 마세요.";

const flag = (raw: string | undefined) => (raw ?? "").trim().toLowerCase();

/** `SIGNUP_ENABLED`: 기본 켬. `false`(또는 0·off·no)일 때만 가입을 닫는다. */
export function signupEnabled(env: Env = process.env): boolean {
  return !["false", "0", "off", "no"].includes(flag(env.SIGNUP_ENABLED));
}

/** `DEMO_NOTICE`: 기본 끔. `true`(또는 1)일 때만 켠다. */
export function demoNoticeEnabled(env: Env = process.env): boolean {
  return ["true", "1"].includes(flag(env.DEMO_NOTICE));
}

/** 로그인한 계정이 공용 데모 계정(`DEMO_EMAIL`)이고 `DEMO_NOTICE`가 켜져 있을 때만 true */
export function isSharedDemoAccount(email: string | null | undefined, env: Env = process.env): boolean {
  const demo = flag(env.DEMO_EMAIL);
  return demoNoticeEnabled(env) && demo !== "" && flag(email ?? undefined) === demo;
}
