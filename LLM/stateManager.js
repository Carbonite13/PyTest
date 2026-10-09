// StateManager.js
import fs from "fs";
import { supabase } from "./supabase.js";

const STATE_FILE = "meeting.json";

export class StateManager {
  constructor(userId) {
    this.userId = userId;
    this.state = this._defaultState();
    this._writeToFile();
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
  appendTranscript(text) {
  if (!text?.trim()) return;

  this.state.transcript +=
    (this.state.transcript ? "\n" : "") + text.trim();

  this._writeToFile();
}
  async initializeMeeting() {
    const { data: profile } = await supabase
      .from('profiles')
      .select('display_name')
      .eq('id', this.userId)
      .single();

    const creatorName = profile?.display_name || 'Anonymous User';

    if (this.state.meeting_title === "Untitled Meeting") {
      this.state.meeting_title = `${creatorName}'s Meeting`;
      this._writeToFile();
    }

    const { data, error } = await supabase
      .from('meetings')
      .insert({
        title: this.state.meeting_title,
        status: this.state.meeting_status,
        started_at: this.state.started_at,
        last_updated: this.state.last_updated,
        user_id: this.userId
      })
      .select('id')
      .single();

    if (error) {
      console.error("❌ Failed to create meeting:", error);
      throw error;
    }

    this.state.meeting_id = data.id;
    console.log(`✅ Meeting created for ${creatorName} (ID: ${this.state.meeting_id})`);
  }

  getState() {
    return this.state;
  }

  async updateState(newState) {
    this.state = { ...this.state, ...newState };
    this.state.last_updated = new Date().toISOString();
    this._writeToFile();
    await this._syncToDatabase();
  }

  async _syncToDatabase() {
    if (!this.state.meeting_id) {
      summary: this.state.meeting_summary || "",
      transcript: this.state.transcript || "",
      await this.initializeMeeting();
    }
    
    const { error: meetingError } = await supabase
      .from('meetings')
      .update({
        title: this.state.meeting_title,
        status: this.state.meeting_status,
        last_updated: this.state.last_updated
      })
      .eq('id', this.state.meeting_id)
      .eq('user_id', this.userId);

    if (meetingError) console.error("❌ Failed to update meeting:", meetingError);

    if (this.state.topics.length > 0) {
      const topicsToSync = this.state.topics.map(topic => ({
        meeting_id: this.state.meeting_id,
        topic_id: topic.topic_id,
        topic_name: topic.topic_name,
        nature: topic.nature,
        status: topic.status,
        start_time: topic.start_time,
        end_time: topic.end_time || null,
        summary_points: topic.summary_points || [],
        action_items: topic.action_items || [],
        branched_from: topic.branched_from,
        updated_at: new Date().toISOString()
      }));

      const { error: topicsError } = await supabase
        .from('topics')
        .upsert(topicsToSync, { onConflict: 'meeting_id,topic_id' });

      if (topicsError) console.error("❌ Failed to upsert topics:", topicsError);
      else console.log(`✅ State synced to Supabase`);
    }
  }

  _writeToFile() {
    fs.writeFileSync(STATE_FILE, JSON.stringify(this.state, null, 2));
  }

  async reset() {
    this.state = this._defaultState();
    this._writeToFile();
  }
}