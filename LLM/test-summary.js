import "dotenv/config";
import { supabase } from "./supabase.js";

async function testSummaryStorage() {
  try {
    console.log("🧪 Testing meeting summary storage...\n");

    // 1. Create a test meeting with a summary
    const testSummary =
      "The team discussed project progress, assigned development tasks, and planned the next review meeting.";

    const { data: meeting, error: insertError } = await supabase
      .from("meetings")
      .insert({
        title: "Summary Storage Test",
        status: "completed",
        started_at: new Date().toISOString(),
        last_updated: new Date().toISOString(),
        summary: testSummary
      })
      .select("id, title, summary")
      .single();

    if (insertError) throw insertError;

    console.log("✅ Meeting created!");
    console.log("Meeting ID:", meeting.id);
    console.log("Summary:", meeting.summary);

    // 2. Read the summary back from the database
    const { data: savedMeeting, error: readError } = await supabase
      .from("meetings")
      .select("id, title, summary")
      .eq("id", meeting.id)
      .single();

    if (readError) throw readError;

    console.log("\n🔍 Checking saved data...");

    if (savedMeeting.summary === testSummary) {
      console.log("✅ SUCCESS: Summary is stored and retrieved correctly!");
    } else {
      console.log("❌ FAILED: Summary does not match.");
    }

    console.log("\nRetrieved summary:", savedMeeting.summary);
  } catch (error) {
    console.error("\n❌ Test failed:", error.message);
  }
}

testSummaryStorage();