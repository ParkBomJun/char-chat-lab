import type { Prisma } from "@/generated/prisma/client";

/** 첫 화면 "내 대화"에 보일 대화의 수 */
export const HOME_LIST_TAKE = 10;

/**
 * 첫 화면 "내 대화"의 조회 조건. 사용자 메시지가 하나도 없는 대화(첫 인사만 있는 대화)는 목록에 넣지 않는다.
 * 대화 자체는 지우지 않는다(주소로는 계속 열린다).
 */
export function homeConversationWhere(userId: string): Prisma.ConversationWhereInput {
  return { userId, messages: { some: { role: "USER" } } };
}
