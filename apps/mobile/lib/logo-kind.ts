/**
 * Whether a stored logo is SVG (review of #102).
 *
 * The web's uploaders accept any image type and keep the original at a path
 * with no extension (org-images/<org>/logo, team-images/<team>/…), so the URL
 * can't say. Storage serves the uploaded content type; one HEAD request per
 * logo asks it. When the server can't be asked, it's tried as an ordinary
 * image, which falls back to initials if it doesn't load.
 */

export type LogoKind = "svg" | "raster";

type Fetch = (uri: string, init: { method: "HEAD" }) => Promise<{ headers: { get(name: string): string | null } }>;

export function createLogoKindResolver(fetchImpl: Fetch) {
  const known = new Map<string, Promise<LogoKind>>();
  return (uri: string): Promise<LogoKind> => {
    let kind = known.get(uri);
    if (!kind) {
      kind = fetchImpl(uri, { method: "HEAD" }).then(
        (res) => (/svg/i.test(res.headers.get("content-type") ?? "") ? "svg" : "raster"),
        () => {
          known.delete(uri); // ask again next time rather than remember an outage
          return "raster" as const;
        }
      );
      known.set(uri, kind);
    }
    return kind;
  };
}

/** The app's resolver: the global fetch, looked up per call so tests can replace it. */
export const logoKind = createLogoKindResolver((uri, init) => fetch(uri, init));
