import { Groq } from "groq-sdk";
import { config } from "./config.js";

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

console.log("Testing API key:", config.groqApiKey?.substring(0, 10) + "...");
console.log("Testing Model:", config.groqModel);

const groq = new Groq({ apiKey: config.groqApiKey });

async function test() {
    try {
        console.log("Connecting to Groq...");
        const response = await groq.chat.completions.create({
            messages: [{ role: "user", content: "Say hello" }],
            model: config.groqModel,
            max_tokens: 50,
        });
        console.log("✅ SUCCESS! API response:", response.choices[0].message.content);
    } catch (err) {
        console.error("❌ FAILED! Error:", err.message);
    }
}

test();