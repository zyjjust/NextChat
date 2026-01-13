
// scripts/debug-proxy.mjs
import { GoogleGenAI } from "@google/genai";
import fs from 'fs';
import path from 'path';

// 1. Manually load .env.local
const envPath = path.resolve(process.cwd(), '.env.local');
if (fs.existsSync(envPath)) {
    const envConfig = fs.readFileSync(envPath, 'utf-8');
    envConfig.split('\n').forEach(line => {
        const [key, value] = line.split('=');
        if (key && value) {
            process.env[key.trim()] = value.trim();
        }
    });
    console.log("Loaded .env.local");
}

console.log("HTTPS_PROXY:", process.env.HTTPS_PROXY);

// 2. Setup Undici Proxy
async function setupProxy() {
    try {
        const { setGlobalDispatcher, ProxyAgent } = await import('undici');
        if (process.env.HTTPS_PROXY) {
            const dispatcher = new ProxyAgent(process.env.HTTPS_PROXY);
            setGlobalDispatcher(dispatcher);
            console.log("Undici Global Dispatcher set to ProxyAgent");
        }
    } catch (e) {
        console.log("Undici not found or failed to load:", e.message);
    }
}

async function testConnection() {
    await setupProxy();

    try {
        // Simple Fetch
        console.log("\n[1] Testing fetch to google.com...");
        const res = await fetch("https://www.google.com");
        console.log("Fetch Status:", res.status);

        // Gemini SDK
        console.log("\n[2] Testing Gemini SDK...");
        const apiKey = process.env.GEMINI_API_KEY || process.env.NEXT_PUBLIC_GEMINI_API_KEY;
        const ai = new GoogleGenAI({ apiKey });

        const result = await ai.models.generateContent({
            model: "gemini-1.5-flash",
            contents: { parts: [{ text: "Hi" }] }
        });

        console.log("Gemini Response:", result.text?.substring(0, 20));
        console.log("SUCCESS");

    } catch (error) {
        console.error("FAIL:", error.message);
        if (error.cause) console.error("Cause:", error.cause);
    }
}

testConnection();
