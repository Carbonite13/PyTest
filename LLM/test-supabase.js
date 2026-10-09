// test-supabase.js
import { signUpUser, logInUser, startMeetingForUser } from "./auth.js";

async function runFullTest() {
  console.log("🚀 Starting Full Auth & StateManager Test...\n");

  // 1. Sign up a new user (This triggers your SQL to create the profile)
  console.log("1️⃣ Signing up new user...");
  const newUser = await signUpUser(
    "jeffinmathew469@gmail.com", 
    "supersecretpassword123", 
    "Jane Doe", 
    "Senior Data Analyst"
  );

  if (!newUser) return;

  // 2. Start a meeting for this user
  console.log("\n2️⃣ Starting meeting for the new user...");
  const manager = await startMeetingForUser(newUser);

  // 3. Add some topics to prove it's working
  console.log("\n3️⃣ Adding topics to the meeting...");
  await manager.updateState({
    topics: [
      {
        topic_id: 1,
        topic_name: "Q4 Review",
        nature: "discussion",
        status: "completed",
        start_time: "10:00",
        end_time: "10:15",
        summary_points: ["Good quarter"],
        action_items: ["Celebrate"],
        branched_from: null
      }
    ]
  });

  console.log("\n🎉 Test completed! Check your Supabase Dashboard.");
  console.log("- Check 'auth.users' for the login.");
  console.log("- Check 'profiles' for Jane Doe's role.");
  console.log("- Check 'meetings' to see it's titled 'Jane Doe's Meeting'.");
}

runFullTest();