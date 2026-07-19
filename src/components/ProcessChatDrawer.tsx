"use client";

import { useActionState, useContext, useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import {
  applyChatProposalAction,
  discardChatProposalAction,
  processChatAction,
} from "@/app/process-actions";
import { ProcessChatCloseContext } from "@/components/processChatContext";
import type { FormState } from "@/app/actions";
import type { ChatEntry, ProposedChange } from "@/lib/processmap/chat";

// ─────────────────────────────────────────────────────────────
// Folyamat-asszisztens chat-drawer (#10, Fázis 4) — a ref CHAT DRAWER
// paneljének megfelelője (inspector fölé csúszó 420px-es sáv).
//
// HITL: az asszisztens JAVASOL (pending előnézet a chat_log-ban), az ember
// alkalmaz vagy elvet — az ábra csak alkalmazáskor változik. A nyers
// forráshoz a chat nem nyúl (a fejléc-alcím is ezt rögzíti).
// ─────────────────────────────────────────────────────────────

const INITIAL: FormState = { ok: true, error: null };

function opBadge(change: ProposedChange, t: ReturnType<typeof useTranslations>): string {
  if (change.op === "insert_after") return t("chatOpInsert");
  if (change.op === "update") return t("chatOpUpdate");
  return t("chatOpRemove");
}

function changeTitle(change: ProposedChange): string {
  if (change.op === "insert_after") return change.title;
  if (change.op === "update") return change.title ?? change.id;
  return change.id;
}

function ProposalCard({
  projectId,
  mapId,
  entryIndex,
  entry,
}: {
  projectId: string;
  mapId: string;
  entryIndex: number;
  entry: ChatEntry;
}) {
  const t = useTranslations("processMap");
  const [applyState, applyAction, applyPending] = useActionState(
    applyChatProposalAction.bind(null, projectId, mapId, entryIndex),
    INITIAL,
  );
  const [discardState, discardAction, discardPending] = useActionState(
    discardChatProposalAction.bind(null, projectId, mapId, entryIndex),
    INITIAL,
  );
  const busy = applyPending || discardPending;
  const status = entry.proposal_status ?? "pending";

  return (
    <div className="max-w-[95%] self-start">
      <div
        className={`rounded-tile border px-3 py-2.5 ${
          status === "pending"
            ? "border-[#B9CCF7] bg-accent-tint"
            : "border-line bg-soft opacity-80"
        }`}
      >
        <span className="font-mono text-[9px] font-bold uppercase tracking-[0.1em] text-action-deep">
          {status === "pending"
            ? t("chatPendingTag")
            : status === "applied"
              ? t("chatAppliedTag")
              : t("chatDiscardedTag")}
        </span>
        <ul className="mt-1.5 space-y-1.5">
          {(entry.proposal ?? []).map((c, i) => (
            <li key={i} className="flex items-start gap-2 text-[12px] leading-[1.45] text-ink">
              <span
                className={`mt-px shrink-0 rounded-3 px-1.5 py-px font-mono text-[9px] font-bold ${
                  c.op === "remove"
                    ? "bg-danger/10 text-danger"
                    : c.op === "update"
                      ? "bg-tint-gate text-gate-text"
                      : "bg-tint-action text-action-deep"
                }`}
              >
                {opBadge(c, t)}
              </span>
              <span>
                <b>{changeTitle(c)}</b>
                {c.note ? <span className="text-ink-secondary"> — {c.note}</span> : null}
              </span>
            </li>
          ))}
        </ul>
      </div>
      {status === "pending" && (
        <div className="mt-2 flex gap-2">
          <form action={applyAction}>
            <button
              type="submit"
              disabled={busy}
              className="rounded-control bg-action px-3.5 py-2 text-[12px] font-semibold text-white hover:bg-action-deep disabled:opacity-60"
            >
              {applyPending ? t("chatApplying") : t("chatApplyBtn")}
            </button>
          </form>
          <form action={discardAction}>
            <button
              type="submit"
              disabled={busy}
              className="rounded-control border border-neutral-350 bg-surface px-3.5 py-2 text-[12px] font-semibold text-ink-secondary hover:bg-soft disabled:opacity-60"
            >
              {t("chatDiscardBtn")}
            </button>
          </form>
        </div>
      )}
      {(applyState.error || discardState.error) && (
        <p className="mt-1.5 text-[11.5px] text-danger">
          {applyState.error ?? discardState.error}
        </p>
      )}
    </div>
  );
}

export function ProcessChatDrawer({
  projectId,
  mapId,
  chatLog,
}: {
  projectId: string;
  mapId: string;
  chatLog: ChatEntry[];
}) {
  const t = useTranslations("processMap");
  // A bezárót a viewer adja contexten (a slot-elem RSC-ben készül,
  // függvény-prop nem utazhat rajta).
  const onClose = useContext(ProcessChatCloseContext);
  const [sendState, sendAction, sendPending] = useActionState(
    processChatAction.bind(null, projectId, mapId),
    INITIAL,
  );
  const listRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  // Új üzenetnél az aljára görgetünk; sikeres küldés után ürül a mező.
  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [chatLog.length, sendPending]);
  useEffect(() => {
    if (sendState.ok && !sendState.error) formRef.current?.reset();
  }, [sendState]);

  return (
    <div className="absolute bottom-0 right-0 top-0 z-30 flex w-[420px] flex-col border-l-[1.5px] border-[#B9CCF7] bg-surface shadow-[-14px_0_34px_rgba(35,38,47,0.14)]">
      {/* Fejléc */}
      <div className="flex items-center gap-2.5 border-b border-line-soft bg-[#F6F9FE] px-4 py-3">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-control bg-action text-[12px] text-white">
          ✦
        </span>
        <div className="min-w-0">
          <div className="text-[13.5px] font-bold">{t("chatTitle")}</div>
          <div className="truncate font-mono text-[9px] text-ink-tertiary">{t("chatSubtitle")}</div>
        </div>
        <div className="flex-1" />
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label={t("chatCloseAria")}
            className="text-[13px] font-semibold text-ink-secondary hover:text-ink"
          >
            ✕
          </button>
        )}
      </div>

      {/* Üzenetek */}
      <div ref={listRef} className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-auto p-3.5">
        {chatLog.length === 0 && (
          <p className="rounded-tile border border-dashed border-neutral-350 px-3 py-2.5 text-[12px] leading-[1.55] text-ink-tertiary">
            {t("chatEmptyHint")}
          </p>
        )}
        {chatLog.map((entry, i) => (
          <div key={i} className="flex flex-col gap-2">
            <div
              className={`max-w-[92%] px-3 py-2.5 text-[12.5px] leading-[1.55] text-ink ${
                entry.role === "user"
                  ? "self-end rounded-[8px_8px_2px_8px] bg-tint-action"
                  : "self-start rounded-[8px_8px_8px_2px] bg-soft"
              }`}
            >
              {entry.text}
            </div>
            {entry.role === "assistant" && entry.proposal && (
              <ProposalCard projectId={projectId} mapId={mapId} entryIndex={i} entry={entry} />
            )}
          </div>
        ))}
        {sendPending && (
          <div className="max-w-[92%] self-start rounded-[8px_8px_8px_2px] bg-soft px-3 py-2.5 text-[12.5px] italic text-ink-tertiary">
            {t("chatThinking")}
          </div>
        )}
      </div>

      {/* Beviteli sáv + HITL-jegyzet */}
      <div className="border-t border-line-soft bg-[#FAFAFC] px-3.5 py-3">
        {sendState.error && (
          <p className="mb-2 rounded-tile border border-danger/40 bg-danger/10 px-3 py-2 text-[12px] text-danger">
            {sendState.error}
          </p>
        )}
        <form ref={formRef} action={sendAction} className="flex items-center gap-2">
          <input
            type="text"
            name="message"
            required
            disabled={sendPending}
            placeholder={t("chatPlaceholder")}
            className="min-w-0 flex-1 rounded-control border border-neutral-350 bg-surface px-3 py-2 text-[12.5px] outline-none placeholder:text-ink-tertiary focus:border-action"
          />
          <button
            type="submit"
            disabled={sendPending}
            aria-label={t("chatSend")}
            className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-control bg-action text-white hover:bg-action-deep disabled:opacity-60"
          >
            <svg width="14" height="14" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6">
              <path d="M2 6 h7 M6.5 3 L9.5 6 L6.5 9" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </form>
        <p className="mt-2 text-[10.5px] leading-[1.5] text-ink-tertiary">{t("chatHitlNote")}</p>
      </div>
    </div>
  );
}
