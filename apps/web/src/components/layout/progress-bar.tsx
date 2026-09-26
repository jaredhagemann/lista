"use client";

import {
  createContext,
  useCallback,
  useEffect,
  useRef,
  useState,
  Suspense,
  type ReactNode,
} from "react";
import { usePathname, useSearchParams } from "next/navigation";

/**
 * Registers a navigation that is on its way; the returned function ends it.
 * useNavigate reports through this, because a router.push from a click handler
 * is no anchor click and the bar would otherwise never start.
 */
export type ReportNavigation = () => () => void;

export const NavigationProgressContext = createContext<ReportNavigation | null>(null);

function ProgressBarInner({ color, reported }: { color: string; reported: boolean }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const barRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef(false);

  const start = useCallback(() => {
    const bar = barRef.current;
    if (!bar) return;

    activeRef.current = true;
    // Styled imperatively like the width, so the bar never re-renders mid-navigation.
    bar.setAttribute("aria-hidden", "false");
    bar.style.transition = "none";
    bar.style.width = "0%";
    bar.style.opacity = "1";

    // Double rAF ensures the reset above has painted before we start growing
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        bar.style.transition = "width 8s cubic-bezier(0.04, 0.6, 0.3, 0.97)";
        bar.style.width = "85%";
      });
    });
  }, []);

  // Navigation complete — snap bar to 100% then fade out
  const finish = useCallback(() => {
    const bar = barRef.current;
    if (!bar || !activeRef.current) return;
    activeRef.current = false;
    bar.setAttribute("aria-hidden", "true");

    bar.style.transition = "width 150ms ease-out";
    bar.style.width = "100%";

    const fadeTimer = setTimeout(() => {
      bar.style.transition = "opacity 200ms ease-out";
      bar.style.opacity = "0";

      const resetTimer = setTimeout(() => {
        bar.style.transition = "none";
        bar.style.width = "0%";
        bar.style.opacity = "1";
      }, 200);

      return () => clearTimeout(resetTimer);
    }, 150);

    return () => clearTimeout(fadeTimer);
  }, []);

  // A link's navigation is done when the URL changes.
  useEffect(finish, [pathname, searchParams, finish]);

  // A reported navigation (useNavigate) runs the bar for as long as it is pending.
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
  const report = useCallback<ReportNavigation>(() => {
    setReported((n) => n + 1);
    return () => setReported((n) => n - 1);
  }, []);

  return (
    <NavigationProgressContext.Provider value={report}>
      <Suspense>
        <ProgressBarInner color={color ?? "#6366f1"} reported={reported > 0} />
      </Suspense>
      {children}
    </NavigationProgressContext.Provider>
  );
}
