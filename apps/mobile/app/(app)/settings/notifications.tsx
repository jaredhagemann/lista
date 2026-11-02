import { Fragment, useState, useEffect } from "react";
import {
  View,
  Text,
  Switch,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  StyleSheet,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useNavigation } from "expo-router";
import { supabase } from "../../../lib/supabase";
import { useSession } from "../../_layout";
import { useAppContext } from "../../../contexts/AppContext";
import { groupByClub, mutableTeams, teamLabel } from "../../../lib/team-mutes";

type Prefs = {
  email_enabled: boolean;
  push_enabled: boolean;
  chat_push_enabled: boolean;
  chat_digest_enabled: boolean;
};

export default function NotificationsScreen() {
  const navigation = useNavigation();
  const session = useSession();
  const profileId = session?.user.id;
  const { allMemberships, loading: contextLoading } = useAppContext();

  const [prefs, setPrefs] = useState<Prefs>({
    email_enabled: true,
    push_enabled: true,
    chat_push_enabled: true,
    chat_digest_enabled: true,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [muted, setMuted] = useState<ReadonlySet<string>>(() => new Set());
  const [mutesFailed, setMutesFailed] = useState(false);
  // Per team: one team finishing must not free another team still saving (review TM-001).
  const [savingTeams, setSavingTeams] = useState<ReadonlySet<string>>(() => new Set());

  useEffect(() => {
    navigation.setOptions({ title: "Notifications" });
    if (!profileId) return;
    Promise.all([
      supabase
        .from("notification_preferences")
        .select("email_enabled, push_enabled, chat_push_enabled, chat_digest_enabled")
        .eq("profile_id", profileId)
        .maybeSingle(),
      // By profile: a coach can read the whole team's mutes (D4).
      supabase.from("team_notification_mutes").select("team_id").eq("profile_id", profileId),
    ]).then(([{ data }, { data: mutes, error: mutesError }]) => {
      if (data) setPrefs(data as Prefs);
      if (mutesError) setMutesFailed(true);
      else setMuted(new Set((mutes ?? []).map((m: { team_id: string }) => m.team_id)));
      setLoading(false);
    });
  }, [profileId]);

  function toggle(key: keyof Prefs) {
    setPrefs((p) => ({ ...p, [key]: !p[key] }));
  }

  async function setTeamOn(teamId: string, on: boolean) {
    if (!profileId) return;
    const toggled = (set: ReadonlySet<string>, include: boolean) => {
      const copy = new Set(set);
      if (include) copy.add(teamId);
      else copy.delete(teamId);
      return copy;
    };

    setMuted((current) => toggled(current, !on));
    setSavingTeams((current) => toggled(current, true));
    const { error } = on
      ? await supabase
          .from("team_notification_mutes")
          .delete()
          .eq("profile_id", profileId)
          .eq("team_id", teamId)
      : await supabase
          .from("team_notification_mutes")
          .upsert({ profile_id: profileId, team_id: teamId, email_muted: true, push_muted: true });
    setSavingTeams((current) => toggled(current, false));

    if (error) {
      setMuted((current) => toggled(current, on));
      Alert.alert("Error", `Couldn't save: ${error.message}`);
    }
  }

  async function handleSave() {
    if (!profileId) return;
    setSaving(true);
    const { error } = await supabase
      .from("notification_preferences")
      .upsert({ profile_id: profileId, ...prefs }, { onConflict: "profile_id" });
    setSaving(false);
    if (error) {
      Alert.alert("Error", error.message);
    } else {
      navigation.goBack();
    }
  }

  if (loading || contextLoading) {
    return (
      <SafeAreaView style={styles.center} edges={["bottom"]}>
        <ActivityIndicator size="large" color="#0f172a" />
      </SafeAreaView>
    );
  }

  const teams = mutableTeams(allMemberships);

  return (
    <SafeAreaView style={styles.container} edges={["bottom"]}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.sectionLabel}>Events</Text>
        <View style={styles.card}>
          <PrefRow
            label="Email notifications"
            sublabel="Event reminders and updates via email"
            value={prefs.email_enabled}
            onToggle={() => toggle("email_enabled")}
          />
          <View style={styles.separator} />
          <PrefRow
            label="Push notifications"
            sublabel="Event alerts on your device"
            value={prefs.push_enabled}
            onToggle={() => toggle("push_enabled")}
          />
        </View>

        <Text style={styles.sectionLabel}>Chat</Text>
        <View style={styles.card}>
          <PrefRow
            label="Chat push notifications"
            sublabel="Alerts for new messages"
            value={prefs.chat_push_enabled}
            onToggle={() => toggle("chat_push_enabled")}
          />
          <View style={styles.separator} />
          <PrefRow
            label="Chat digest emails"
            sublabel="Daily summary of unread messages"
            value={prefs.chat_digest_enabled}
            onToggle={() => toggle("chat_digest_enabled")}
          />
        </View>

        <TouchableOpacity
          style={[styles.saveButton, saving && { opacity: 0.6 }]}
          onPress={handleSave}
          disabled={saving}
        >
          {saving ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.saveButtonText}>Save preferences</Text>
          )}
        </TouchableOpacity>

        {/* Below the button, which saves only the switches above it (spec §3.4). */}
        <Text style={[styles.sectionLabel, styles.teamsLabel]}>Teams</Text>
        <Text style={styles.teamsNote}>
          Turn a team off to stop its emails and push notifications, including its chat. Your other teams
          aren't affected. These save as you switch them.
        </Text>
        {mutesFailed ? (
          <Text style={styles.teamsNote}>Couldn't load your teams. Go back and try again.</Text>
        ) : teams.length === 0 ? (
          <Text style={styles.teamsNote}>You're not on any teams yet.</Text>
        ) : (
          groupByClub(teams).map((group) => (
            <Fragment key={group.key}>
              {group.heading && <Text style={styles.groupLabel}>{group.heading}</Text>}
              <View style={styles.card}>
                {group.teams.map((team, i) => {
                  const label = teamLabel(team);
                  return (
                    <Fragment key={team.id}>
                      {i > 0 && <View style={styles.separator} />}
                      <View style={styles.row}>
                        <Text style={[styles.rowLabel, { flex: 1 }]}>{label}</Text>
                        <Switch
                          accessibilityLabel={`Notifications from ${label}`}
                          value={!muted.has(team.id)}
                          disabled={savingTeams.has(team.id)}
                          onValueChange={(on) => setTeamOn(team.id, on)}
                          trackColor={{ true: "#0f172a", false: "#e5e7eb" }}
                          thumbColor="#ffffff"
                        />
                      </View>
                    </Fragment>
                  );
                })}
              </View>
            </Fragment>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function PrefRow({
  label,
  sublabel,
  value,
  onToggle,
}: {
  label: string;
  sublabel: string;
  value: boolean;
  onToggle: () => void;
}) {
  return (
    <View style={styles.row}>
      <View style={{ flex: 1 }}>
        <Text style={styles.rowLabel}>{label}</Text>
        <Text style={styles.rowSublabel}>{sublabel}</Text>
      </View>
      <Switch
        value={value}
        onValueChange={onToggle}
        trackColor={{ true: "#0f172a", false: "#e5e7eb" }}
        thumbColor="#ffffff"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f9fafb" },
  center: { flex: 1, backgroundColor: "#fff", justifyContent: "center", alignItems: "center" },
  scroll: { padding: 16, gap: 8 },
  sectionLabel: {
    fontSize: 11,
    fontWeight: "600",
    color: "#9ca3af",
    textTransform: "uppercase",
    letterSpacing: 0.8,
    marginBottom: 6,
    marginLeft: 4,
  },
  teamsLabel: { marginTop: 20, marginBottom: 0 },
  teamsNote: { fontSize: 12, color: "#6b7280", marginHorizontal: 4, marginBottom: 6 },
  groupLabel: { fontSize: 13, fontWeight: "600", color: "#374151", marginTop: 6, marginLeft: 4 },
  card: {
    backgroundColor: "#ffffff",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#f3f4f6",
    overflow: "hidden",
    marginBottom: 8,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 13,
    gap: 12,
  },
  rowLabel: { fontSize: 15, fontWeight: "500", color: "#111827" },
  rowSublabel: { fontSize: 12, color: "#9ca3af", marginTop: 2 },
  separator: { height: 1, backgroundColor: "#f9fafb", marginLeft: 16 },
  saveButton: {
    backgroundColor: "#0f172a",
    borderRadius: 14,
    paddingVertical: 15,
    alignItems: "center",
    marginTop: 8,
  },
  saveButtonText: { color: "#ffffff", fontSize: 15, fontWeight: "600" },
});
