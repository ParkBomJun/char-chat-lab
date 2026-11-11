import { prisma } from "@/lib/db";
import { kstDayStart } from "@/lib/kst";

/**
 * 오늘(KST) 사용자가 보낸 메시지 수. 차단·회수된 입력도 센다:
 * 차단되는 메시지를 반복해 분류기 비용을 쓰게 하는 공격을 같은 한도로 막기 위해서다. (SPEC 3-6)
 */
export async function countTodayMessages(userId: string, now: Date = new Date()): Promise<number> {
  return prisma.message.count({
    where: { role: "USER", createdAt: { gte: kstDayStart(now) }, conversation: { userId } },
  });
}
