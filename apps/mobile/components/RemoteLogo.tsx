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
 * A team's (or its club's) logo in a circle, whatever format was uploaded.
 *
 * Image can't draw SVG, which the web's uploaders accept, so the format is
 * asked first (lib/logo-kind) and SVG goes to react-native-svg. Without a logo,
 * or when one fails to load, the team's initials show instead.
 */
export function RemoteLogo({ uri, name, size }: { uri: string | null; name: string; size: number }) {
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

  const circle = { width: size, height: size, borderRadius: size / 2 };

  if (!uri || failed) {
    return (
      <View style={[circle, { backgroundColor: "#0f172a", alignItems: "center", justifyContent: "center" }]}>
        <Text style={{ color: "#fff", fontSize: size * 0.35, fontWeight: "700" }}>{teamInitials(name)}</Text>
      </View>
    );
  }

  // Asking the format: hold the space.
  if (!kind) return <View style={[circle, { backgroundColor: "#f3f4f6" }]} />;

  if (kind === "svg") {
    return (
      <View style={[circle, { overflow: "hidden" }]}>
        <SvgUri uri={uri} width={size} height={size} onError={() => setFailed(true)} />
      </View>
    );
  }

  return <Image source={{ uri }} style={circle} onError={() => setFailed(true)} />;
}
