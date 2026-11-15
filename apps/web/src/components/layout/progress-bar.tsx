"use client";

import {
  createContext,
  useCallback,
  useEffect,
  useRef,
  useState,
  Suspense,
  type ReactNode,
  type RefObject,
} from "react";
import { usePathname, useSearchParams } from "next/navigation";

/**
 * Registers a navigation that is on its way; the returned function ends it.
 * useNavigate reports through this, because a router.push from a click handler
 * is no anchor click and the bar would otherwise never start. A page's loading
 * placeholder reports too, so the bar lasts until the content is on screen.
 */
export type ReportNavigation = () => () => void;

export const NavigationProgressContext = createContext<ReportNavigation | null>(null);

function ProgressBarInner({
  color,
  reported,
  reportedCount,
}: {
  color: string;
  reported: boolean;
  reportedCount: RefObject<number>;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const barRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef(false);
  // What's still scheduled from the last start or finish, cancelled by the next.
  const pendingRef = useRef<{ frame?: number; timer?: ReturnType<typeof setTimeout> }>({});

  const cancelPending = useCallback(() => {
    if (pendingRef.current.frame !== undefined) cancelAnimationFrame(pendingRef.current.frame);
    clearTimeout(pendingRef.current.timer);
    pendingRef.current = {};
  }, []);

  const start = useCallback(() => {
    const bar = barRef.current;
    // Already running, as when a link's placeholder takes over: carry on from here.
    if (!bar || activeRef.current) return;

    cancelPending();
    activeRef.current = true;
    // Styled imperatively like the width, so the bar never re-renders mid-navigation.
    bar.setAttribute("aria-hidden", "false");
    bar.style.transition = "none";
    bar.style.width = "0%";
    bar.style.opacity = "1";

    // Double rAF ensures the reset above has painted before we start growing
    pendingRef.current.frame = requestAnimationFrame(() => {
      pendingRef.current.frame = requestAnimationFrame(() => {
        bar.style.transition = "width 8s cubic-bezier(0.04, 0.6, 0.3, 0.97)";
        bar.style.width = "85%";
      });
    });
  }, [cancelPending]);

  // Navigation complete — snap bar to 100% then fade out
  const finish = useCallback(() => {
    const bar = barRef.current;
    if (!bar || !activeRef.current) return;
    cancelPending();
    activeRef.current = false;
    bar.setAttribute("aria-hidden", "true");

    bar.style.transition = "width 150ms ease-out";
    bar.style.width = "100%";

    pendingRef.current.timer = setTimeout(() => {
      bar.style.transition = "opacity 200ms ease-out";
      bar.style.opacity = "0";

      pendingRef.current.timer = setTimeout(() => {
        bar.style.transition = "none";
        bar.style.width = "0%";
        bar.style.opacity = "1";
      }, 200);
    }, 150);
  }, [cancelPending]);

  // A link's navigation is done when the URL changes, unless the page is still
  // loading behind its placeholder, which shows in that same commit. This reads
  // the count, because the reported state hasn't caught up with it yet.
  useEffect(() => {
    if (reportedCount.current === 0) finish();
  }, [pathname, searchParams, reportedCount, finish]);

  // A reported navigation (useNavigate) or a page's placeholder runs the bar for as long as it lasts.
  useEffect(() => (reported ? start() : finish()), [reported, start, finish]);

  // Start bar on link click — attach to document so it works regardless of
  // when anchors mount (avoids the MutationObserver timing issues in libraries)
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      // Walk up the tree to find the nearest anchor
      let el = e.target as HTMLElement | null;
      while (el && el.tagName !== "A") el = el.parentElement;
      const anchor = el as HTMLAnchorElement | null;

      if (!anchor) return;
      if (anchor.target === "_blank") return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;

      const href = anchor.getAttribute("href");
      if (!href) return;
      if (href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:")) return;

      // Don't trigger on same-page navigation
      try {
        const target = new URL(href, location.href);
        if (target.href === location.href) return;
      } catch {
        return;
      }

      start();
    }

    document.addEventListener("click", handleClick, true);
    return () => document.removeEventListener("click", handleClick, true);
  }, [start]);

  return (
    <div
      ref={barRef}
      role="progressbar"
      aria-label="Loading page"
      aria-hidden
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        height: "3px",
        width: "0%",
        opacity: 1,
        backgroundColor: color,
        zIndex: 99999,
        pointerEvents: "none",
        transition: "none",
      }}
    />
  );
}

/** The bar along the top of every page, and the context that programmatic navigations report to. */
export function ProgressBar({ color, children }: { color?: string | null; children?: ReactNode }) {
  const [reported, setReported] = useState(0);
  const reportedCount = useRef(0);
  const report = useCallback<ReportNavigation>(() => {
    reportedCount.current += 1;
    setReported((n) => n + 1);
    return () => {
      reportedCount.current -= 1;
      setReported((n) => n - 1);
    };
  }, []);

  return (
    <NavigationProgressContext.Provider value={report}>
      <Suspense>
        <ProgressBarInner color={color ?? "#6366f1"} reported={reported > 0} reportedCount={reportedCount} />
      </Suspense>
      {children}
    </NavigationProgressContext.Provider>
  );
}
