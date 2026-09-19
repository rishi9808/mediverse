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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      approved_notes: {
        Row: {
          approved_at: string
          clinician_id: string
          id: string
          note_revision_id: string
          session_id: string
          snapshot: Json
        }
        Insert: {
          approved_at?: string
          clinician_id: string
          id?: string
          note_revision_id: string
          session_id: string
          snapshot: Json
        }
        Update: {
          approved_at?: string
          clinician_id?: string
          id?: string
          note_revision_id?: string
          session_id?: string
          snapshot?: Json
        }
        Relationships: [
          {
            foreignKeyName: "approved_notes_note_revision_id_session_id_clinician_id_fkey"
            columns: ["note_revision_id", "session_id", "clinician_id"]
            isOneToOne: false
            referencedRelation: "note_revisions"
            referencedColumns: ["id", "session_id", "clinician_id"]
          },
          {
            foreignKeyName: "approved_notes_session_id_clinician_id_fkey"
            columns: ["session_id", "clinician_id"]
            isOneToOne: false
            referencedRelation: "patient_timeline"
            referencedColumns: ["session_id", "clinician_id"]
          },
          {
            foreignKeyName: "approved_notes_session_id_clinician_id_fkey"
            columns: ["session_id", "clinician_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id", "clinician_id"]
          },
        ]
      }
      audio_assets: {
        Row: {
          bucket_id: string
          byte_size: number | null
          clinician_id: string
          consent_event_id: string
          created_at: string
          deleted_at: string | null
          deletion_due_at: string | null
          duration_ms: number | null
          id: string
          mime_type: string
          object_path: string | null
          session_id: string
          state: string
        }
        Insert: {
          bucket_id?: string
          byte_size?: number | null
          clinician_id: string
          consent_event_id: string
          created_at?: string
          deleted_at?: string | null
          deletion_due_at?: string | null
          duration_ms?: number | null
          id?: string
          mime_type: string
          object_path?: string | null
          session_id: string
          state?: string
        }
        Update: {
          bucket_id?: string
          byte_size?: number | null
          clinician_id?: string
          consent_event_id?: string
          created_at?: string
          deleted_at?: string | null
          deletion_due_at?: string | null
          duration_ms?: number | null
          id?: string
          mime_type?: string
          object_path?: string | null
          session_id?: string
          state?: string
        }
        Relationships: [
          {
            foreignKeyName: "audio_assets_consent_event_id_session_id_clinician_id_fkey"
            columns: ["consent_event_id", "session_id", "clinician_id"]
            isOneToOne: false
            referencedRelation: "consent_events"
            referencedColumns: ["id", "session_id", "clinician_id"]
          },
          {
            foreignKeyName: "audio_assets_session_id_clinician_id_fkey"
            columns: ["session_id", "clinician_id"]
            isOneToOne: false
            referencedRelation: "patient_timeline"
            referencedColumns: ["session_id", "clinician_id"]
          },
          {
            foreignKeyName: "audio_assets_session_id_clinician_id_fkey"
            columns: ["session_id", "clinician_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id", "clinician_id"]
          },
        ]
      }
      clinicians: {
        Row: {
          created_at: string
          display_name: string
          id: string
          profession: string
        }
        Insert: {
          created_at?: string
          display_name: string
          id: string
          profession?: string
        }
        Update: {
          created_at?: string
          display_name?: string
          id?: string
          profession?: string
        }
        Relationships: []
      }
      consent_events: {
        Row: {
          clinician_id: string
          decision: string
          event_sequence: number
          id: string
          policy_version: string
          recorded_at: string
          session_id: string
        }
        Insert: {
          clinician_id: string
          decision: string
          event_sequence?: never
          id?: string
          policy_version: string
          recorded_at?: string
          session_id: string
        }
        Update: {
          clinician_id?: string
          decision?: string
          event_sequence?: never
          id?: string
          policy_version?: string
          recorded_at?: string
          session_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "consent_events_session_id_clinician_id_fkey"
            columns: ["session_id", "clinician_id"]
            isOneToOne: false
            referencedRelation: "patient_timeline"
            referencedColumns: ["session_id", "clinician_id"]
          },
          {
            foreignKeyName: "consent_events_session_id_clinician_id_fkey"
            columns: ["session_id", "clinician_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id", "clinician_id"]
          },
        ]
      }
      note_revisions: {
        Row: {
          clinician_id: string
          content: Json
          created_at: string
          generation_model: string | null
          id: string
          prompt_version: string | null
          session_id: string
          transcript_id: string
          version: number
        }
        Insert: {
          clinician_id: string
          content: Json
          created_at?: string
          generation_model?: string | null
          id?: string
          prompt_version?: string | null
          session_id: string
          transcript_id: string
          version: number
        }
        Update: {
          clinician_id?: string
          content?: Json
          created_at?: string
          generation_model?: string | null
          id?: string
          prompt_version?: string | null
          session_id?: string
          transcript_id?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "note_revisions_session_id_clinician_id_fkey"
            columns: ["session_id", "clinician_id"]
            isOneToOne: false
            referencedRelation: "patient_timeline"
            referencedColumns: ["session_id", "clinician_id"]
          },
          {
            foreignKeyName: "note_revisions_session_id_clinician_id_fkey"
            columns: ["session_id", "clinician_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id", "clinician_id"]
          },
          {
            foreignKeyName: "note_revisions_transcript_id_session_id_clinician_id_fkey"
            columns: ["transcript_id", "session_id", "clinician_id"]
            isOneToOne: false
            referencedRelation: "transcripts"
            referencedColumns: ["id", "session_id", "clinician_id"]
          },
        ]
      }
      patients: {
        Row: {
          archived_at: string | null
          clinician_id: string
          created_at: string
          date_of_birth: string | null
          display_code: string
          display_name: string
          email: string | null
          gender: string | null
          id: string
          location: string
          mobile: string
        }
        Insert: {
          archived_at?: string | null
          clinician_id: string
          created_at?: string
          date_of_birth?: string | null
          display_code: string
          display_name: string
          email?: string | null
          gender?: string | null
          id?: string
          location: string
          mobile: string
        }
        Update: {
          archived_at?: string | null
          clinician_id?: string
          created_at?: string
          date_of_birth?: string | null
          display_code?: string
          display_name?: string
          email?: string | null
          gender?: string | null
          id?: string
          location?: string
          mobile?: string
        }
        Relationships: [
          {
            foreignKeyName: "patients_clinician_id_fkey"
            columns: ["clinician_id"]
            isOneToOne: false
            referencedRelation: "clinicians"
            referencedColumns: ["id"]
          },
        ]
      }
      processing_jobs: {
        Row: {
          attempts: number
          available_at: string
          base_note_version: number | null
          clinician_id: string
          created_at: string
          error_code: string | null
          finished_at: string | null
          id: string
          kind: string
          locked_until: string | null
          request_key: string
          session_id: string
          status: string
          transcript_id: string | null
        }
        Insert: {
          attempts?: number
          available_at?: string
          base_note_version?: number | null
          clinician_id: string
          created_at?: string
          error_code?: string | null
          finished_at?: string | null
          id?: string
          kind: string
          locked_until?: string | null
          request_key: string
          session_id: string
          status?: string
          transcript_id?: string | null
        }
        Update: {
          attempts?: number
          available_at?: string
          base_note_version?: number | null
          clinician_id?: string
          created_at?: string
          error_code?: string | null
          finished_at?: string | null
          id?: string
          kind?: string
          locked_until?: string | null
          request_key?: string
          session_id?: string
          status?: string
          transcript_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "processing_jobs_transcript_fkey"
            columns: ["transcript_id", "session_id", "clinician_id"]
            isOneToOne: false
            referencedRelation: "transcripts"
            referencedColumns: ["id", "session_id", "clinician_id"]
          },
          {
            foreignKeyName: "processing_jobs_session_id_clinician_id_fkey"
            columns: ["session_id", "clinician_id"]
            isOneToOne: false
            referencedRelation: "patient_timeline"
            referencedColumns: ["session_id", "clinician_id"]
          },
          {
            foreignKeyName: "processing_jobs_session_id_clinician_id_fkey"
            columns: ["session_id", "clinician_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id", "clinician_id"]
          },
        ]
      }
      sessions: {
        Row: {
          audio_source: string
          client_request_id: string
          clinician_id: string
          created_at: string
          id: string
          language: string
          occurred_at: string
          patient_id: string
          setting: string
        }
        Insert: {
          audio_source: string
          client_request_id?: string
          clinician_id: string
          created_at?: string
          id?: string
          language?: string
          occurred_at?: string
          patient_id: string
          setting?: string
        }
        Update: {
          audio_source?: string
          client_request_id?: string
          clinician_id?: string
          created_at?: string
          id?: string
          language?: string
          occurred_at?: string
          patient_id?: string
          setting?: string
        }
        Relationships: [
          {
            foreignKeyName: "sessions_clinician_id_fkey"
            columns: ["clinician_id"]
            isOneToOne: false
            referencedRelation: "clinicians"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sessions_patient_id_clinician_id_fkey"
            columns: ["patient_id", "clinician_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id", "clinician_id"]
          },
        ]
      }
      transcript_segments: {
        Row: {
          clinician_id: string
          content: string
          end_ms: number
          id: string
          ordinal: number
          provider_segment_id: string | null
          session_id: string
          speaker_key: string
          speaker_role: string
          start_ms: number
          suggested_speaker_role: string | null
          transcript_id: string
        }
        Insert: {
          clinician_id: string
          content: string
          end_ms: number
          id?: string
          ordinal: number
          provider_segment_id?: string | null
          session_id: string
          speaker_key: string
          speaker_role?: string
          start_ms: number
          suggested_speaker_role?: string | null
          transcript_id: string
        }
        Update: {
          clinician_id?: string
          content?: string
          end_ms?: number
          id?: string
          ordinal?: number
          provider_segment_id?: string | null
          session_id?: string
          speaker_key?: string
          speaker_role?: string
          start_ms?: number
          suggested_speaker_role?: string | null
          transcript_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "transcript_segments_transcript_id_session_id_clinician_id_fkey"
            columns: ["transcript_id", "session_id", "clinician_id"]
            isOneToOne: false
            referencedRelation: "transcripts"
            referencedColumns: ["id", "session_id", "clinician_id"]
          },
        ]
      }
      transcripts: {
        Row: {
          audio_asset_id: string | null
          clinician_id: string
          created_at: string
          duration_ms: number
          id: string
          language: string
          model: string
          provider: string
          session_id: string
          speaker_identification_model: string | null
          speaker_identified_at: string | null
          speakers_confirmed_at: string | null
          speakers_confirmed_by: string | null
          source: string
          status: string
          version: number
        }
        Insert: {
          audio_asset_id?: string | null
          clinician_id: string
          created_at?: string
          duration_ms: number
          id?: string
          language?: string
          model: string
          provider: string
          session_id: string
          speaker_identification_model?: string | null
          speaker_identified_at?: string | null
          speakers_confirmed_at?: string | null
          speakers_confirmed_by?: string | null
          source: string
          status?: string
          version: number
        }
        Update: {
          audio_asset_id?: string | null
          clinician_id?: string
          created_at?: string
          duration_ms?: number
          id?: string
          language?: string
          model?: string
          provider?: string
          session_id?: string
          speaker_identification_model?: string | null
          speaker_identified_at?: string | null
          speakers_confirmed_at?: string | null
          speakers_confirmed_by?: string | null
          source?: string
          status?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "transcripts_audio_asset_id_session_id_clinician_id_fkey"
            columns: ["audio_asset_id", "session_id", "clinician_id"]
            isOneToOne: false
            referencedRelation: "audio_assets"
            referencedColumns: ["id", "session_id", "clinician_id"]
          },
          {
            foreignKeyName: "transcripts_session_id_clinician_id_fkey"
            columns: ["session_id", "clinician_id"]
            isOneToOne: false
            referencedRelation: "patient_timeline"
            referencedColumns: ["session_id", "clinician_id"]
          },
          {
            foreignKeyName: "transcripts_session_id_clinician_id_fkey"
            columns: ["session_id", "clinician_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id", "clinician_id"]
          },
        ]
      }
    }
    Views: {
      patient_timeline: {
        Row: {
          approved_at: string | null
          approved_note_id: string | null
          audio_source: string | null
          clinician_id: string | null
          documentation_status: string | null
          occurred_at: string | null
          patient_id: string | null
          session_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sessions_clinician_id_fkey"
            columns: ["clinician_id"]
            isOneToOne: false
            referencedRelation: "clinicians"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sessions_patient_id_clinician_id_fkey"
            columns: ["patient_id", "clinician_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id", "clinician_id"]
          },
        ]
      }
    }
    Functions: {
      claim_drafting_job: {
        Args: { p_job_id: string }
        Returns: Json
      }
      claim_speaker_identification_job: {
        Args: { p_job_id: string }
        Returns: Json
      }
      claim_transcription_job: {
        Args: { p_job_id: string }
        Returns: Json
      }
      complete_transcription_job: {
        Args: { p_job_id: string; p_segments: Json }
        Returns: Database["public"]["Tables"]["transcripts"]["Row"]
      }
      complete_drafting_job: {
        Args: {
          p_content: Json
          p_job_id: string
          p_model: string
          p_prompt_version: string
        }
        Returns: Database["public"]["Tables"]["note_revisions"]["Row"]
      }
      complete_speaker_identification_job: {
        Args: { p_assignments: Json; p_job_id: string; p_model: string }
        Returns: Database["public"]["Tables"]["transcripts"]["Row"]
      }
      confirm_transcript_speakers: {
        Args: { p_assignments: Json; p_transcript_id: string }
        Returns: Database["public"]["Tables"]["transcripts"]["Row"]
      }
      approve_note: {
        Args: { p_note_revision_id: string; p_session_id: string }
        Returns: {
          approved_at: string
          clinician_id: string
          id: string
          note_revision_id: string
          session_id: string
          snapshot: Json
        }
        SetofOptions: {
          from: "*"
          to: "approved_notes"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_recording_session: {
        Args: { p_client_request_id: string; p_patient_id: string }
        Returns: {
          audio_source: string
          client_request_id: string
          clinician_id: string
          created_at: string
          id: string
          language: string
          occurred_at: string
          patient_id: string
          setting: string
        }
        SetofOptions: {
          from: "*"
          to: "sessions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      finalize_audio_upload: {
        Args: {
          p_audio_asset_id: string
          p_duration_ms: number
          p_expected_byte_size: number
        }
        Returns: {
          bucket_id: string
          byte_size: number | null
          clinician_id: string
          consent_event_id: string
          created_at: string
          deleted_at: string | null
          deletion_due_at: string | null
          duration_ms: number | null
          id: string
          mime_type: string
          object_path: string | null
          session_id: string
          state: string
        }
        SetofOptions: {
          from: "*"
          to: "audio_assets"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      fail_transcription_job: {
        Args: { p_error_code: string; p_job_id: string }
        Returns: Database["public"]["Tables"]["processing_jobs"]["Row"]
      }
      enqueue_drafting_job: {
        Args: {
          p_expected_version: number
          p_session_id: string
          p_transcript_id: string
        }
        Returns: Database["public"]["Tables"]["processing_jobs"]["Row"]
      }
      fail_drafting_job: {
        Args: { p_error_code: string; p_job_id: string }
        Returns: Database["public"]["Tables"]["processing_jobs"]["Row"]
      }
      fail_speaker_identification_job: {
        Args: { p_error_code: string; p_job_id: string }
        Returns: Database["public"]["Tables"]["processing_jobs"]["Row"]
      }
      record_consent: {
        Args: {
          p_decision: string
          p_policy_version: string
          p_session_id: string
        }
        Returns: string
      }
      register_audio: {
        Args: { p_mime_type: string; p_session_id: string }
        Returns: {
          bucket_id: string
          byte_size: number | null
          clinician_id: string
          consent_event_id: string
          created_at: string
          deleted_at: string | null
          deletion_due_at: string | null
          duration_ms: number | null
          id: string
          mime_type: string
          object_path: string | null
          session_id: string
          state: string
        }
        SetofOptions: {
          from: "*"
          to: "audio_assets"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      retry_transcription_job: {
        Args: { p_job_id: string }
        Returns: Database["public"]["Tables"]["processing_jobs"]["Row"]
      }
      retry_drafting_job: {
        Args: { p_job_id: string }
        Returns: Database["public"]["Tables"]["processing_jobs"]["Row"]
      }
      retry_speaker_identification_job: {
        Args: { p_job_id: string }
        Returns: Database["public"]["Tables"]["processing_jobs"]["Row"]
      }
      select_audio_source: {
        Args: { p_audio_source: string; p_session_id: string }
        Returns: {
          audio_source: string
          client_request_id: string
          clinician_id: string
          created_at: string
          id: string
          language: string
          occurred_at: string
          patient_id: string
          setting: string
        }
        SetofOptions: {
          from: "*"
          to: "sessions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      save_note_revision: {
        Args: {
          p_content: Json
          p_expected_version: number
          p_generation_model?: string
          p_prompt_version?: string
          p_session_id: string
          p_transcript_id: string
        }
        Returns: {
          clinician_id: string
          content: Json
          created_at: string
          generation_model: string | null
          id: string
          prompt_version: string | null
          session_id: string
          transcript_id: string
          version: number
        }
        SetofOptions: {
          from: "*"
          to: "note_revisions"
          isOneToOne: true
          isSetofReturn: false
        }
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
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
