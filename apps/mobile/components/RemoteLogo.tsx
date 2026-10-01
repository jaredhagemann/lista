import { useEffect, useState } from "react";
import { Image, Text, View } from "react-native";
import { SvgUri } from "react-native-svg";
import { logoKind, type LogoKind } from "../lib/logo-kind";

export function teamInitials(name: string) {
  return name
    .split(" ")
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
}

/**
 * A team's (or its club's) logo, whatever format was uploaded: in a circle (the
 * top strip, the team picker), or with `tile` as the Team card's rounded square,
 * fitted whole and with muted initials, as on the web.
 *
 * Image can't draw SVG, which the web's uploaders accept, so the format is
 * asked first (lib/logo-kind) and SVG goes to react-native-svg. Without a logo,
 * or when one fails to load, the team's initials show instead.
 */
export function RemoteLogo({
  uri,
  name,
  size,
  tile = false,
}: {
  uri: string | null;
  name: string;
  size: number;
  tile?: boolean;
}) {
  const [kind, setKind] = useState<LogoKind | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setKind(null);
    setFailed(false);
    if (!uri) return;
    let current = true;
    logoKind(uri).then((k) => {
      if (current) setKind(k);
    });
    return () => {
      current = false;
    };
  }, [uri]);

  const shape = { width: size, height: size, borderRadius: tile ? 12 : size / 2 };

  if (!uri || failed) {
    return (
      <View
        style={[shape, { backgroundColor: tile ? "#f3f4f6" : "#0f172a", alignItems: "center", justifyContent: "center" }]}
      >
        <Text
          style={{
            color: tile ? "#6b7280" : "#fff",
            fontSize: size * (tile ? 0.3 : 0.35),
            fontWeight: tile ? "600" : "700",
          }}
        >
          {teamInitials(name)}
        </Text>
      </View>
    );
  }

  // Asking the format: hold the space.
  if (!kind) return <View style={[shape, { backgroundColor: "#f3f4f6" }]} />;

  if (kind === "svg") {
    return (
      <View style={[shape, { overflow: "hidden" }]}>
        <SvgUri uri={uri} width={size} height={size} onError={() => setFailed(true)} />
      </View>
    );
  }

  return (
    <Image
      source={{ uri }}
      style={shape}
      resizeMode={tile ? "contain" : "cover"}
      onError={() => setFailed(true)}
    />
  );
}
