import { useCallback, useEffect, useRef, useState, type JSX } from "react";
import { Message } from "./Message.js";
import { HighlightAffordance, type AffordanceTarget } from "./HighlightAffordance.js";
import { CardPanel, draftFromCard, draftFromSelection, type PanelDraft } from "./CardPanel.js";
import { draftSelectionText, messageSelectionInfo, excerpt } from "./selection.js";
import {
  createCard,
  deleteCard,
  getCard,
  matchText,
  sendMessage,
  subscribeEvents,
  updateCard
} from "./api.js";
import type { ChatMessage } from "./types.js";

interface PendingSelection {
  target: AffordanceTarget;
  spanText: string;
  messageExcerpt: string;
}

export function App(): JSX.Element {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draftText, setDraftText] = useState("");
  const [pendingSelection, setPendingSelection] = useState<PendingSelection | null>(null);
  const [panelDraft, setPanelDraft] = useState<PanelDraft | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const messageListRef = useRef<HTMLDivElement>(null);

  // Track which assistant message id is currently streaming, so
  // assistant_delta events append to the right row.
  const activeAssistantId = useRef<string | null>(null);

  useEffect(() => {
    const unsubscribe = subscribeEvents((event) => {
      if (event.type === "injection") {
        setMessages((prev) =>
          prev.map((m) => (m.id === event.messageId ? { ...m, injectedSlugs: event.slugs } : m))
        );
        return;
      }
      if (event.type === "assistant_delta") {
        activeAssistantId.current = event.messageId;
        setMessages((prev) => {
          const existing = prev.find((m) => m.id === event.messageId && m.role === "assistant");
          if (existing) {
            return prev.map((m) =>
              m.id === event.messageId
                ? { ...m, text: m.text + event.text, pending: true }
                : m
            );
          }
          return [
            ...prev,
            {
              id: event.messageId,
              role: "assistant",
              text: event.text,
              injectedSlugs: [],
              pending: true
            }
          ];
        });
        return;
      }
      if (event.type === "assistant_done") {
        setMessages((prev) =>
          prev.map((m) => (m.id === event.messageId ? { ...m, pending: false } : m))
        );
      }
    });
    return unsubscribe;
  }, []);

  // --- Selection: draft textarea path --------------------------------------
  // Attached as native listeners (not React's onSelect) on the textarea
  // itself: onSelect is unreliable for selections produced by
  // setSelectionRange without an accompanying real user gesture, and this is
  // also exactly what real users trigger (mouse drag -> mouseup, keyboard
  // Shift+Arrow -> keyup, plus the native `select` event as a catch-all).
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;

    const check = (): void => {
      const text = draftSelectionText(el.value, el.selectionStart, el.selectionEnd);
      if (!text) {
        setPendingSelection((prev) => (prev?.target ? null : prev));
        return;
      }
      // Approximate the caret rect using the textarea's own bounding box (a
      // full mirror-div measurement is unnecessary for a single-line-ish
      // draft input); anchor the affordance above the textarea's top-center.
      const rect = el.getBoundingClientRect();
      setPendingSelection({
        target: { top: rect.top, left: rect.left, width: rect.width },
        spanText: text,
        messageExcerpt: excerpt(el.value)
      });
    };

    el.addEventListener("select", check);
    el.addEventListener("mouseup", check);
    el.addEventListener("keyup", check);
    return () => {
      el.removeEventListener("select", check);
      el.removeEventListener("mouseup", check);
      el.removeEventListener("keyup", check);
    };
  }, []);

  // --- Selection: rendered message path ------------------------------------
  useEffect(() => {
    const handler = (): void => {
      // Ignore selection changes that originate inside the draft textarea;
      // that path is handled by handleDraftSelect via onSelect.
      if (document.activeElement === textareaRef.current) return;
      const info = messageSelectionInfo();
      if (!info) {
        setPendingSelection((prev) => (prev && prev.target ? prev : null));
        return;
      }
      const msg = messages.find((m) => m.id === info.messageId);
      setPendingSelection({
        target: { top: info.rect.top, left: info.rect.left, width: info.rect.width },
        spanText: info.text,
        messageExcerpt: excerpt(msg?.text ?? info.text)
      });
    };
    document.addEventListener("selectionchange", handler);
    return () => document.removeEventListener("selectionchange", handler);
  }, [messages]);

  const openPanelForSelection = useCallback(async () => {
    if (!pendingSelection) return;
    const { spanText, messageExcerpt } = pendingSelection;
    setPendingSelection(null);

    const { slugs } = await matchText(spanText);
    if (slugs.length > 0 && slugs[0]) {
      const card = await getCard(slugs[0]);
      if (card) {
        setPanelDraft(draftFromCard(card));
        return;
      }
    }
    setPanelDraft(draftFromSelection(spanText, messageExcerpt));
  }, [pendingSelection]);

  const openCardBySlug = useCallback(async (slug: string) => {
    const card = await getCard(slug);
    if (card) setPanelDraft(draftFromCard(card));
  }, []);

  const closePanel = useCallback(() => {
    setPanelDraft(null);
  }, []);

  const savePanel = useCallback(
    async (input: { term: string; aliases: string[]; body: string }) => {
      if (!panelDraft) return;
      if (panelDraft.slug) {
        await updateCard(panelDraft.slug, input);
      } else {
        await createCard({ ...input, source: panelDraft.source });
      }
      setPanelDraft(null);
    },
    [panelDraft]
  );

  const deletePanelCard = useCallback(async () => {
    if (!panelDraft?.slug) return;
    await deleteCard(panelDraft.slug);
    setPanelDraft(null);
  }, [panelDraft]);

  const handleSend = useCallback(async () => {
    const text = draftText.trim();
    if (text.length === 0) return;
    setDraftText("");
    const { messageId, slugs } = await sendMessage(text);
    setMessages((prev) => [
      ...prev,
      { id: messageId, role: "user", text, injectedSlugs: slugs, pending: false }
    ]);
  }, [draftText]);

  return (
    <main className="gloss-app">
      <header className="gloss-header">
        <h1>Gloss</h1>
      </header>

      <div className="gloss-chat" ref={messageListRef}>
        {messages.map((m) => (
          <Message key={m.id} message={m} onOpenCard={(slug) => void openCardBySlug(slug)} />
        ))}
      </div>

      <div className="gloss-composer">
        <textarea
          ref={textareaRef}
          data-testid="draft-input"
          className="gloss-composer__input"
          placeholder="Message Claude…"
          value={draftText}
          onChange={(e) => setDraftText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void handleSend();
            }
          }}
        />
        <button
          type="button"
          className="gloss-composer__send"
          data-testid="send-button"
          onClick={() => void handleSend()}
        >
          Send
        </button>
      </div>

      {pendingSelection ? (
        <HighlightAffordance
          target={pendingSelection.target}
          onClick={() => void openPanelForSelection()}
        />
      ) : null}

      {panelDraft ? (
        <CardPanel
          draft={panelDraft}
          onSave={(input) => void savePanel(input)}
          onDelete={() => void deletePanelCard()}
          onClose={closePanel}
        />
      ) : null}
    </main>
  );
}
