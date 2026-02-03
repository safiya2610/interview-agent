import { GoogleGenerativeAI } from "@google/generative-ai";
import dotenv from "dotenv";

// Load environment variables from .env file
dotenv.config({ path: '.env' });

const apiKey = process.env.GEMINI_API_KEY;

if (!apiKey) {
  console.error("❌ Error: GEMINI_API_KEY is missing in .env file");
  process.exit(1);
}

console.log(`🔑 Found API Key: ${apiKey.substring(0, 5)}...`);

const genAI = new GoogleGenerativeAI(apiKey);

async function listModels() {
  try {
    console.log("📡 Connecting to Gemini API to list models...");
    // Note: listModels is not directly exposed on the main class in some versions, 
    // but we can try a simple generation to test the key.
    // Actually, for the node SDK, we can't easily list models without using the REST API directly 
    // or specific model manager methods if available. 
    // Let's just try to generate content with a few common model names to see which one works.
    
    const modelsToTest = ["gemini-1.5-flash", "gemini-1.5-pro", "gemini-pro"];
    
    for (const modelName of modelsToTest) {
      console.log(`\n🧪 Testing model: ${modelName}`);
      try {
        const model = genAI.getGenerativeModel({ model: modelName });
        const result = await model.generateContent("Hello, are you working?");
        const response = await result.response;
        console.log(`✅ Success! Model '${modelName}' is working.`);
        console.log(`   Response: ${response.text()}`);
        return; // Exit after first success
      } catch (error) {
        console.error(`❌ Failed with '${modelName}':`);
        console.error(`   ${error.message}`);
      }
    }
    
    console.log("\n🔍 Attempting to list models via REST API...");
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
    const data = await response.json();
    
    if (data.models) {
      console.log("✅ Available Models:");
      data.models.forEach(m => {
        if (m.supportedGenerationMethods && m.supportedGenerationMethods.includes("generateContent")) {
          console.log(`   - ${m.name.replace('models/', '')}`);
        }
      });
    } else {
      console.error("❌ Failed to list models via REST:");
      console.error(JSON.stringify(data, null, 2));
    }
    
  } catch (error) {
    console.error("❌ Fatal Error:", error);
  }
}

listModels();
