import { Groq } from "groq-sdk";
import dotenv from "dotenv";

// Load .env and bypass strict SSL
dotenv.config();
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

async function listModels() {
    try {
        console.log("🔍 Asking Groq for available models...\n");
        const response = await groq.models.list();

        console.log("✅ SUCCESS! Your API key works. You have access to these models:\n");
        response.data.forEach(model => {
            console.log(`  ➔ ${model.id}`);
        });

        console.log("\n💡 Copy one of the names above (like 'llama3-8b-8192') and we will put it in config.js!");
    } catch (err) {
        console.error("❌ FAILED! Error:", err.message);
    }
}

listModels();