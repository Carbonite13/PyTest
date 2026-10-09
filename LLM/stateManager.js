
import { supabase } from "./supabase.js";

export class StateManager {
  constructor(userId) {
    if (!userId) {
      throw new Error("A Supabase user ID is required.");
    }

    this.userId = userId;
    this.state = this._defaultState();
  }

  _defaultState() {
    return {
      transcript: "",
      meeting_summary: "",
      meeting_id: null,
      meeting_title: "Untitled Meeting",
      meeting_status: "in_progress",
      started_at: new Date().toISOString(),
      last_updated: new Date().toISOString(),
      topics: []
    };
  }

  async initializeMeeting() {
    if (this.state.meeting_id) {
      return this.state.meeting_id;
    }

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("display_name")
      .eq("id", this.userId)
      .maybeSingle();

    if (profileError) {
      console.warn("Could not load profile name:", profileError.message);
    }

    const creatorName = profile?.display_name || "User";

    if (this.state.meeting_title === "Untitled Meeting") {
      this.state.meeting_title = `${creatorName}'s Meeting`;
    }

    const { data, error } = await supabase
      .from("meetings")
      .insert({
        title: this.state.meeting_title,
        status: this.state.meeting_status,
        started_at: this.state.started_at,
        last_updated: this.state.last_updated,
        user_id: this.userId,
        summary: "",
        transcript: ""
      })
      .select("id")
      .single();

    if (error) {
      throw new Error(`Failed to create meeting: ${error.message}`);
    }

    this.state.meeting_id = data.id;

    console.log(`Meeting created: ${data.id}`);
    return data.id;
  }

  getState() {
    return this.state;
  }

  async appendTranscript(entry) {
    if (typeof entry !== "string" || !entry.trim()) {
      return;
    }

    this.state.transcript = [
      this.state.transcript,
      entry.trim()
    ].filter(Boolean).join("\n");

    this.state.last_updated = new Date().toISOString();

    await this._syncMeeting();
  }

  async updateState(newState) {
    this.state = {
      ...this.state,
      ...newState,
      meeting_id: this.state.meeting_id,
      transcript: this.state.transcript,
      last_updated: new Date().toISOString()
    };

    await this._syncToDatabase();
  }

  async _syncMeeting() {
    if (!this.state.meeting_id) {
      await this.initializeMeeting();
    }

    const { error } = await supabase
      .from("meetings")
      .update({
        title: this.state.meeting_title,
        status: this.state.meeting_status,
        last_updated: this.state.last_updated,
        summary: this.state.meeting_summary || "",
        transcript: this.state.transcript || ""
      })
      .eq("id", this.state.meeting_id)
      .eq("user_id", this.userId);

    if (error) {
      throw new Error(`Failed to save meeting: ${error.message}`);
    }
  }

  async _syncToDatabase() {
    await this._syncMeeting();

    if (!this.state.topics?.length) {
      return;
    }

    const topicsToSync = this.state.topics.map((topic) => ({
      meeting_id: this.state.meeting_id,
      topic_id: topic.topic_id,
      topic_name: topic.topic_name,
      nature: topic.nature,
      status: topic.status,
      start_time: topic.start_time,
      end_time: topic.end_time || null,
      summary_points: topic.summary_points || [],
      action_items: topic.action_items || [],
      branched_from: topic.branched_from || null,
      updated_at: new Date().toISOString()
    }));

    const { error } = await supabase
      .from("topics")
      .upsert(topicsToSync, {
        onConflict: "meeting_id,topic_id"
      });

    if (error) {
      throw new Error(`Failed to save topics: ${error.message}`);
    }
  }

  async reset() {
    // Start a new meeting; the previous meeting remains in Supabase.
    this.state = this._defaultState();
    await this.initializeMeeting();
  }
}
