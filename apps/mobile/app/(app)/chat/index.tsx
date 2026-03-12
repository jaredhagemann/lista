import { useEffect, useState, useRef, useCallback } from "react";
import {
  View,
  Text,
  SectionList,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Modal,
  ScrollView,
  TextInput,
  StyleSheet,
  Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useNavigation } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "../../../lib/supabase";
import { useAppContext } from "../../../contexts/AppContext";
import { useSession } from "../../_layout";
import type { RealtimeChannel } from "@supabase/supabase-js";

// ── Types ─────────────────────────────────────────────────────────────────────

type TeamChannel = { id: string; name: string; team_id: string };

type GroupChannel = {
  id: string;
  name: string;
  team_id: string;
  last_read_at: string;
};

type DmChannel = {
  id: string;
  team_id: string;
  profile_a: string;
  profile_b: string;
  last_read_a: string;
  last_read_b: string;
  otherProfile: { id: string; first_name: string; last_name: string };
};

type MemberManager = {
  profileId: string;
  firstName: string;
  lastName: string;
  relationship: string | null;
};

type TeamMember = {
  profile_id: string;
  auth_user_id: string | null;
  profiles: { id: string; first_name: string; last_name: string };
  managers: MemberManager[]; // empty = has own account; populated = managed profile
};

type UnreadMap = Record<string, number>;

type Section = {
  title: string;
  type: "team" | "dm" | "group";
  data: any[];
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function initials(first: string, last: string) {
  return ((first?.[0] ?? "") + (last?.[0] ?? "")).toUpperCase();
}

function UnreadBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <View style={styles.badge}>
      <Text style={styles.badgeText}>{count > 99 ? "99+" : count}</Text>
    </View>
  );
}

// ── New DM Sheet ──────────────────────────────────────────────────────────────

function NewDmSheet({
  visible,
  onClose,
  members,
  teamId,
  ownId,
  onCreated,
}: {
  visible: boolean;
  onClose: () => void;
  members: TeamMember[];
  teamId: string;
  ownId: string;
  onCreated: (dm: DmChannel) => void;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const filtered = members
    .filter((m) => m.profile_id !== ownId)
    .filter((m) => {
      const name = [m.profiles.first_name, m.profiles.last_name]
        .join(" ")
        .toLowerCase();
      return name.includes(query.toLowerCase());
    });

  async function startDm(profileId: string) {
    setLoading(profileId);
    const [profileA, profileB] = [ownId, profileId].sort();
    await supabase
      .from("dm_channels")
      .insert({ team_id: teamId, profile_a: profileA, profile_b: profileB })
      .select()
      .maybeSingle();

    const { data } = await supabase
      .from("dm_channels")
      .select("*")
      .eq("team_id", teamId)
      .eq("profile_a", profileA)
      .eq("profile_b", profileB)
      .single();

    if (data) {
      onClose();
      setExpandedId(null);
      router.push(`/(app)/chat/dm/${data.id}` as any);
    }
    setLoading(null);
  }

  function handleRowPress(m: TeamMember) {
    if (m.managers.length === 0) {
      startDm(m.profile_id);
    } else if (m.managers.length === 1) {
      startDm(m.managers[0].profileId);
    } else {
      setExpandedId((prev) => (prev === m.profile_id ? null : m.profile_id));
    }
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.sheetOverlay}>
        <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={onClose} />
        <View style={styles.sheet}>
          <View style={styles.sheetHandle} />
          <Text style={styles.sheetTitle}>New Message</Text>
          <TextInput
            style={styles.searchInput}
            value={query}
            onChangeText={setQuery}
            placeholder="Search teammates…"
            placeholderTextColor="#9ca3af"
            autoFocus
          />
          <ScrollView bounces={false}>
            {filtered.map((m) => {
              const isExpanded = expandedId === m.profile_id;
              const multiManager = m.managers.length > 1;
              return (
                <View key={m.profile_id}>
                  <TouchableOpacity
                    style={styles.memberRow}
                    onPress={() => handleRowPress(m)}
                    disabled={loading !== null}
                  >
                    <View style={styles.memberAvatar}>
                      <Text style={styles.memberAvatarText}>
                        {initials(m.profiles.first_name, m.profiles.last_name)}
                      </Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.memberName}>
                        {m.profiles.first_name} {m.profiles.last_name}
                      </Text>
                      {m.managers.length === 1 && (
                        <Text style={styles.managerHint}>
                          via {m.managers[0].firstName} {m.managers[0].lastName}
                        </Text>
                      )}
                    </View>
                    {multiManager && (
                      <Ionicons
                        name={isExpanded ? "chevron-up" : "chevron-down"}
                        size={16}
                        color="#9ca3af"
                      />
                    )}
                    {loading !== null && loading !== m.profile_id ? null :
                      loading === m.profile_id ? <ActivityIndicator size="small" color="#0f172a" /> : null}
                  </TouchableOpacity>

                  {isExpanded && (
                    <View style={styles.subList}>
                      <Text style={styles.subListLabel}>
                        Contact {m.profiles.first_name} via:
                      </Text>
                      {m.managers.map((mgr) => (
                        <TouchableOpacity
                          key={mgr.profileId}
                          style={styles.subRow}
                          onPress={() => startDm(mgr.profileId)}
                          disabled={loading === mgr.profileId}
                        >
                          <View style={styles.subAvatar}>
                            <Text style={styles.memberAvatarText}>
                              {initials(mgr.firstName, mgr.lastName)}
                            </Text>
                          </View>
                          <Text style={[styles.memberName, { flex: 1 }]}>
                            {mgr.firstName} {mgr.lastName}
                          </Text>
                          {mgr.relationship && (
                            <Text style={styles.managerHint}>{mgr.relationship}</Text>
                          )}
                          {loading === mgr.profileId && (
                            <ActivityIndicator size="small" color="#0f172a" />
                          )}
                        </TouchableOpacity>
                      ))}
                    </View>
                  )}
                </View>
              );
            })}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

// ── New Group Sheet ───────────────────────────────────────────────────────────

function NewGroupSheet({
  visible,
  onClose,
  members,
  teamId,
  ownId,
  onCreated,
}: {
  visible: boolean;
  onClose: () => void;
  members: TeamMember[];
  teamId: string;
  ownId: string;
  onCreated: (channel: GroupChannel) => void;
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const others = members.filter((m) => m.profile_id !== ownId);

  function resolvedIds(m: TeamMember): string[] {
    if (m.managers.length === 0) return [m.profile_id];
    return m.managers.map((mgr) => mgr.profileId);
  }

  function toggleMember(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function handleGroupRowPress(m: TeamMember) {
    if (m.managers.length <= 1) {
      const id = m.managers.length === 1 ? m.managers[0].profileId : m.profile_id;
      toggleMember(id);
    } else {
      setExpandedId((prev) => (prev === m.profile_id ? null : m.profile_id));
    }
  }

  async function handleCreate() {
    if (!name.trim()) return Alert.alert("Name required", "Enter a group name.");
    setLoading(true);
    const channelId = crypto.randomUUID();
    const { error: chanErr } = await supabase.from("channels").insert({
      id: channelId,
      team_id: teamId,
      name: name.trim(),
      type: "group",
      created_by: ownId,
    });
    if (chanErr) {
      Alert.alert("Error", chanErr.message);
      setLoading(false);
      return;
    }
    const memberIds = [ownId, ...Array.from(selected)];
    await supabase
      .from("channel_members")
      .insert(memberIds.map((id) => ({ channel_id: channelId, profile_id: id })));

    onClose();
    router.push(`/(app)/chat/${channelId}` as any);
    setLoading(false);
    setName("");
    setSelected(new Set());
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.sheetOverlay}>
        <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={onClose} />
        <View style={[styles.sheet, { maxHeight: "80%" }]}>
          <View style={styles.sheetHandle} />
          <Text style={styles.sheetTitle}>New Group</Text>
          <TextInput
            style={[styles.searchInput, { marginBottom: 8 }]}
            value={name}
            onChangeText={setName}
            placeholder="Group name…"
            placeholderTextColor="#9ca3af"
            autoFocus
          />
          <Text style={styles.sheetSub}>Add members</Text>
          <ScrollView bounces={false} style={{ maxHeight: 300 }}>
            {others.map((m) => {
              const ids = resolvedIds(m);
              const anySelected = ids.some((id) => selected.has(id));
              const isExpanded = expandedId === m.profile_id;
              const multiManager = m.managers.length > 1;
              return (
                <View key={m.profile_id}>
                  <TouchableOpacity
                    style={styles.memberRow}
                    onPress={() => handleGroupRowPress(m)}
                  >
                    <View style={styles.memberAvatar}>
                      <Text style={styles.memberAvatarText}>
                        {initials(m.profiles.first_name, m.profiles.last_name)}
                      </Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.memberName}>
                        {m.profiles.first_name} {m.profiles.last_name}
                      </Text>
                      {m.managers.length === 1 && (
                        <Text style={styles.managerHint}>
                          via {m.managers[0].firstName} {m.managers[0].lastName}
                        </Text>
                      )}
                    </View>
                    {multiManager ? (
                      <Ionicons
                        name={isExpanded ? "chevron-up" : "chevron-down"}
                        size={18}
                        color="#9ca3af"
                      />
                    ) : (
                      <Ionicons
                        name={anySelected ? "checkmark-circle" : "ellipse-outline"}
                        size={22}
                        color={anySelected ? "#0f172a" : "#d1d5db"}
                      />
                    )}
                  </TouchableOpacity>

                  {isExpanded && (
                    <View style={styles.subList}>
                      <Text style={styles.subListLabel}>
                        Add contacts for {m.profiles.first_name}:
                      </Text>
                      {m.managers.map((mgr) => {
                        const isSel = selected.has(mgr.profileId);
                        return (
                          <TouchableOpacity
                            key={mgr.profileId}
                            style={styles.subRow}
                            onPress={() => toggleMember(mgr.profileId)}
                          >
                            <View style={styles.subAvatar}>
                              <Text style={styles.memberAvatarText}>
                                {initials(mgr.firstName, mgr.lastName)}
                              </Text>
                            </View>
                            <Text style={[styles.memberName, { flex: 1 }]}>
                              {mgr.firstName} {mgr.lastName}
                            </Text>
                            {mgr.relationship && (
                              <Text style={styles.managerHint}>{mgr.relationship}</Text>
                            )}
                            <Ionicons
                              name={isSel ? "checkmark-circle" : "ellipse-outline"}
                              size={20}
                              color={isSel ? "#0f172a" : "#d1d5db"}
                            />
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  )}
                </View>
              );
            })}
          </ScrollView>
          <TouchableOpacity
            style={[styles.createButton, loading && { opacity: 0.6 }]}
            onPress={handleCreate}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.createButtonText}>Create Group</Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

// ── Main Screen ───────────────────────────────────────────────────────────────

export default function ChatScreen() {
  const session = useSession();
  const { membership, ownProfile, loading: membershipLoading } = useAppContext();
  const router = useRouter();
  const navigation = useNavigation();

  const ownId = session?.user.id ?? "";

  const [teamChannel, setTeamChannel] = useState<TeamChannel | null>(null);
  const [groups, setGroups] = useState<GroupChannel[]>([]);
  const [dms, setDms] = useState<DmChannel[]>([]);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [unread, setUnread] = useState<UnreadMap>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [dmSheetOpen, setDmSheetOpen] = useState(false);
  const [groupSheetOpen, setGroupSheetOpen] = useState(false);

  const realtimeRef = useRef<RealtimeChannel | null>(null);
  const channelIdsRef = useRef<Set<string>>(new Set());
  const dmIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    navigation.setOptions({
      title: "Chat",
      headerRight: () => (
        <View style={{ flexDirection: "row", gap: 12, marginRight: 4 }}>
          <TouchableOpacity onPress={() => setGroupSheetOpen(true)}>
            <Ionicons name="people-outline" size={22} color="#0f172a" />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setDmSheetOpen(true)}>
            <Ionicons name="create-outline" size={22} color="#0f172a" />
          </TouchableOpacity>
        </View>
      ),
    });
  }, []);

  const fetchData = useCallback(async () => {
    if (!membership?.teamId || !ownId) return;

    const [teamChanResult, groupResult, dmResult, membersResult] = await Promise.all([
      supabase
        .from("channels")
        .select("id, name, team_id")
        .eq("team_id", membership.teamId)
        .eq("type", "team")
        .maybeSingle(),
      supabase
        .from("channel_members")
        .select("channel_id, last_read_at, channels!inner(id, name, team_id, type)")
        .eq("profile_id", ownId)
        .eq("channels.type", "group")
        .eq("channels.team_id", membership.teamId),
      supabase
        .from("dm_channels")
        .select("*")
        .eq("team_id", membership.teamId)
        .or(`profile_a.eq.${ownId},profile_b.eq.${ownId}`),
      supabase
        .from("team_members")
        .select("profile_id, profiles(id, first_name, last_name, auth_user_id)")
        .eq("team_id", membership.teamId),
    ]);

    const tc = teamChanResult.data as TeamChannel | null;
    setTeamChannel(tc);

    const grps: GroupChannel[] = ((groupResult.data ?? []) as any[]).map((r) => ({
      id: r.channels.id,
      name: r.channels.name,
      team_id: r.channels.team_id,
      last_read_at: r.last_read_at,
    }));
    setGroups(grps);

    // Resolve DMs: find other profile for each
    const rawDms = (dmResult.data ?? []) as any[];
    const otherIds = rawDms.map((d) =>
      d.profile_a === ownId ? d.profile_b : d.profile_a
    );
    let profileMap: Record<string, { id: string; first_name: string; last_name: string }> = {};
    if (otherIds.length > 0) {
      const { data: profileData } = await supabase
        .from("profiles")
        .select("id, first_name, last_name")
        .in("id", otherIds);
      for (const p of profileData ?? []) profileMap[p.id] = p;
    }
    const resolvedDms: DmChannel[] = rawDms
      .map((d) => {
        const otherId = d.profile_a === ownId ? d.profile_b : d.profile_a;
        const otherProfile = profileMap[otherId];
        if (!otherProfile) return null;
        return { ...d, otherProfile };
      })
      .filter(Boolean) as DmChannel[];
    setDms(resolvedDms);

    const rawMems = (membersResult.data ?? []) as unknown as Array<{
      profile_id: string;
      profiles: { id: string; first_name: string; last_name: string; auth_user_id: string | null };
    }>;

    // Enrich managed profiles with their manager accounts
    const managedIds = rawMems
      .filter((m) => !m.profiles?.auth_user_id)
      .map((m) => m.profile_id)
      .filter(Boolean);

    const managerMap: Record<string, MemberManager[]> = {};
    if (managedIds.length > 0) {
      const { data: pmRows } = await supabase
        .from("profile_managers")
        .select("managed_id, manager_id, relationship, profiles!profile_managers_manager_id_fkey(id, first_name, last_name)")
        .in("managed_id", managedIds);
      for (const row of (pmRows ?? []) as any[]) {
        const mgr: MemberManager = {
          profileId: row.manager_id,
          firstName: row.profiles.first_name,
          lastName: row.profiles.last_name,
          relationship: row.relationship,
        };
        managerMap[row.managed_id] = [...(managerMap[row.managed_id] ?? []), mgr];
      }
    }

    const mems: TeamMember[] = rawMems.map((m) => ({
      profile_id: m.profile_id,
      auth_user_id: m.profiles?.auth_user_id ?? null,
      profiles: m.profiles,
      managers: m.profiles?.auth_user_id ? [] : (managerMap[m.profile_id] ?? []),
    }));
    setMembers(mems);

    // Compute unread counts
    const allChannelIds = [tc?.id, ...grps.map((g) => g.id)].filter(Boolean) as string[];
    channelIdsRef.current = new Set(allChannelIds);
    dmIdsRef.current = new Set(resolvedDms.map((d) => d.id));

    const unreadResults = await Promise.all([
      // Team channel
      tc
        ? supabase
            .from("messages")
            .select("id", { count: "exact", head: true })
            .eq("channel_id", tc.id)
            .neq("sender_id", ownId)
            .is("deleted_at", null)
            // last_read_at for team channel — fetch from channel_members
            .then(async (r) => {
              const { data: readRow } = await supabase
                .from("channel_members")
                .select("last_read_at")
                .eq("channel_id", tc.id)
                .eq("profile_id", ownId)
                .maybeSingle();
              const { count } = await supabase
                .from("messages")
                .select("id", { count: "exact", head: true })
                .eq("channel_id", tc.id)
                .neq("sender_id", ownId)
                .is("deleted_at", null)
                .gt("created_at", readRow?.last_read_at ?? "1970-01-01");
              return { id: tc.id, count: count ?? 0 };
            })
        : Promise.resolve(null),
      // Group channels
      ...grps.map(async (g) => {
        const { count } = await supabase
          .from("messages")
          .select("id", { count: "exact", head: true })
          .eq("channel_id", g.id)
          .neq("sender_id", ownId)
          .is("deleted_at", null)
          .gt("created_at", g.last_read_at ?? "1970-01-01");
        return { id: g.id, count: count ?? 0 };
      }),
      // DMs
      ...resolvedDms.map(async (d) => {
        const lastRead =
          d.profile_a === ownId ? d.last_read_a : d.last_read_b;
        const { count } = await supabase
          .from("messages")
          .select("id", { count: "exact", head: true })
          .eq("dm_channel_id", d.id)
          .neq("sender_id", ownId)
          .is("deleted_at", null)
          .gt("created_at", lastRead ?? "1970-01-01");
        return { id: d.id, count: count ?? 0 };
      }),
    ]);

    const newUnread: UnreadMap = {};
    for (const r of unreadResults) {
      if (r) newUnread[r.id] = r.count;
    }
    setUnread(newUnread);
    setLoading(false);
    setRefreshing(false);
  }, [membership?.teamId, ownId]);

  useEffect(() => {
    if (membershipLoading) return;
    fetchData();
  }, [membership?.teamId, membershipLoading]);

  // Realtime: increment unread badges for new messages
  useEffect(() => {
    if (!ownId) return;
    const channel = supabase
      .channel("chat-list-unread")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages" },
        (payload) => {
          const msg = payload.new as any;
          if (msg.sender_id === ownId) return;
          const id = msg.channel_id ?? msg.dm_channel_id;
          if (!id) return;
          if (
            channelIdsRef.current.has(id) ||
            dmIdsRef.current.has(id)
          ) {
            setUnread((prev) => ({ ...prev, [id]: (prev[id] ?? 0) + 1 }));
          }
        }
      )
      .subscribe();
    realtimeRef.current = channel;
    return () => {
      supabase.removeChannel(channel);
    };
  }, [ownId]);

  function onRefresh() {
    setRefreshing(true);
    fetchData();
  }

  // ── Sections ───────────────────────────────────────────────────────────────

  const sections: Section[] = [];
  if (teamChannel) {
    sections.push({ title: "Team", type: "team", data: [teamChannel] });
  }
  if (dms.length > 0) {
    sections.push({ title: "Direct Messages", type: "dm", data: dms });
  }
  if (groups.length > 0) {
    sections.push({ title: "Groups", type: "group", data: groups });
  }

  if (membershipLoading || loading) {
    return (
      <SafeAreaView style={styles.center} edges={["bottom"]}>
        <ActivityIndicator size="large" color="#0f172a" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={["bottom"]}>
      <SectionList
        sections={sections}
        keyExtractor={(item) => item.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        contentContainerStyle={{ paddingVertical: 8 }}
        stickySectionHeadersEnabled
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="chatbubbles-outline" size={48} color="#d1d5db" />
            <Text style={styles.emptyText}>No conversations yet.</Text>
          </View>
        }
        renderSectionHeader={({ section }) => (
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionHeaderText}>{section.title}</Text>
          </View>
        )}
        renderItem={({ item, section }) => {
          const count = unread[item.id] ?? 0;

          if (section.type === "team") {
            return (
              <TouchableOpacity
                style={styles.row}
                onPress={() => {
                  setUnread((p) => ({ ...p, [item.id]: 0 }));
                  router.push(`/(app)/chat/${item.id}` as any);
                }}
              >
                <View style={[styles.channelIcon, { backgroundColor: "#0f172a" }]}>
                  <Ionicons name="people" size={16} color="#fff" />
                </View>
                <Text style={styles.rowName}>Team Chat</Text>
                <UnreadBadge count={count} />
              </TouchableOpacity>
            );
          }

          if (section.type === "dm") {
            const dm = item as DmChannel;
            return (
              <TouchableOpacity
                style={styles.row}
                onPress={() => {
                  setUnread((p) => ({ ...p, [item.id]: 0 }));
                  router.push(`/(app)/chat/dm/${item.id}` as any);
                }}
              >
                <View style={styles.channelIcon}>
                  <Text style={styles.channelIconText}>
                    {initials(dm.otherProfile.first_name, dm.otherProfile.last_name)}
                  </Text>
                </View>
                <Text style={styles.rowName}>
                  {dm.otherProfile.first_name} {dm.otherProfile.last_name}
                </Text>
                <UnreadBadge count={count} />
              </TouchableOpacity>
            );
          }

          // group
          return (
            <TouchableOpacity
              style={styles.row}
              onPress={() => {
                setUnread((p) => ({ ...p, [item.id]: 0 }));
                router.push(`/(app)/chat/${item.id}` as any);
              }}
            >
              <View style={[styles.channelIcon, { backgroundColor: "#6366f1" }]}>
                <Ionicons name="chatbubbles" size={14} color="#fff" />
              </View>
              <Text style={styles.rowName}>{item.name}</Text>
              <UnreadBadge count={count} />
            </TouchableOpacity>
          );
        }}
      />

      <NewDmSheet
        visible={dmSheetOpen}
        onClose={() => setDmSheetOpen(false)}
        members={members}
        teamId={membership?.teamId ?? ""}
        ownId={ownId}
        onCreated={(dm) => setDms((prev) => [dm, ...prev])}
      />
      <NewGroupSheet
        visible={groupSheetOpen}
        onClose={() => setGroupSheetOpen(false)}
        members={members}
        teamId={membership?.teamId ?? ""}
        ownId={ownId}
        onCreated={(g) => setGroups((prev) => [g, ...prev])}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f9fafb" },
  center: { flex: 1, backgroundColor: "#fff", justifyContent: "center", alignItems: "center" },
  empty: { alignItems: "center", paddingTop: 64, gap: 8 },
  emptyText: { color: "#9ca3af", fontSize: 15 },
  sectionHeader: {
    backgroundColor: "#f9fafb",
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#f3f4f6",
  },
  sectionHeaderText: {
    fontSize: 11,
    fontWeight: "600",
    color: "#9ca3af",
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#fff",
    marginHorizontal: 12,
    marginVertical: 3,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#f3f4f6",
    gap: 12,
  },
  channelIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#e5e7eb",
    alignItems: "center",
    justifyContent: "center",
  },
  channelIconText: { fontSize: 13, fontWeight: "700", color: "#374151" },
  rowName: { flex: 1, fontSize: 15, fontWeight: "600", color: "#111827" },
  badge: {
    backgroundColor: "#0f172a",
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 5,
  },
  badgeText: { color: "#fff", fontSize: 11, fontWeight: "700" },
  // Sheets
  sheetOverlay: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.4)" },
  sheet: {
    backgroundColor: "#fff",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingBottom: 36,
    maxHeight: "70%",
  },
  sheetHandle: {
    width: 36,
    height: 4,
    backgroundColor: "#e5e7eb",
    borderRadius: 2,
    alignSelf: "center",
    marginTop: 12,
    marginBottom: 8,
  },
  sheetTitle: {
    fontSize: 17,
    fontWeight: "700",
    color: "#111827",
    paddingHorizontal: 16,
    marginBottom: 12,
  },
  sheetSub: {
    fontSize: 12,
    fontWeight: "600",
    color: "#9ca3af",
    textTransform: "uppercase",
    letterSpacing: 0.6,
    paddingHorizontal: 16,
    marginBottom: 4,
  },
  searchInput: {
    marginHorizontal: 16,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 15,
    color: "#111827",
    backgroundColor: "#f9fafb",
  },
  memberRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 12,
  },
  memberAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#e5e7eb",
    alignItems: "center",
    justifyContent: "center",
  },
  memberAvatarText: { fontSize: 13, fontWeight: "700", color: "#374151" },
  memberName: { fontSize: 15, color: "#111827" },
  createButton: {
    margin: 16,
    backgroundColor: "#0f172a",
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
  },
  createButtonText: { color: "#fff", fontSize: 15, fontWeight: "600" },
  managerHint: { fontSize: 11, color: "#9ca3af", textTransform: "capitalize" },
  subList: {
    marginLeft: 52,
    marginBottom: 4,
    borderLeftWidth: 2,
    borderLeftColor: "#f3f4f6",
    paddingLeft: 12,
  },
  subListLabel: { fontSize: 11, color: "#9ca3af", paddingVertical: 4 },
  subRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 8,
    gap: 10,
  },
  subAvatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "#e5e7eb",
    alignItems: "center",
    justifyContent: "center",
  },
});
