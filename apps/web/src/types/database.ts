export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
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
      channel_members: {
        Row: {
          channel_id: string
          id: string
          joined_at: string | null
          last_read_at: string | null
          profile_id: string
        }
        Insert: {
          channel_id: string
          id?: string
          joined_at?: string | null
          last_read_at?: string | null
          profile_id: string
        }
        Update: {
          channel_id?: string
          id?: string
          joined_at?: string | null
          last_read_at?: string | null
          profile_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "channel_members_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "channel_members_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      channels: {
        Row: {
          created_at: string | null
          created_by: string | null
          id: string
          name: string
          team_id: string
          type: string
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          id?: string
          name: string
          team_id: string
          type: string
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          id?: string
          name?: string
          team_id?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "channels_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "channels_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      dm_channels: {
        Row: {
          created_at: string | null
          id: string
          last_read_a: string | null
          last_read_b: string | null
          profile_a: string
          profile_b: string
          team_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          last_read_a?: string | null
          last_read_b?: string | null
          profile_a: string
          profile_b: string
          team_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          last_read_a?: string | null
          last_read_b?: string | null
          profile_a?: string
          profile_b?: string
          team_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "dm_channels_profile_a_fkey"
            columns: ["profile_a"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dm_channels_profile_b_fkey"
            columns: ["profile_b"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dm_channels_team_id_fkey"
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
      feedback: {
        Row: {
          app_version: string | null
          created_at: string | null
          description: string
          id: string
          type: string
          user_id: string | null
        }
        Insert: {
          app_version?: string | null
          created_at?: string | null
          description: string
          id?: string
          type: string
          user_id?: string | null
        }
        Update: {
          app_version?: string | null
          created_at?: string | null
          description?: string
          id?: string
          type?: string
          user_id?: string | null
        }
        Relationships: []
      }
      invitations: {
        Row: {
          accepted_at: string | null
          birthday: string | null
          created_at: string | null
          email: string
          email_status: string | null
          first_name: string | null
          gender: string | null
          id: string
          invited_by: string | null
          last_name: string | null
          managed_profile_id: string | null
          relationship: string | null
          role: string
          team_id: string | null
        }
        Insert: {
          accepted_at?: string | null
          birthday?: string | null
          created_at?: string | null
          email: string
          email_status?: string | null
          first_name?: string | null
          gender?: string | null
          id?: string
          invited_by?: string | null
          last_name?: string | null
          managed_profile_id?: string | null
          relationship?: string | null
          role: string
          team_id?: string | null
        }
        Update: {
          accepted_at?: string | null
          birthday?: string | null
          created_at?: string | null
          email?: string
          email_status?: string | null
          first_name?: string | null
          gender?: string | null
          id?: string
          invited_by?: string | null
          last_name?: string | null
          managed_profile_id?: string | null
          relationship?: string | null
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
            foreignKeyName: "invitations_managed_profile_id_fkey"
            columns: ["managed_profile_id"]
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
      messages: {
        Row: {
          body: string
          channel_id: string | null
          created_at: string | null
          deleted_at: string | null
          dm_channel_id: string | null
          id: string
          sender_id: string
        }
        Insert: {
          body: string
          channel_id?: string | null
          created_at?: string | null
          deleted_at?: string | null
          dm_channel_id?: string | null
          id?: string
          sender_id: string
        }
        Update: {
          body?: string
          channel_id?: string | null
          created_at?: string | null
          deleted_at?: string | null
          dm_channel_id?: string | null
          id?: string
          sender_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "messages_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_dm_channel_id_fkey"
            columns: ["dm_channel_id"]
            isOneToOne: false
            referencedRelation: "dm_channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_sender_id_fkey"
            columns: ["sender_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_preferences: {
        Row: {
          chat_digest_enabled: boolean
          chat_push_enabled: boolean
          created_at: string | null
          email_enabled: boolean | null
          id: string
          profile_id: string | null
          push_enabled: boolean | null
        }
        Insert: {
          chat_digest_enabled?: boolean
          chat_push_enabled?: boolean
          created_at?: string | null
          email_enabled?: boolean | null
          id?: string
          profile_id?: string | null
          push_enabled?: boolean | null
        }
        Update: {
          chat_digest_enabled?: boolean
          chat_push_enabled?: boolean
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
      organization_members: {
        Row: {
          created_at: string | null
          organization_id: string
          profile_id: string
          role: string
        }
        Insert: {
          created_at?: string | null
          organization_id: string
          profile_id: string
          role: string
        }
        Update: {
          created_at?: string | null
          organization_id?: string
          profile_id?: string
          role?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_members_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_members_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          brand_color: string | null
          brand_color_secondary: string | null
          created_at: string | null
          created_by: string | null
          custom_domain: string | null
          favicon_url: string | null
          id: string
          logo_url: string | null
          name: string
          org_name_public: string | null
          pending_plan: string | null
          pending_plan_at: string | null
          plan: string
          slug: string
          stripe_customer_id: string | null
          stripe_schedule_id: string | null
          stripe_subscription_id: string | null
          subdomain: string | null
          subdomain_quarantined_at: string | null
          subdomain_status: string | null
          subscription_cancel_at: string | null
          subscription_status: string | null
          team_limit: number | null
          trial_ends_at: string | null
          trial_reminder_1d_sent_at: string | null
          trial_reminder_30d_sent_at: string | null
          trial_reminder_7d_sent_at: string | null
        }
        Insert: {
          brand_color?: string | null
          brand_color_secondary?: string | null
          created_at?: string | null
          created_by?: string | null
          custom_domain?: string | null
          favicon_url?: string | null
          id?: string
          logo_url?: string | null
          name: string
          org_name_public?: string | null
          pending_plan?: string | null
          pending_plan_at?: string | null
          plan?: string
          slug: string
          stripe_customer_id?: string | null
          stripe_schedule_id?: string | null
          stripe_subscription_id?: string | null
          subdomain?: string | null
          subdomain_quarantined_at?: string | null
          subdomain_status?: string | null
          subscription_cancel_at?: string | null
          subscription_status?: string | null
          team_limit?: number | null
          trial_ends_at?: string | null
          trial_reminder_1d_sent_at?: string | null
          trial_reminder_30d_sent_at?: string | null
          trial_reminder_7d_sent_at?: string | null
        }
        Update: {
          brand_color?: string | null
          brand_color_secondary?: string | null
          created_at?: string | null
          created_by?: string | null
          custom_domain?: string | null
          favicon_url?: string | null
          id?: string
          logo_url?: string | null
          name?: string
          org_name_public?: string | null
          pending_plan?: string | null
          pending_plan_at?: string | null
          plan?: string
          slug?: string
          stripe_customer_id?: string | null
          stripe_schedule_id?: string | null
          stripe_subscription_id?: string | null
          subdomain?: string | null
          subdomain_quarantined_at?: string | null
          subdomain_status?: string | null
          subscription_cancel_at?: string | null
          subscription_status?: string | null
          team_limit?: number | null
          trial_ends_at?: string | null
          trial_reminder_1d_sent_at?: string | null
          trial_reminder_30d_sent_at?: string | null
          trial_reminder_7d_sent_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "organizations_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profile_managers: {
        Row: {
          created_at: string | null
          id: string
          managed_id: string
          manager_id: string
          phone: string | null
          relationship: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          managed_id: string
          manager_id: string
          phone?: string | null
          relationship?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          managed_id?: string
          manager_id?: string
          phone?: string | null
          relationship?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "profile_managers_managed_id_fkey"
            columns: ["managed_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profile_managers_manager_id_fkey"
            columns: ["manager_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          active_team_id: string | null
          auth_user_id: string | null
          avatar_url: string | null
          birthday: string | null
          created_at: string | null
          email: string
          first_name: string
          gender: string | null
          id: string
          last_name: string
          training_leaderboard_opt_out: boolean
        }
        Insert: {
          active_team_id?: string | null
          auth_user_id?: string | null
          avatar_url?: string | null
          birthday?: string | null
          created_at?: string | null
          email: string
          first_name: string
          gender?: string | null
          id: string
          last_name?: string
          training_leaderboard_opt_out?: boolean
        }
        Update: {
          active_team_id?: string | null
          auth_user_id?: string | null
          avatar_url?: string | null
          birthday?: string | null
          created_at?: string | null
          email?: string
          first_name?: string
          gender?: string | null
          id?: string
          last_name?: string
          training_leaderboard_opt_out?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "profiles_active_team_id_fkey"
            columns: ["active_team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      push_subscriptions: {
        Row: {
          auth: string | null
          created_at: string | null
          endpoint: string | null
          expo_push_token: string | null
          id: string
          p256dh: string | null
          profile_id: string | null
        }
        Insert: {
          auth?: string | null
          created_at?: string | null
          endpoint?: string | null
          expo_push_token?: string | null
          id?: string
          p256dh?: string | null
          profile_id?: string | null
        }
        Update: {
          auth?: string | null
          created_at?: string | null
          endpoint?: string | null
          expo_push_token?: string | null
          id?: string
          p256dh?: string | null
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
          position: string | null
          profile_id: string | null
          role: string
          team_id: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          jersey_number?: number | null
          position?: string | null
          profile_id?: string | null
          role: string
          team_id?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          jersey_number?: number | null
          position?: string | null
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
          archived_at: string | null
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
          owner_id: string | null
          season: string | null
          sport: string | null
          team_photo_url: string | null
          timezone: string | null
          zip: string | null
        }
        Insert: {
          age_group?: string | null
          archived_at?: string | null
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
          owner_id?: string | null
          season?: string | null
          sport?: string | null
          team_photo_url?: string | null
          timezone?: string | null
          zip?: string | null
        }
        Update: {
          age_group?: string | null
          archived_at?: string | null
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
          owner_id?: string | null
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
          {
            foreignKeyName: "teams_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      training_sessions: {
        Row: {
          category: string
          created_at: string
          created_by: string
          duration_minutes: number
          id: string
          notes: string | null
          profile_id: string
          session_date: string
          team_id: string
          updated_at: string
        }
        Insert: {
          category: string
          created_at?: string
          created_by?: string
          duration_minutes: number
          id?: string
          notes?: string | null
          profile_id: string
          session_date: string
          team_id: string
          updated_at?: string
        }
        Update: {
          category?: string
          created_at?: string
          created_by?: string
          duration_minutes?: number
          id?: string
          notes?: string | null
          profile_id?: string
          session_date?: string
          team_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "training_sessions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "training_sessions_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "training_sessions_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      create_club_team: {
        Args: { org_id: string; season: string; team_name: string }
        Returns: string
      }
      create_team: {
        Args: {
          org_name: string
          owner_profile_id: string
          season: string
          team_name: string
        }
        Returns: string
      }
      get_user_org_ids: { Args: never; Returns: string[] }
      has_club_access: { Args: { o_id: string }; Returns: boolean }
      is_admin_of_profile: { Args: { p_id: string }; Returns: boolean }
      is_channel_member: { Args: { c_id: string }; Returns: boolean }
      is_event_team_member: {
        Args: { e_id: string; p_id: string }
        Returns: boolean
      }
      is_managed_by_me: { Args: { p_id: string }; Returns: boolean }
      is_org_admin: { Args: { o_id: string }; Returns: boolean }
      is_org_owner: { Args: { o_id: string }; Returns: boolean }
      is_team_admin: { Args: { t_id: string }; Returns: boolean }
      is_team_archived: { Args: { t_id: string }; Returns: boolean }
      is_team_member: { Args: { t_id: string }; Returns: boolean }
      is_team_player: { Args: { p_id: string; t_id: string }; Returns: boolean }
      safe_team_tz: { Args: { t_id: string }; Returns: string }
      team_org_id: { Args: { t_id: string }; Returns: string }
      training_leaderboard: {
        Args: {
          p_anchor?: string
          p_org_id?: string
          p_period?: string
          p_scope: string
          p_team_id?: string
        }
        Returns: {
          avatar_url: string
          display_name: string
          profile_id: string
          rank: number
          session_count: number
          team_id: string
          team_name: string
          total_minutes: number
        }[]
      }
      training_summary: {
        Args: {
          p_anchor?: string
          p_org_id?: string
          p_period?: string
          p_profile_id: string
          p_scope: string
          p_team_id?: string
        }
        Returns: {
          denominator: number
          rank: number
          session_count: number
          total_minutes: number
        }[]
      }
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const

