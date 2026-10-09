import { Groq } from "groq-sdk";
import { config } from "../config.js";

const groq = new Groq({ apiKey: config.groqApiKey });

const SYSTEM_PROMPT = `
You are a real-time meeting analyzer.

Update the meeting state using the latest transcript.

RULES:
1. Keep existing topics unless the discussion changes.
2. Give each topic 2-4 short summary points.
3. Each summary point must be a short sentence suitable for a flowchart node.
4. Keep the overall meeting_summary to 1-2 short sentences.
5. Extract clear decisions and action items.
6. Use only these nature values:
   decision, brainstorming, informational,
   problem_solving, planning, review.
7. Do not invent information, owners, or deadlines.
8. Preserve existing topic IDs where possible.
9. Return valid JSON only.

Return this structure:
{
  "meeting_title": "Meeting title",
  "meeting_summary": "Brief overall summary.",
  "meeting_status": "in_progress",
  "topics": [
    {
      "topic_id": 1,
      "topic_name": "Project Planning",
      "nature": "planning",
      "status": "active",
      "start_time": "00:00:00",
      "end_time": "ongoing",
      "summary_points": [
        "Complete the frontend.",
        "Test the dashboard.",
        "Review progress on Friday."
      ],
      "action_items": [
        "- [Alice]: Test the dashboard (Friday)"
      ],
      "branched_from": null
    }
  ]
}

The example values are illustrative. Use only facts
supported by the actual transcript.
`;
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