// auth.js
import { supabase } from "./supabase.js";
import { StateManager } from "./StateManager.js";

// ==========================================
// 1. SIGN UP A NEW USER
// ==========================================
export async function signUpUser(email, password, displayName, professionalRole) {
  // The 'options.data' is automatically caught by your SQL trigger 
  // and saved into the 'profiles' table!
  const { data, error } = await supabase.auth.signUp({
    email: email,
    password: password,
    options: {
      data: {
        display_name: displayName,
        professional_role: professionalRole
      }
    }
  });

  if (error) {
    console.error(" Signup failed:", error.message);
    return null;
  }

  console.log(` User signed up! ID: ${data.user.id}`);
  return data.user;
}

// ==========================================
// 2. LOG IN AN EXISTING USER
// ==========================================
export async function logInUser(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({
    email: email,
    password: password,
  });

  if (error) {
    console.error("Login failed:", error.message);
    return null;
  }

  console.log(` User logged in! ID: ${data.user.id}`);
  return data.user;
}

// ==========================================
// 3. START A MEETING FOR THE LOGGED-IN USER
// ==========================================
export async function startMeetingForUser(user) {
  if (!user) {
    console.error(" Cannot start meeting: No user logged in.");
    return;
  }

  // Pass the user's ID into the StateManager
  const manager = new StateManager(user.id);
  
  await manager.initializeMeeting();
  console.log(" Meeting initialized for user:", user.email);
  
  return manager;
}