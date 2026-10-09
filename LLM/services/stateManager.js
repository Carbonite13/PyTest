import fs from "fs";
import { pool } from "../utils/db.js";

const STATE_FILE = "meeting.json";

export class StateManager {
  constructor() {
    this.state = this._defaultState();
    this._writeToFile();
  }

  _defaultState() {
    return {
      meeting_id: null,
      meeting_title: "Untitled Meeting",
      meeting_status: "in_progress",
      started_at: new Date().toISOString(),
      last_updated: new Date().toISOString(),
      topics: []
    };
  }

  async initializeMeeting() {
    const client = await pool.connect();
    try {
      const res = await client.query(
        `INSERT INTO meetings (title, status, started_at, last_updated) 
         VALUES ($1, $2, $3, $4) 
         RETURNING id`,
        [this.state.meeting_title, this.state.meeting_status, this.state.started_at, this.state.last_updated]
      );
      this.state.meeting_id = res.rows[0].id;
      console.log(` New meeting created in DB: ${this.state.meeting_id}`);
    } finally {
      client.release();
    }
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
      await this.initializeMeeting();
    }
    
    const client = await pool.connect();
    try {
      await client.query(
        `UPDATE meetings SET title = $1, status = $2, last_updated = $3 WHERE id = $4`,
        [this.state.meeting_title, this.state.meeting_status, this.state.last_updated, this.state.meeting_id]
      );

      for (const topic of this.state.topics) {
        await client.query(
          `INSERT INTO topics 
           (meeting_id, topic_id, topic_name, nature, status, start_time, end_time, summary_points, action_items, branched_from, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, CURRENT_TIMESTAMP)
           ON CONFLICT (meeting_id, topic_id) 
           DO UPDATE SET 
             topic_name = EXCLUDED.topic_name,
             nature = EXCLUDED.nature,
             status = EXCLUDED.status,
             start_time = EXCLUDED.start_time,
             end_time = EXCLUDED.end_time,
             summary_points = EXCLUDED.summary_points,
             action_items = EXCLUDED.action_items,
             branched_from = EXCLUDED.branched_from,
             updated_at = CURRENT_TIMESTAMP`,
          [
            this.state.meeting_id,
            topic.topic_id,
            topic.topic_name,
            topic.nature,
            topic.status,
            topic.start_time,
            topic.end_time || null,
            JSON.stringify(topic.summary_points || []),
            JSON.stringify(topic.action_items || []),
            topic.branched_from
          ]
        );
      }
      console.log(" State synced to PostgreSQL");
    } catch (err) {
      console.error("❌ Database sync failed:", err);
    } finally {
      client.release();
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