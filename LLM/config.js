import dotenv from "dotenv";
dotenv.config();

export const config = {
  port: process.env.PORT || 3000,
  groqApiKey: process.env.GROQ_API_KEY,
  triggerWordCount: parseInt(process.env.TRIGGER_WORD_COUNT) || 30,
  groqModel: "openai/gpt-oss-20b", // <-- YOUR CHOSEN MODEL
  maxTokens: 3000,
  temperature: 0.15,
};

console.log("🔑 API Key loaded:", config.groqApiKey?.substring(0, 10) + "...");
console.log("🤖 Model set to:", config.groqModel);