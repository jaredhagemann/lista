import { ScrollView, Text, TouchableOpacity, View } from "react-native";
import { displayLabel } from "../lib/labels";
import { RemoteLogo } from "./RemoteLogo";

export type TeamCardMember = {
  id: string;
  role: string;
  profiles: { first_name: string | null; last_name: string | null } | null;
};

/** Coaches and staff first, in the roster's order; then players. As on the web. */
const ROLE_ORDER: Record<string, number> = { director: 0, coach: 1, manager: 2, player: 4 };

function nameOf(member: TeamCardMember) {
  return [member.profiles?.first_name, member.profiles?.last_name].filter(Boolean).join(" ") || "Member";
}

/**
 * The home screen's Team card, as the web dashboard's (spec:
 * docs/specs/team-branding-and-labels.md §4): the team's logo (its own, or its
 * club's) or its initials, its own name with the club and season under it, and
 * its members by name and role, each opening their page. A long roster scrolls
 * inside the card, up to a cap, as on a phone-width web page.
 */
export function TeamCard({
  teamName,
  clubName,
  season,
  logoUrl,
  members,
  onOpenMember,
  onOpenRoster,
}: {
  teamName: string;
  clubName: string | null;
  season: string | null;
  logoUrl: string | null;
  members: TeamCardMember[];
  onOpenMember: (memberId: string) => void;
  onOpenRoster: () => void;
}) {
  const listed = members
    .map((member) => ({ ...member, name: nameOf(member) }))
    .sort((a, b) => (ROLE_ORDER[a.role] ?? 3) - (ROLE_ORDER[b.role] ?? 3) || a.name.localeCompare(b.name));
  const subtitle = [clubName, season].filter(Boolean).join(" · ");

  return (
    <View accessibilityLabel="Team" className="bg-white rounded-2xl border border-gray-100 p-4 gap-4">
      <View className="flex-row items-center gap-4">
        <RemoteLogo uri={logoUrl} name={teamName} size={96} tile />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text className="text-xl font-bold text-gray-900" numberOfLines={2}>
            {teamName}
          </Text>
          {subtitle ? <Text className="text-sm text-gray-500">{subtitle}</Text> : null}
        </View>
      </View>

      {listed.length > 0 ? (
        <ScrollView
          accessibilityLabel="Members"
          nestedScrollEnabled
          style={{ maxHeight: 384, borderWidth: 1, borderColor: "#f3f4f6", borderRadius: 8 }}
        >
          {listed.map((member, i) => (
            <TouchableOpacity
              key={member.id}
              accessibilityRole="button"
              accessibilityLabel={`${member.name}, ${displayLabel(member.role)}`}
              onPress={() => onOpenMember(member.id)}
              style={{
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
                paddingHorizontal: 12,
                paddingVertical: 8,
                borderTopWidth: i === 0 ? 0 : 1,
                borderTopColor: "#f3f4f6",
              }}
            >
              <Text className="text-sm font-medium text-gray-900 flex-shrink" numberOfLines={1}>
                {member.name}
              </Text>
              <Text className="text-sm text-gray-500">{displayLabel(member.role)}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      ) : null}

      <View className="flex-row items-center">
        <Text className="text-sm text-gray-500">
          {members.length} {members.length === 1 ? "member" : "members"} ·{" "}
        </Text>
        <TouchableOpacity accessibilityRole="link" onPress={onOpenRoster}>
          <Text className="text-sm text-blue-600">View roster</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}
