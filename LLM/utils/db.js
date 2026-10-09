import pkg from 'pg';
const { Pool } = pkg;
import dotenv from 'dotenv';

dotenv.config();

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false // Required for Render's managed PostgreSQL
  }
});

export async function initDb() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS meetings (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        title VARCHAR(255),
        status VARCHAR(50),
        started_at TIMESTAMP,
        last_updated TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS topics (
        id SERIAL PRIMARY KEY,
        meeting_id UUID REFERENCES meetings(id) ON DELETE CASCADE,
        topic_id INT,
        topic_name VARCHAR(255),
        nature VARCHAR(50),
        status VARCHAR(50),
        start_time VARCHAR(20),
        end_time VARCHAR(20),
        summary_points JSONB,
        action_items JSONB,
        branched_from INT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(meeting_id, topic_id)
      );
    `);
    console.log("✅ Database tables initialized successfully");
  } catch (err) {
    console.error("❌ Failed to initialize database:", err);
    throw err;
  } finally {
    client.release();
  }
}