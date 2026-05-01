"use client";

import { useEffect, useRef, Suspense } from "react";
import { usePathname, useSearchParams } from "next/navigation";

function ProgressBarInner({ color }: { color: string }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const barRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef(false);

  // Navigation complete — snap bar to 100% then fade out
  useEffect(() => {
    const bar = barRef.current;
    if (!bar || !activeRef.current) return;
    activeRef.current = false;

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
  }, [pathname, searchParams]);

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

      const bar = barRef.current;
      if (!bar) return;

      activeRef.current = true;
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
    }

    document.addEventListener("click", handleClick, true);
    return () => document.removeEventListener("click", handleClick, true);
  }, []);

  return (
    <div
      ref={barRef}
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

export function ProgressBar({ color }: { color?: string | null }) {
  return (
    <Suspense>
      <ProgressBarInner color={color ?? "#6366f1"} />
    </Suspense>
  );
}
