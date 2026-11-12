import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { CharacterForm } from "@/components/admin/CharacterForm";
import { renderFixedBlock } from "@/lib/chat/assemble";
import { estimateTokens } from "@/lib/tokens";
import { deleteLoreAction, saveLoreAction } from "@/app/admin/actions";
import { MAX_KEYWORDS_PER_ENTRY, MIN_KEYWORD_LENGTH } from "@/lib/lorebook/keywords";
import { decodeFindings, warningMessage } from "@/lib/safety/card-check";

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function EditCharacter(props: PageProps<"/admin/characters/[id]">) {
  const { id } = await props.params;
  const sp = await props.searchParams;
  const character = await prisma.character.findUnique({
    where: { id },
    include: { lorebook: { orderBy: [{ priority: "desc" }, { id: "asc" }] } },
  });
  if (!character) notFound();

  const fixedTokens = estimateTokens(renderFixedBlock(character));
  const error = one(sp.error);
  const saved = one(sp.saved);
  // 저장 때 SOFT 규칙에 걸린 필드·범주(허용된 이름만 되읽는다)
  const warnings = decodeFindings(one(sp.warn));

  return (
    <>
      <p><Link href="/admin/characters">← 목록</Link></p>
      <h1>{character.name}</h1>
      {saved === "1" && <p className="ok">저장했습니다.</p>}
      {saved === "lore" && <p className="ok">로어북을 저장했습니다.</p>}
      {warnings.length > 0 && <p className="error" role="status">⚠ {warningMessage(warnings)}</p>}
      {error && <p className="error">{error}</p>}

      <p className="who">
        고정 블록(안전 지시+캐릭터 카드) 추정 {fixedTokens.toLocaleString("ko-KR")}토큰(글자 수 기준). 이 내용을 수정하면 진행 중인 대화의 캐시 접두사가 한 번 바뀌고,
        캐시가 동작하는 최소 길이는 제공사·모델마다 다릅니다. 실측한 경로(OpenRouter 경유 Gemini, 2026-11-12)에서는 자동 캐시가 걸리지 않고, 캐시 표시를 붙인 앞부분이
        실제 토큰으로 3,555~4,159 사이를 넘어야 동작했습니다(이 화면의 글자 수 추정으로는 대략 6,000~7,000 이상).
      </p>
      <CharacterForm
        initial={{
          id: character.id,
          name: character.name,
          tagline: character.tagline,
          persona: character.persona,
          speechStyle: character.speechStyle,
          exampleDialog: character.exampleDialog,
          greeting: character.greeting,
          isPublished: character.isPublished,
        }}
      />

      <h2 id="lorebook">로어북 ({character.lorebook.length})</h2>
      <p className="who">
        키워드는 줄바꿈이나 쉼표로 구분합니다. 공백을 뺀 {MIN_KEYWORD_LENGTH}글자 이상, 항목당 최대 {MAX_KEYWORDS_PER_ENTRY}개. 부분 문자열로 매칭되므로
        &quot;정원&quot;은 &quot;정원사&quot;에도 걸립니다 — 구체적인 키워드를 쓰세요. 최근 대화에 키워드가 나오면 우선순위가 높은 항목부터 예산 안에서 프롬프트에 들어갑니다.
      </p>
      {character.lorebook.map((e) => (
        <div key={e.id} className="lore-card">
          <form action={saveLoreAction} className="admin-form">
            <input type="hidden" name="characterId" value={character.id} />
            <input type="hidden" name="entryId" value={e.id} />
            <label>키워드<textarea name="keywords" rows={2} defaultValue={e.keywords.join("\n")} required /></label>
            <label>내용<textarea name="content" rows={3} defaultValue={e.content} maxLength={1000} required /></label>
            <div className="inline">
              <label>우선순위 <input name="priority" type="number" defaultValue={e.priority} min={-100} max={100} /></label>
              <label className="check"><input type="checkbox" name="enabled" defaultChecked={e.enabled} /> 활성</label>
              <button type="submit">저장</button>
            </div>
          </form>
          <form action={deleteLoreAction}>
            <input type="hidden" name="characterId" value={character.id} />
            <input type="hidden" name="entryId" value={e.id} />
            <button type="submit" className="danger">삭제</button>
          </form>
        </div>
      ))}

      <div className="lore-card">
        <h3>항목 추가</h3>
        <form action={saveLoreAction} className="admin-form">
          <input type="hidden" name="characterId" value={character.id} />
          <label>키워드<textarea name="keywords" rows={2} placeholder="옥상&#10;정원" required /></label>
          <label>내용<textarea name="content" rows={3} maxLength={1000} required /></label>
          <div className="inline">
            <label>우선순위 <input name="priority" type="number" defaultValue={0} min={-100} max={100} /></label>
            <label className="check"><input type="checkbox" name="enabled" defaultChecked /> 활성</label>
            <button type="submit">추가</button>
          </div>
        </form>
      </div>
    </>
  );
}
