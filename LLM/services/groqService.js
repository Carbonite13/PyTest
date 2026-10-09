import { Groq } from "groq-sdk";
import { config } from "../config.js";

const groq = new Groq({ apiKey: config.groqApiKey });

const SYSTEM_PROMPT = `You are an expert Real-Time Meeting Analyst. You receive the CURRENT STATE of a meeting and the MOST RECENT raw transcript. Update the state incrementally.

STRICT RULES:
1. NO DUPLICATES: Update existing topics unless the subject fundamentally shifts.
2. ACTION ITEMS: Format as "- [Owner]: Task (Deadline)". Use "Unassigned" if unknown.
3. NATURE: Use ONLY: "decision", "brainstorming", "informational", "problem_solving", "planning", "review".
4. BRANCHING: Set "branched_from" to parent topic_id, or null.
5. STATUS: Active topic = "active" (end_time: "ongoing"). Finished topics = "completed" (with end_time).

Return ONLY valid JSON. No markdown, no explanations.

JSON STRUCTURE:
{
  "meeting_title": "Specific Title",
  "meeting_status": "in_progress",
  "started_at": "ISO_DATE",
  "last_updated": "ISO_DATE",
  "topics": [
    {
      "topic_id": 1,
      "topic_name": "Concise Title",
      "nature": "decision",
      "status": "completed",
      "start_time": "HH:MM:SS",
      "end_time": "HH:MM:SS",
      "summary_points": ["Point 1"],
      "action_items": ["- [Alice]: Do this by Friday"],
      "branched_from": null
    }
  ]
}`;

export async function analyzeTranscript(currentState, recentTranscript) {
  const userPrompt = `CURRENT STATE:
${JSON.stringify(currentState)}

NEW TRANSCRIPT:
${recentTranscript}

Analyze and return UPDATED JSON.`;

  try {
    const response = await groq.chat.completions.create({
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt }
      ],
      model: config.groqModel,
      temperature: config.temperature,
      max_tokens: config.maxTokens,
    });

    let raw = response.choices[0]?.message?.content || "";
    raw = raw.replace(/^```json\n?|\n?```$/g, "").trim();
    raw = raw.replace(/^```\n?|\n?```$/g, "").trim();

    return JSON.parse(raw);
  } catch (err) {
    console.error("❌ Groq analysis failed:", err.message);
    throw err;
  }
}