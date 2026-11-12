"use client";

import { useEffect, useRef, useState } from "react";
import { SseParser } from "@/lib/sse";

export type ViewMessage = { id: string; role: "USER" | "ASSISTANT" | "SYSTEM_NOTICE"; content: string };

export function ChatView({
  conversationId,
  characterName,
  initialMessages,
  initialStopped,
  initialRemaining,
}: {
  conversationId: string;
  characterName: string;
  initialMessages: ViewMessage[];
  initialStopped: boolean;
  initialRemaining: number;
}) {
  const [messages, setMessages] = useState<ViewMessage[]>(initialMessages);
  const [stopped, setStopped] = useState(initialStopped);
  const [remaining, setRemaining] = useState(initialRemaining);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages]);

  async function send() {
    const content = input.trim();
    if (!content || sending) return;
    setInput("");
    setError(null);
    setSending(true);

    const tmp = Date.now();
    const userId = `u-${tmp}`;
    const asstId = `a-${tmp}`;
    setMessages((m) => [...m, { id: userId, role: "USER", content }, { id: asstId, role: "ASSISTANT", content: "" }]);

    const ctrl = new AbortController();
    abortRef.current = ctrl;
    let gotAny = false;
    try {
      const res = await fetch(`/api/chat/${conversationId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
        signal: ctrl.signal,
      });
      const hdr = res.headers.get("X-Daily-Remaining");
      if (hdr !== null && !Number.isNaN(Number(hdr))) setRemaining(Number(hdr));
      if (!res.ok || !res.body) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? "전송에 실패했어요.");
      }

      const parser = new SseParser();
      const decoder = new TextDecoder();
      const reader = res.body.getReader();
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        for (const frame of parser.feed(decoder.decode(value, { stream: true }))) {
          const data = JSON.parse(frame.data);
          if (frame.event === "delta") {
            gotAny = true;
            setMessages((m) => m.map((x) => (x.id === asstId ? { ...x, content: x.content + data.text } : x)));
          } else if (frame.event === "error") {
            throw new Error(data.message);
          } else if (frame.event === "done") {
            setMessages((m) => m.map((x) => (x.id === asstId ? { ...x, id: data.messageId } : x)));
          } else if (frame.event === "retract") {
            // 출력 검사에 걸린 응답을 회수: 이미 화면에 흘려보낸 말풍선을 안내문으로 교체
            setMessages((m) =>
              m.map((x) => (x.id === asstId ? { id: data.noticeId, role: "SYSTEM_NOTICE", content: data.text } : x)),
            );
          } else if (frame.event === "blocked") {
            // 입력이 거절됨: 내 말풍선과 응답 자리를 치우고 안내만 보인다
            setMessages((m) => [...m.filter((x) => x.id !== userId && x.id !== asstId), { id: data.noticeId, role: "SYSTEM_NOTICE", content: data.text }]);
          } else if (frame.event === "crisis") {
            // 위기 안내: 내 말은 남기고 응답 자리만 안내로 교체
            setMessages((m) => m.map((x) => (x.id === asstId ? { id: data.noticeId, role: "SYSTEM_NOTICE", content: data.text } : x)));
          } else if (frame.event === "notice") {
            setMessages((m) => [...m, { id: data.id, role: "SYSTEM_NOTICE", content: data.text }]);
            if (data.kind === "stopped") setStopped(true);
          }
        }
      }
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError")) {
        setError(e instanceof Error ? e.message : "오류가 발생했어요.");
      }
      if (!gotAny) {
        // 아무것도 못 받았으면 말풍선을 치우고 입력을 되돌려 다시 보낼 수 있게 한다
        setMessages((m) => m.filter((x) => x.id !== asstId && x.id !== userId));
        setInput((cur) => cur || content);
      }
    } finally {
      abortRef.current = null;
      setSending(false);
    }
  }

  return (
    <div className="chat">
      <div className="chat-log" aria-live="polite">
        {messages.map((m) => (
          <div key={m.id} className={`bubble ${m.role.toLowerCase()}`}>
            {m.role === "ASSISTANT" && <span className="who">{characterName}</span>}
            <p>{m.content || "…"}</p>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
      {error && <p className="error chat-error">{error}</p>}
      <p className="chat-usage">
        {remaining > 0 ? `오늘 남은 메시지 ${remaining}개` : "오늘 사용할 수 있는 메시지를 모두 사용했어요. 내일 다시 이용해 주세요."}
      </p>
      {stopped && <p className="chat-error">이 대화는 중단되었어요. 목록에서 새 대화를 시작해 주세요.</p>}
      <form
        className="chat-input"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            // 한글 조합 중 Enter는 전송이 아님
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void send();
            }
          }}
          maxLength={2000}
          rows={2}
          placeholder="메시지를 입력하세요 (Enter 전송, Shift+Enter 줄바꿈)"
          disabled={sending || stopped || remaining <= 0}
        />
        {sending ? (
          <button type="button" className="btn line" onClick={() => abortRef.current?.abort()}>중지</button>
        ) : (
          <button type="submit" className="btn" disabled={!input.trim() || stopped || remaining <= 0}>전송</button>
        )}
      </form>
    </div>
  );
}
