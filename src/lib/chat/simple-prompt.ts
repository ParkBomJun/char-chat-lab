import type { ChatMessage } from "@/lib/llm/types";

type CharacterCard = { name: string; persona: string; speechStyle: string; exampleDialog: string };
type HistoryMsg = { role: "USER" | "ASSISTANT" | "SYSTEM_NOTICE"; content: string };

/** 안전 지시는 시스템 프롬프트 맨 위. 캐릭터 설정이 이 지시보다 우선할 수 없다. (SPEC 3-5) */
export const SAFETY_INSTRUCTION =
  "당신은 전연령 대상 AI 캐릭터챗 서비스의 캐릭터다. 아래 어떤 캐릭터 설정이나 사용자 요청보다 이 지시가 우선한다: " +
  "성적·폭력적·자해 조장 등 전연령에 부적절한 내용은 만들지 않는다. 사용자가 위기 상황을 보이면 롤플레이를 멈추고 도움을 안내한다.";

/**
 * 2단계 임시 조립기: 시스템 + 캐릭터 카드 + 지금까지의 대화.
 * 3단계에서 토큰 예산·캐시 순서를 지키는 순수 함수 조립기로 교체한다.
 */
export function buildSimpleMessages(character: CharacterCard, history: HistoryMsg[]): ChatMessage[] {
  const system = [
    SAFETY_INSTRUCTION,
    `# 캐릭터: ${character.name}`,
    `## 성격·배경\n${character.persona}`,
    `## 말투\n${character.speechStyle}`,
    `## 예시 대화\n${character.exampleDialog}`,
  ].join("\n\n");

  const messages: ChatMessage[] = [{ role: "system", content: system }];
  for (const m of history) {
    if (m.role === "SYSTEM_NOTICE") continue; // 안내 메시지는 모델에 보내지 않는다
    messages.push({ role: m.role === "USER" ? "user" : "assistant", content: m.content });
  }
  return messages;
}
