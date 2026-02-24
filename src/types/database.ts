export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      availability: {
        Row: {
          created_at: string | null
          event_id: string | null
          id: string
          profile_id: string | null
          status: string
        }
        Insert: {
          created_at?: string | null
          event_id?: string | null
          id?: string
          profile_id?: string | null
          status: string
        }
        Update: {
          created_at?: string | null
          event_id?: string | null
          id?: string
          profile_id?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "availability_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "availability_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      contacts: {
        Row: {
          city: string | null
          created_at: string | null
          email: string | null
          first_name: string
          id: string
          last_name: string
          phone: string | null
          profile_id: string
          receives_email: boolean | null
          relationship: string
          state: string | null
          street: string | null
          zip: string | null
        }
        Insert: {
          city?: string | null
          created_at?: string | null
          email?: string | null
          first_name: string
          id?: string
          last_name?: string
          phone?: string | null
          profile_id: string
          receives_email?: boolean | null
          relationship: string
          state?: string | null
          street?: string | null
          zip?: string | null
        }
        Update: {
          city?: string | null
          created_at?: string | null
          email?: string | null
          first_name?: string
          id?: string
          last_name?: string
          phone?: string | null
          profile_id?: string
          receives_email?: boolean | null
          relationship?: string
          state?: string | null
          street?: string | null
          zip?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "contacts_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      locations: {
        Row: {
          address: string | null
          created_at: string | null
          id: string
          name: string
          team_id: string
        }
        Insert: {
          address?: string | null
          created_at?: string | null
          id?: string
          name: string
          team_id: string
        }
        Update: {
          address?: string | null
          created_at?: string | null
          id?: string
          name?: string
          team_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "locations_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      events: {
        Row: {
          arrival_time: number | null
          created_at: string | null
          created_by: string | null
          end_time: string
          event_type: string
          game_result: string | null
          home_away: string | null
          id: string
          is_cancelled: boolean | null
          location_id: string | null
          notes: string | null
          opponent: string | null
          parent_event_id: string | null
          recurrence_rule: string | null
          score_against: number | null
          score_for: number | null
          start_time: string
          team_id: string | null
          title: string
          uniform: string | null
        }
        Insert: {
          arrival_time?: number | null
          created_at?: string | null
          created_by?: string | null
          end_time: string
          event_type: string
          game_result?: string | null
          home_away?: string | null
          id?: string
          is_cancelled?: boolean | null
          location_id?: string | null
          notes?: string | null
          opponent?: string | null
          parent_event_id?: string | null
          recurrence_rule?: string | null
          score_against?: number | null
          score_for?: number | null
          start_time: string
          team_id?: string | null
          title: string
          uniform?: string | null
        }
        Update: {
          arrival_time?: number | null
          created_at?: string | null
          created_by?: string | null
          end_time?: string
          event_type?: string
          game_result?: string | null
          home_away?: string | null
          id?: string
          is_cancelled?: boolean | null
          location_id?: string | null
          notes?: string | null
          opponent?: string | null
          parent_event_id?: string | null
          recurrence_rule?: string | null
          score_against?: number | null
          score_for?: number | null
          start_time?: string
          team_id?: string | null
          title?: string
          uniform?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "events_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "events_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "events_parent_event_id_fkey"
            columns: ["parent_event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "events_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      invitations: {
        Row: {
          accepted_at: string | null
          created_at: string | null
          email: string
          first_name: string | null
          id: string
          invited_by: string | null
          last_name: string | null
          role: string
          team_id: string | null
        }
        Insert: {
          accepted_at?: string | null
          created_at?: string | null
          email: string
          first_name?: string | null
          id?: string
          invited_by?: string | null
          last_name?: string | null
          role: string
          team_id?: string | null
        }
        Update: {
          accepted_at?: string | null
          created_at?: string | null
          email?: string
          first_name?: string | null
          id?: string
          invited_by?: string | null
          last_name?: string | null
          role?: string
          team_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "invitations_invited_by_fkey"
            columns: ["invited_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invitations_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_preferences: {
        Row: {
          created_at: string | null
          email_enabled: boolean | null
          id: string
          profile_id: string | null
          push_enabled: boolean | null
        }
        Insert: {
          created_at?: string | null
          email_enabled?: boolean | null
          id?: string
          profile_id?: string | null
          push_enabled?: boolean | null
        }
        Update: {
          created_at?: string | null
          email_enabled?: boolean | null
          id?: string
          profile_id?: string | null
          push_enabled?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "notification_preferences_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          created_at: string | null
          id: string
          name: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          name: string
        }
        Update: {
          created_at?: string | null
          id?: string
          name?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          birthday: string | null
          created_at: string | null
          email: string
          first_name: string
          gender: string | null
          id: string
          last_name: string
        }
        Insert: {
          avatar_url?: string | null
          birthday?: string | null
          created_at?: string | null
          email: string
          first_name: string
          gender?: string | null
          id: string
          last_name?: string
        }
        Update: {
          avatar_url?: string | null
          birthday?: string | null
          created_at?: string | null
          email?: string
          first_name?: string
          gender?: string | null
          id?: string
          last_name?: string
        }
        Relationships: []
      }
      push_subscriptions: {
        Row: {
          auth: string
          created_at: string | null
          endpoint: string
          id: string
          p256dh: string
          profile_id: string | null
        }
        Insert: {
          auth: string
          created_at?: string | null
          endpoint: string
          id?: string
          p256dh: string
          profile_id?: string | null
        }
        Update: {
          auth?: string
          created_at?: string | null
          endpoint?: string
          id?: string
          p256dh?: string
          profile_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "push_subscriptions_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      team_members: {
        Row: {
          created_at: string | null
          id: string
          jersey_number: number | null
          profile_id: string | null
          role: string
          team_id: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          jersey_number?: number | null
          profile_id?: string | null
          role: string
          team_id?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          jersey_number?: number | null
          profile_id?: string | null
          role?: string
          team_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "team_members_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "team_members_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      teams: {
        Row: {
          age_group: string | null
          away_uniform: string | null
          country: string | null
          created_at: string | null
          gender: string | null
          home_uniform: string | null
          id: string
          league: string | null
          league_url: string | null
          logo_url: string | null
          name: string
          organization_id: string | null
          season: string | null
          sport: string | null
          team_photo_url: string | null
          timezone: string | null
          zip: string | null
        }
        Insert: {
          age_group?: string | null
          away_uniform?: string | null
          country?: string | null
          created_at?: string | null
          gender?: string | null
          home_uniform?: string | null
          id?: string
          league?: string | null
          league_url?: string | null
          logo_url?: string | null
          name: string
          organization_id?: string | null
          season?: string | null
          sport?: string | null
          team_photo_url?: string | null
          timezone?: string | null
          zip?: string | null
        }
        Update: {
          age_group?: string | null
          away_uniform?: string | null
          country?: string | null
          created_at?: string | null
          gender?: string | null
          home_uniform?: string | null
          id?: string
          league?: string | null
          league_url?: string | null
          logo_url?: string | null
          name?: string
          organization_id?: string | null
          season?: string | null
          sport?: string | null
          team_photo_url?: string | null
          timezone?: string | null
          zip?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "teams_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      is_admin_of_profile: { Args: { p_id: string }; Returns: boolean }
      is_team_admin: { Args: { t_id: string }; Returns: boolean }
      is_team_member: { Args: { t_id: string }; Returns: boolean }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
