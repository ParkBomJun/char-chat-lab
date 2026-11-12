"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { startConversationAction } from "@/app/actions/conversation";
import { Avatar } from "@/components/CharacterArt";
import type { CharacterArt } from "@/lib/character-art";
import { splitActions, splitHotlines, subjectParticle } from "@/lib/chat/display";
import { NOTICE } from "@/lib/safety/messages";
import { SseParser } from "@/lib/sse";

export type ViewMessage = { id: string; role: "USER" | "ASSISTANT" | "SYSTEM_NOTICE"; content: string };

/** 맨 아래에서 이만큼 안에 있을 때만 새 글을 따라 내린다 */
const STICK_PX = 80;
const MAX_INPUT_PX = 160;
const LOW_REMAINING = 5;

export function ChatView({
  conversationId,
  characterId,
  characterName,
  characterArt,
  initialMessages,
  initialStopped,
  initialRemaining,
}: {
  conversationId: string;
  characterId: string;
  characterName: string;
  characterArt: CharacterArt;
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
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const pinnedRef = useRef(true);
  const wasSending = useRef(false);

  // 자동 스크롤: 맨 아래 근처에 있을 때만 따라 내린다(위로 올려 읽는 중이면 그대로 둔다)
  useLayoutEffect(() => {
    const s = scrollRef.current;
    if (s && pinnedRef.current) s.scrollTop = s.scrollHeight;
  }, [messages, stopped, error]);

  // 입력칸 높이는 내용에 맞춰 늘린다
  useLayoutEffect(() => {
    const t = inputRef.current;
    if (!t) return;
    t.style.height = "auto";
    t.style.height = `${Math.min(MAX_INPUT_PX, t.scrollHeight)}px`;
  }, [input]);

  // 응답이 끝나면 입력칸에 커서를 돌려준다
  useEffect(() => {
    if (wasSending.current && !sending && !stopped) inputRef.current?.focus();
    wasSending.current = sending;
  }, [sending, stopped]);

  async function send() {
    const content = input.trim();
    if (!content || sending || stopped || remaining <= 0) return;
    setInput("");
    setError(null);
    setSending(true);
    pinnedRef.current = true; // 보내는 순간에는 항상 맨 아래로

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
      const left = hdr !== null && !Number.isNaN(Number(hdr)) ? Number(hdr) : null;
      if (left !== null) setRemaining(left);
      if (!res.ok || !res.body) {
        const body = await res.json().catch(() => null);
        // 한도 도달(429)은 오류가 아니다: 한도 안내 상자 하나만 보인다
        if (res.status === 429 && left === 0) throw new LimitReached();
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
            gotAny = true;
            setMessages((m) =>
              m.map((x) => (x.id === asstId ? { id: data.noticeId, role: "SYSTEM_NOTICE", content: data.text } : x)),
            );
          } else if (frame.event === "blocked") {
            // 입력이 거절됨: 내 말풍선과 응답 자리를 치우고 안내만 보인다
            gotAny = true;
            setMessages((m) => [...m.filter((x) => x.id !== userId && x.id !== asstId), { id: data.noticeId, role: "SYSTEM_NOTICE", content: data.text }]);
          } else if (frame.event === "crisis") {
            // 위기 안내: 내 말은 남기고 응답 자리만 안내로 교체
            gotAny = true;
            setMessages((m) => m.map((x) => (x.id === asstId ? { id: data.noticeId, role: "SYSTEM_NOTICE", content: data.text } : x)));
          } else if (frame.event === "notice") {
            setMessages((m) => [...m, { id: data.id, role: "SYSTEM_NOTICE", content: data.text }]);
            if (data.kind === "stopped") setStopped(true);
          }
        }
      }
    } catch (e) {
      const aborted = e instanceof DOMException && e.name === "AbortError";
      if (!aborted && !(e instanceof LimitReached)) {
        setError(e instanceof Error ? e.message : "오류가 발생했어요.");
      }
      if (!gotAny) {
        // 아무것도 못 받았으면 말풍선을 치우고 입력을 되돌려 다시 보낼 수 있게 한다
        setMessages((m) => m.filter((x) => x.id !== asstId && x.id !== userId));
        setInput((cur) => cur || content);
      }
    } finally {
      abortRef.current = null;
      // 응답 자리가 비어 있는 채로 끝났으면(중지 등) 빈 말풍선을 남기지 않는다
      setMessages((m) => m.filter((x) => !(x.id === asstId && x.content === "")));
      setSending(false);
    }
  }

  const out = remaining <= 0;
  const locked = sending || stopped || out;
  const placeholder = sending ? "답변을 기다리는 중…" : stopped ? "중단된 대화에는 보낼 수 없어요" : "메시지를 입력하세요";

  return (
    <>
      <div
        className="scroll"
        ref={scrollRef}
        onScroll={(e) => {
          const s = e.currentTarget;
          pinnedRef.current = s.scrollHeight - s.scrollTop - s.clientHeight < STICK_PX;
        }}
      >
        <div className="msgs" aria-live="polite">
          {messages.map((m) => (
            <MessageRow key={m.id} m={m} characterName={characterName} art={characterArt} />
          ))}
          {stopped && (
            <div className="card stop" role="status">
              <p className="card-t">이 대화는 중단되었어요</p>
              <p>{NOTICE.stopped}</p>
              <form action={startConversationAction}>
                <input type="hidden" name="characterId" value={characterId} />
                <button type="submit" className="btn">새 대화 시작</button>
              </form>
            </div>
          )}
        </div>
      </div>
      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        {error && <p className="banner err" role="alert">{error}</p>}
        {out && !stopped && (
          <p className="banner lim" role="status">오늘 사용할 수 있는 메시지를 모두 사용했어요. 내일 다시 이용해 주세요.</p>
        )}
        <div className={`box${locked ? " locked" : ""}`}>
          <label className="sr" htmlFor="chat-input">메시지</label>
          <textarea
            id="chat-input"
            ref={inputRef}
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
            rows={1}
            placeholder={placeholder}
            disabled={sending || stopped}
          />
          {sending ? (
            <button type="button" className="btn line" onClick={() => abortRef.current?.abort()}>
              <span className="stop-ic" aria-hidden="true" />중지
            </button>
          ) : (
            <button type="submit" className="btn" disabled={!input.trim() || stopped || out}>전송</button>
          )}
        </div>
        <div className="meta">
          <span className={remaining > 0 && remaining <= LOW_REMAINING ? "low" : undefined}>오늘 남은 메시지 {remaining}개</span>
          <span className="hint">Enter 전송 · Shift+Enter 줄바꿈</span>
        </div>
      </form>
    </>
  );
}

class LimitReached extends Error {}

function MessageRow({ m, characterName, art }: { m: ViewMessage; characterName: string; art: CharacterArt }) {
  if (m.role === "USER") {
    return (
      <div className="row me">
        <div className="bub">{m.content}</div>
      </div>
    );
  }
  if (m.role === "ASSISTANT") {
    return (
      <div className="row">
        <Avatar name={characterName} art={art} />
        {m.content === "" ? (
          <div className="bub typing" role="status" aria-label={`${characterName}${subjectParticle(characterName)} 답하는 중`}>
            <i /><i /><i />
          </div>
        ) : (
          <div className="bub">
            {m.content.split(/\n+/).map((line, i) => (
              <p key={i}>
                {splitActions(line).map((p, j) => (p.act ? <span key={j} className="act">{p.text}</span> : p.text))}
              </p>
            ))}
          </div>
        )}
      </div>
    );
  }
  // 안내문: 문구는 서버가 보낸 그대로 쓰고 모양만 나눈다
  if (m.content === NOTICE.crisis) return <CrisisCard text={m.content} />;
  if (m.content === NOTICE.stopped) return null; // 중단 카드가 같은 문구를 보여 준다
  return <p className="note" role="status">{m.content}</p>;
}

function CrisisCard({ text }: { text: string }) {
  const lines = text.split("\n");
  const title = lines[0];
  const foot = lines.length > 2 ? lines[lines.length - 1] : null;
  const body = lines.slice(1, foot === null ? undefined : -1);
  return (
    <div className="card crisis" role="alert">
      <p className="card-t">{title}</p>
      {body.map((line, i) => (
        <p key={i}>
          {splitHotlines(line).map((p, j) => (p.strong ? <strong key={j}>{p.text}</strong> : p.text))}
        </p>
      ))}
      <div className="tel">
        <a href="tel:109">109 전화하기</a>
        <a href="tel:112">112</a>
        <a href="tel:119">119</a>
      </div>
      {foot && <p className="card-f">{foot}</p>}
    </div>
  );
}
