// @vitest-environment jsdom
/**
 * BUG-045: the progress bar runs until the page's content is on screen.
 *
 * The URL changes in the same commit that shows a route's loading placeholder,
 * and the bar used to end on the URL change, while the page was still loading.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, type ReactNode } from "react";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";

const nav = vi.hoisted(() => ({
  pathname: "/dashboard/club",
  searchParams: new URLSearchParams(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => nav.pathname,
  useSearchParams: () => nav.searchParams,
}));

import { ProgressBar } from "@/components/layout/progress-bar";
import { PageSkeleton } from "@/components/layout/page-skeleton";

const EVENT_HREF = "/dashboard/schedule/e-1";

function app(page: ReactNode) {
  return (
    <ProgressBar>
      <a href={EVENT_HREF} onClick={(e) => e.preventDefault()}>
        Open
      </a>
      {page}
    </ProgressBar>
  );
}

const running = () => screen.queryByRole("progressbar", { name: "Loading page" }) !== null;
const bar = () => screen.getByRole("progressbar", { hidden: true });

function clickAndArriveAt(page: ReactNode, rerender: (ui: ReactNode) => void) {
  fireEvent.click(screen.getByText("Open"));
  nav.pathname = EVENT_HREF;
  rerender(app(page));
}

beforeEach(() => {
  vi.useFakeTimers();
  nav.pathname = "/dashboard/club";
  nav.searchParams = new URLSearchParams();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("a page with a loading placeholder", () => {
  it("keeps the bar running when the URL changes and the placeholder appears", () => {
    const { rerender } = render(app(<p>Club</p>));

    clickAndArriveAt(<PageSkeleton />, rerender);

    expect(running()).toBe(true);
  });

  it("ends the bar when the content replaces the placeholder", () => {
    const { rerender } = render(app(<p>Club</p>));
    clickAndArriveAt(<PageSkeleton />, rerender);

    rerender(app(<p>The event</p>));

    expect(running()).toBe(false);
  });

  it("ends the bar when the placeholder goes away because the page failed", () => {
    const { rerender } = render(app(<p>Club</p>));
    clickAndArriveAt(<PageSkeleton />, rerender);

    rerender(app(<p>Something went wrong</p>));

    expect(running()).toBe(false);
  });

  it("carries on from where it is, without going back to the start", () => {
    const { rerender } = render(app(<p>Club</p>));
    fireEvent.click(screen.getByText("Open"));
    // Stands in for the width the bar has grown to by now.
    bar().style.width = "40%";

    nav.pathname = EVENT_HREF;
    rerender(app(<PageSkeleton />));

    expect(bar().style.width).toBe("40%");
  });

  it("runs the bar for a placeholder no click started, such as the back button", () => {
    const { rerender } = render(app(<p>Club</p>));

    nav.pathname = "/dashboard/schedule";
    rerender(app(<PageSkeleton />));

    expect(running()).toBe(true);
  });

  it("stays visible when one placeholder follows another", () => {
    const { rerender } = render(app(<p>Club</p>));
    clickAndArriveAt(<PageSkeleton key="first" />, rerender);

    rerender(app(<p>Between</p>));
    rerender(app(<PageSkeleton key="second" />));
    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(running()).toBe(true);
    expect(bar().style.opacity).toBe("1");
    expect(bar().style.width).not.toBe("0%");
  });
});

describe("a page without a placeholder", () => {
  it("ends the bar when the URL changes", () => {
    const { rerender } = render(app(<p>Club</p>));

    clickAndArriveAt(<p>The event</p>, rerender);

    expect(running()).toBe(false);
  });

  it("fades the bar out even if the URL changes again straight away", () => {
    const { rerender } = render(app(<p>Club</p>));
    clickAndArriveAt(<p>The event</p>, rerender);

    // A team switch tidies the URL just after arriving.
    nav.searchParams = new URLSearchParams("switched=1");
    rerender(app(<p>The event</p>));
    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(bar().style.width).toBe("0%");
  });
});
