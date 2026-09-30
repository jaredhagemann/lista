/**
 * Team and club logos render whatever format was uploaded (review of #102).
 *
 * The web's uploaders accept any image type and store the original, SVG
 * included, at a path with no extension. React Native's Image can't draw SVG,
 * so an SVG logo (a club's, inherited by its teams, or a team's own) showed as a
 * blank circle with no initials. RemoteLogo asks the server what the file is,
 * draws SVG with react-native-svg and anything else with Image, and shows the
 * initials when there's no logo or it fails to load.
 */

import React from "react";
import { Image } from "react-native";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react-native";

jest.mock("react-native-svg", () => {
  const { View } = require("react-native");
  return { SvgUri: (props: Record<string, unknown>) => <View testID="svg-logo" {...props} /> };
});

import { createLogoKindResolver } from "../lib/logo-kind";
import { RemoteLogo } from "../components/RemoteLogo";

const SVG = "https://x.supabase.co/storage/v1/object/public/org-images/org-1/logo?t=1";
const PNG = "https://x.supabase.co/storage/v1/object/public/team-images/t-1/logo?t=2";

function respond(types: Record<string, string>) {
  return jest.fn(async (uri: string) => ({
    ok: true,
    headers: { get: (name: string) => (name.toLowerCase() === "content-type" ? types[uri] ?? null : null) },
  }));
}

describe("createLogoKindResolver", () => {
  it("reads the format from the server's content type, once per logo", async () => {
    const fetchImpl = respond({ [SVG]: "image/svg+xml", [PNG]: "image/png" });
    const kindOf = createLogoKindResolver(fetchImpl as never);

    expect(await kindOf(SVG)).toBe("svg");
    expect(await kindOf(PNG)).toBe("raster");
    expect(await kindOf(SVG)).toBe("svg");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl).toHaveBeenCalledWith(SVG, { method: "HEAD" });
  });

  it("tries an ordinary image when the server can't be asked, and asks again next time", async () => {
    const fetchImpl = jest
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockImplementation(respond({ [SVG]: "image/svg+xml" }));
    const kindOf = createLogoKindResolver(fetchImpl as never);

    expect(await kindOf(SVG)).toBe("raster");
    expect(await kindOf(SVG)).toBe("svg");
  });
});

describe("RemoteLogo", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function withServer(types: Record<string, string>) {
    globalThis.fetch = respond(types) as never;
  }

  it("draws an SVG logo as SVG", async () => {
    withServer({ [SVG]: "image/svg+xml" });
    render(<RemoteLogo uri={SVG} name="12U Girls" size={36} />);

    const svg = await screen.findByTestId("svg-logo");
    expect(svg.props.uri).toBe(SVG);
    expect(screen.UNSAFE_queryAllByType(Image)).toHaveLength(0);
  });

  it("draws any other logo as an image", async () => {
    withServer({ [PNG]: "image/png" });
    render(<RemoteLogo uri={PNG} name="12U Girls" size={36} />);

    await waitFor(() => expect(screen.UNSAFE_getAllByType(Image)[0].props.source).toEqual({ uri: PNG }));
    expect(screen.queryByTestId("svg-logo")).toBeNull();
  });

  it("shows the initials without a logo", () => {
    render(<RemoteLogo uri={null} name="12U Girls" size={36} />);

    expect(screen.getByText("1G")).toBeTruthy();
  });

  it("shows the initials when a logo fails to load, in either format", async () => {
    withServer({ [PNG]: "image/png", [SVG]: "image/svg+xml" });
    const { unmount } = render(<RemoteLogo uri={PNG} name="12U Girls" size={36} />);
    await waitFor(() => expect(screen.UNSAFE_getAllByType(Image)).toHaveLength(1));
    act(() => fireEvent(screen.UNSAFE_getAllByType(Image)[0], "error"));
    expect(screen.getByText("1G")).toBeTruthy();
    unmount();

    render(<RemoteLogo uri={SVG} name="12U Girls" size={36} />);
    const svg = await screen.findByTestId("svg-logo");
    act(() => svg.props.onError(new Error("bad svg")));
    expect(screen.getByText("1G")).toBeTruthy();
  });
});
