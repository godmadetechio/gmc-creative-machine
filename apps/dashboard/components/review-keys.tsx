"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { Keyboard } from "lucide-react";

// Keyboard review model: a provider wraps a review grid (server-rendered
// children pass straight through); each card registers an imperative handle.
// Arrows/J/K rove focus, A approves/selects, R rejects (focusing the
// feedback field where feedback is required), U undoes. Focus order is
// resolved from DOM position at keypress time, so pagination, filtering and
// revalidation never desync the ring.

export type ReviewCardHandle = {
  id: string;
  el: HTMLElement;
  approve: () => void;
  reject: () => void;
  undo: () => void;
};

type ReviewKeysContextValue = {
  register: (handle: ReviewCardHandle) => () => void;
  focusedId: string | null;
};

const ReviewKeysContext = createContext<ReviewKeysContextValue | null>(null);

const NAV_NEXT = new Set(["arrowdown", "arrowright", "j"]);
const NAV_PREV = new Set(["arrowup", "arrowleft", "k"]);

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT" ||
    target.isContentEditable
  );
}

export function ReviewKeysProvider({ children }: { children: ReactNode }) {
  const handles = useRef(new Map<string, ReviewCardHandle>());
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const focusedIdRef = useRef<string | null>(null);
  focusedIdRef.current = focusedId;

  const register = useCallback((handle: ReviewCardHandle) => {
    handles.current.set(handle.id, handle);
    return () => {
      handles.current.delete(handle.id);
    };
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (isTypingTarget(event.target)) return;
      // A shadcn dialog owns the keyboard while open.
      if (document.querySelector('[role="dialog"][data-state="open"]')) return;

      const key = event.key.toLowerCase();
      if (!NAV_NEXT.has(key) && !NAV_PREV.has(key) && !["a", "r", "u"].includes(key)) {
        return;
      }
      const ordered = [...handles.current.values()].sort((a, b) =>
        a.el.compareDocumentPosition(b.el) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1,
      );
      if (ordered.length === 0) return;
      const index = ordered.findIndex((h) => h.id === focusedIdRef.current);

      if (NAV_NEXT.has(key) || NAV_PREV.has(key)) {
        event.preventDefault();
        const delta = NAV_NEXT.has(key) ? 1 : -1;
        const next =
          index === -1
            ? ordered[delta > 0 ? 0 : ordered.length - 1]!
            : ordered[Math.min(ordered.length - 1, Math.max(0, index + delta))]!;
        setFocusedId(next.id);
        next.el.scrollIntoView({ block: "nearest", behavior: "smooth" });
        return;
      }

      if (index === -1) return;
      event.preventDefault();
      const handle = ordered[index]!;
      if (key === "a") handle.approve();
      else if (key === "r") handle.reject();
      else handle.undo();
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <ReviewKeysContext.Provider value={{ register, focusedId }}>
      {children}
    </ReviewKeysContext.Provider>
  );
}

/**
 * Card-side registration. Returns a ref for the card root and whether the
 * card currently holds keyboard focus (render a visible ring when true).
 * No-ops outside a provider, so cards render fine in dialogs and one-offs.
 */
export function useReviewCard(
  id: string,
  actions: { approve: () => void; reject: () => void; undo: () => void },
): { ref: RefObject<HTMLDivElement | null>; focused: boolean } {
  const context = useContext(ReviewKeysContext);
  const ref = useRef<HTMLDivElement | null>(null);
  const actionsRef = useRef(actions);
  actionsRef.current = actions;

  const register = context?.register ?? null;
  useEffect(() => {
    if (!register || !ref.current) return;
    return register({
      id,
      el: ref.current,
      approve: () => actionsRef.current.approve(),
      reject: () => actionsRef.current.reject(),
      undo: () => actionsRef.current.undo(),
    });
  }, [register, id]);

  return { ref, focused: context?.focusedId === id };
}

export function ReviewKeysHint({ approveLabel = "approve" }: { approveLabel?: string }) {
  return (
    <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
      <Keyboard className="size-3.5" />
      <span>
        ←/→ navigate · <kbd className="font-mono">A</kbd> {approveLabel} ·{" "}
        <kbd className="font-mono">R</kbd> reject · <kbd className="font-mono">U</kbd> undo
      </span>
    </p>
  );
}
