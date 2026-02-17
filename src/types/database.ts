export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  public: {
    Tables: {
      organizations: {
        Row: {
          id: string;
          name: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      teams: {
        Row: {
          id: string;
          organization_id: string;
          name: string;
          season: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          name: string;
          season?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          name?: string;
          season?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "teams_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      profiles: {
        Row: {
          id: string;
          full_name: string;
          email: string;
          phone: string | null;
          avatar_url: string | null;
          created_at: string;
        };
        Insert: {
          id: string;
          full_name: string;
          email: string;
          phone?: string | null;
          avatar_url?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          full_name?: string;
          email?: string;
          phone?: string | null;
          avatar_url?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      team_members: {
        Row: {
          id: string;
          team_id: string;
          profile_id: string;
          role: "coach" | "manager" | "parent" | "player";
          jersey_number: number | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          team_id: string;
          profile_id: string;
          role: "coach" | "manager" | "parent" | "player";
          jersey_number?: number | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          team_id?: string;
          profile_id?: string;
          role?: "coach" | "manager" | "parent" | "player";
          jersey_number?: number | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "team_members_team_id_fkey";
            columns: ["team_id"];
            isOneToOne: false;
            referencedRelation: "teams";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "team_members_profile_id_fkey";
            columns: ["profile_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      events: {
        Row: {
          id: string;
          team_id: string;
          title: string;
          description: string | null;
          event_type: "practice" | "game" | "other";
          location: string | null;
          start_time: string;
          end_time: string;
          recurrence_rule: string | null;
          parent_event_id: string | null;
          is_cancelled: boolean;
          created_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          team_id: string;
          title: string;
          description?: string | null;
          event_type: "practice" | "game" | "other";
          location?: string | null;
          start_time: string;
          end_time: string;
          recurrence_rule?: string | null;
          parent_event_id?: string | null;
          is_cancelled?: boolean;
          created_by?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          team_id?: string;
          title?: string;
          description?: string | null;
          event_type?: "practice" | "game" | "other";
          location?: string | null;
          start_time?: string;
          end_time?: string;
          recurrence_rule?: string | null;
          parent_event_id?: string | null;
          is_cancelled?: boolean;
          created_by?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "events_team_id_fkey";
            columns: ["team_id"];
            isOneToOne: false;
            referencedRelation: "teams";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "events_parent_event_id_fkey";
            columns: ["parent_event_id"];
            isOneToOne: false;
            referencedRelation: "events";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "events_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      availability: {
        Row: {
          id: string;
          event_id: string;
          profile_id: string;
          status: "available" | "unavailable" | "maybe";
          created_at: string;
        };
        Insert: {
          id?: string;
          event_id: string;
          profile_id: string;
          status: "available" | "unavailable" | "maybe";
          created_at?: string;
        };
        Update: {
          id?: string;
          event_id?: string;
          profile_id?: string;
          status?: "available" | "unavailable" | "maybe";
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "availability_event_id_fkey";
            columns: ["event_id"];
            isOneToOne: false;
            referencedRelation: "events";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "availability_profile_id_fkey";
            columns: ["profile_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      invitations: {
        Row: {
          id: string;
          team_id: string;
          email: string;
          role: "coach" | "manager" | "parent" | "player";
          invited_by: string | null;
          accepted_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          team_id: string;
          email: string;
          role: "coach" | "manager" | "parent" | "player";
          invited_by?: string | null;
          accepted_at?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          team_id?: string;
          email?: string;
          role?: "coach" | "manager" | "parent" | "player";
          invited_by?: string | null;
          accepted_at?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "invitations_team_id_fkey";
            columns: ["team_id"];
            isOneToOne: false;
            referencedRelation: "teams";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "invitations_invited_by_fkey";
            columns: ["invited_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      push_subscriptions: {
        Row: {
          id: string;
          profile_id: string;
          endpoint: string;
          p256dh: string;
          auth: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          profile_id: string;
          endpoint: string;
          p256dh: string;
          auth: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          profile_id?: string;
          endpoint?: string;
          p256dh?: string;
          auth?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "push_subscriptions_profile_id_fkey";
            columns: ["profile_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      notification_preferences: {
        Row: {
          id: string;
          profile_id: string;
          email_enabled: boolean;
          push_enabled: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          profile_id: string;
          email_enabled?: boolean;
          push_enabled?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          profile_id?: string;
          email_enabled?: boolean;
          push_enabled?: boolean;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "notification_preferences_profile_id_fkey";
            columns: ["profile_id"];
            isOneToOne: true;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
