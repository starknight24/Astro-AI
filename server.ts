import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT) || 3000;

// Enable JSON payload parsing (generous size limit for image uploads)
app.use(express.json({ limit: "20mb" }));

// Initialize GoogleGenAI client lazily or safely
let aiClient: GoogleGenAI | null = null;

function getAiClient(): GoogleGenAI {
  if (!aiClient) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      console.warn("GEMINI_API_KEY is not defined in environment variables. Running in fallback/simulation mode.");
    }
    aiClient = new GoogleGenAI({
      apiKey: apiKey || "MOCK_KEY",
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build",
        },
      },
    });
  }
  return aiClient;
}

// 1. Concept Explainer / Conversational AI Tutor
app.post("/api/chat", async (req, res) => {
  try {
    const { message, history = [], degreeLevel = "Bachelor", explainSimply = false } = req.body;
    const client = getAiClient();
    
    // Build context-specific system instruction
    const systemInstruction = `You are AstroAI, an expert conversational AI tutor in space engineering, astrodynamics, and astronomy.
Your target audience ranges from undergraduate (Bachelor's) to PhD level.
Current student details:
- Academic Level: ${degreeLevel}
- Mode: ${explainSimply ? "Simplified, high-level analogies and intuitive explanations." : "Academic, mathematically rigorous, incorporating equations (using standard LaTeX formatted as $equation$ for inline and $$equation$$ for block) and textbook references."}

Always be encouraging, precise, and educational. When helpful, cite Kepler's Laws, Rocket Equation, or orbital mechanics parameters.`;

    const chatHistory = history.map((h: any) => ({
      role: h.role === "user" ? "user" : "model",
      parts: [{ text: h.text }],
    }));

    // Generate content using gemini-3.5-flash as specified
    const response = await client.models.generateContent({
      model: "gemini-3.5-flash",
      contents: [
        ...chatHistory,
        { role: "user", parts: [{ text: message }] }
      ],
      config: {
        systemInstruction,
        temperature: 0.7,
      },
    });

    res.json({ text: response.text });
  } catch (error: any) {
    console.error("Error in /api/chat:", error);
    res.status(500).json({ error: error.message || "Failed to generate AI response." });
  }
});

// 2. Practice Problem Generator
app.post("/api/problems", async (req, res) => {
  try {
    const { topic, difficulty = "Intermediate", count = 3 } = req.body;
    const client = getAiClient();

    const prompt = `Generate exactly ${count} educational physics/astronomy problems about "${topic}" for academic level "${difficulty}".
For each problem, provide:
1. A clear statement of the problem (incorporating variable values, e.g. mass, altitude, semi-major axis, etc.).
2. The relevant formulas that apply.
3. A fully detailed step-by-step solution, showing substitutions.

Format the response strictly as a JSON array of objects with the fields:
- "id": a unique string
- "problem": string text of the problem
- "hint": a helpful hint string
- "formulas": string detailing the equations (using LaTeX $...$)
- "solution": detailed string step-by-step resolution

Generate the response in valid JSON.`;

    const response = await client.models.generateContent({
      model: "gemini-3.5-flash",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              id: { type: Type.STRING },
              problem: { type: Type.STRING },
              hint: { type: Type.STRING },
              formulas: { type: Type.STRING },
              solution: { type: Type.STRING },
            },
            required: ["id", "problem", "hint", "formulas", "solution"],
          },
        },
      },
    });

    const data = JSON.parse(response.text || "[]");
    res.json(data);
  } catch (error: any) {
    console.error("Error in /api/problems:", error);
    res.status(500).json({ error: error.message || "Failed to generate practice problems." });
  }
});

// 3. Quiz Mode Generator
app.post("/api/quiz", async (req, res) => {
  try {
    const { topic, difficulty = "Medium" } = req.body;
    const client = getAiClient();

    const prompt = `Generate a high-quality 5-question multiple choice quiz on the topic "${topic}" suitable for a "${difficulty}" level space engineering student.
Format the output as a JSON array of objects, with each object containing:
- "question": the quiz question string.
- "options": an array of 4 option strings.
- "correctAnswer": the index (0, 1, 2, or 3) of the correct option.
- "explanation": a detailed explanation explaining why the correct answer is right and why the others are wrong (using LaTeX equations where helpful).`;

    const response = await client.models.generateContent({
      model: "gemini-3.5-flash",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              question: { type: Type.STRING },
              options: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
              },
              correctAnswer: { type: Type.INTEGER },
              explanation: { type: Type.STRING },
            },
            required: ["question", "options", "correctAnswer", "explanation"],
          },
        },
      },
    });

    const quiz = JSON.parse(response.text || "[]");
    res.json(quiz);
  } catch (error: any) {
    console.error("Error in /api/quiz:", error);
    res.status(500).json({ error: error.message || "Failed to generate quiz." });
  }
});

// 4. Space Mission Explainer
app.post("/api/mission", async (req, res) => {
  try {
    const { missionName } = req.body;
    const client = getAiClient();

    const prompt = `Provide a comprehensive structured breakdown of the space mission "${missionName}".
The response must include:
- Objectives: The primary goals of the mission.
- Orbit: Detailed orbital or trajectory parameters (e.g., L2 halo orbit, LEO altitude, eccentricity, launch dates, etc.).
- Engineering Challenges: Key mechanical, thermal, optical, or communications hurdles.
- Key Discoveries: Major scientific findings or data collected.
- Recommended Links/Reading: 2-3 specific real reading references or papers.

Format the response strictly as a JSON object with fields:
{
  "name": "${missionName}",
  "objectives": "...",
  "orbit": "...",
  "challenges": "...",
  "discoveries": "...",
  "links": "..."
}`;

    const response = await client.models.generateContent({
      model: "gemini-3.5-flash",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            name: { type: Type.STRING },
            objectives: { type: Type.STRING },
            orbit: { type: Type.STRING },
            challenges: { type: Type.STRING },
            discoveries: { type: Type.STRING },
            links: { type: Type.STRING },
          },
          required: ["name", "objectives", "orbit", "challenges", "discoveries", "links"],
        },
      },
    });

    const missionData = JSON.parse(response.text || "{}");
    res.json(missionData);
  } catch (error: any) {
    console.error("Error in /api/mission:", error);
    res.status(500).json({ error: error.message || "Failed to fetch mission breakdown." });
  }
});

// 5. Research Paper Analyzer & Chat (RAG Simulator & Extraction)
app.post("/api/papers/summarize", async (req, res) => {
  try {
    const { paperText, title } = req.body;
    const client = getAiClient();

    const prompt = `You are an expert scientific paper reviewer. Summarize the following research paper context (Title: "${title || "Uploaded Document"}").
Text snippet or content:
"${paperText.substring(0, 8000)}"

Please extract:
1. Abstract: High-level summary of the research.
2. Key Equations: Extract any mathematical equations, formatting them nicely in LaTeX.
3. Methodology: Steps or scientific process.
4. Core Findings: Main discoveries, graphs, or conclusions.

Format the response strictly as a JSON object with keys:
{
  "abstract": "...",
  "equations": "...",
  "methodology": "...",
  "findings": "..."
}`;

    const response = await client.models.generateContent({
      model: "gemini-3.5-flash",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            abstract: { type: Type.STRING },
            equations: { type: Type.STRING },
            methodology: { type: Type.STRING },
            findings: { type: Type.STRING },
          },
          required: ["abstract", "equations", "methodology", "findings"],
        },
      },
    });

    const summary = JSON.parse(response.text || "{}");
    res.json(summary);
  } catch (error: any) {
    console.error("Error in /api/papers/summarize:", error);
    res.status(500).json({ error: error.message || "Failed to summarize paper." });
  }
});

app.post("/api/papers/chat", async (req, res) => {
  try {
    const { paperText, title, message, history = [] } = req.body;
    const client = getAiClient();

    const systemInstruction = `You are a helpful scientific peer. You are discussing the paper "${title || "the uploaded document"}" with a student.
Use the following text snippet as the source of truth/grounding context:
---
${paperText.substring(0, 10000)}
---

When answering questions:
1. Stay strictly grounded in the paper context.
2. Cite sections or pages if applicable (e.g., 'As discussed in the findings...', 'From the extracted methodology...').
3. Keep mathematical notation beautifully formatted with LaTeX ($...$).`;

    const chatHistory = history.map((h: any) => ({
      role: h.role === "user" ? "user" : "model",
      parts: [{ text: h.text }],
    }));

    const response = await client.models.generateContent({
      model: "gemini-3.5-flash",
      contents: [
        ...chatHistory,
        { role: "user", parts: [{ text: message }] }
      ],
      config: {
        systemInstruction,
        temperature: 0.5,
      },
    });

    res.json({ text: response.text });
  } catch (error: any) {
    console.error("Error in /api/papers/chat:", error);
    res.status(500).json({ error: error.message || "Failed to converse on paper." });
  }
});

// 6. High-Quality Image Generation & Creation
// User prompt requirement:
// - Create images using gemini-3.1-flash-image-preview (nano banana 2)
// - Generate high-quality images using model gemini-3-pro-image-preview with size affordance (1K, 2K, 4K)
app.post("/api/image/generate", async (req, res) => {
  try {
    const { prompt, model = "gemini-3-pro-image-preview", size = "1K", aspectRatio = "1:1" } = req.body;
    const client = getAiClient();

    console.log(`Generating image. Model: ${model}, Size: ${size}, Aspect Ratio: ${aspectRatio}`);

    // Map size to valid API values if needed
    const imageSize = size; // Supports "512px", "1K", "2K", "4K"

    const response = await client.models.generateContent({
      model: model,
      contents: {
        parts: [
          {
            text: prompt,
          },
        ],
      },
      config: {
        imageConfig: {
          aspectRatio: aspectRatio,
          imageSize: imageSize,
        },
      },
    });

    // Find the image part in response candidates
    let base64Image = "";
    let extractedText = "";

    const candidates = response.candidates;
    if (candidates && candidates[0]?.content?.parts) {
      for (const part of candidates[0].content.parts) {
        if (part.inlineData) {
          base64Image = part.inlineData.data;
        } else if (part.text) {
          extractedText += part.text;
        }
      }
    }

    if (base64Image) {
      res.json({ imageUrl: `data:image/png;base64,${base64Image}`, info: extractedText });
    } else {
      res.status(400).json({ error: "The model did not return an image part. Refined your prompt or try again." });
    }
  } catch (error: any) {
    console.error("Error in /api/image/generate:", error);
    res.status(500).json({ error: error.message || "Failed to generate cosmic image. Please verify your billing status/API settings." });
  }
});

// 7. Image Editing
// User prompt requirement: "Add functionality to the app for users to use text prompts to create or edit images using gemini-3.1-flash-image-preview."
app.post("/api/image/edit", async (req, res) => {
  try {
    const { base64Image, prompt, mimeType = "image/png" } = req.body;
    const client = getAiClient();

    // Clean up base64 prefix if present
    const cleanBase64 = base64Image.replace(/^data:image\/\w+;base64,/, "");

    const response = await client.models.generateContent({
      model: "gemini-3.1-flash-image-preview",
      contents: {
        parts: [
          {
            inlineData: {
              data: cleanBase64,
              mimeType: mimeType,
            },
          },
          {
            text: prompt,
          },
        ],
      },
    });

    let outputBase64 = "";
    let descriptionText = "";

    const candidates = response.candidates;
    if (candidates && candidates[0]?.content?.parts) {
      for (const part of candidates[0].content.parts) {
        if (part.inlineData) {
          outputBase64 = part.inlineData.data;
        } else if (part.text) {
          descriptionText += part.text;
        }
      }
    }

    if (outputBase64) {
      res.json({ imageUrl: `data:image/png;base64,${outputBase64}`, info: descriptionText });
    } else {
      res.status(400).json({ error: "Image editing model did not return modified image bytes." });
    }
  } catch (error: any) {
    console.error("Error in /api/image/edit:", error);
    res.status(500).json({ error: error.message || "Failed to edit image." });
  }
});

// 8. Space Problem Solver (word problems / formula diagnostics)
app.post("/api/solve", async (req, res) => {
  try {
    const { wordProblem } = req.body;
    const client = getAiClient();

    const prompt = `Analyze the following orbital mechanics or astronomy physics problem:
"${wordProblem}"

Provide a detailed, structured academic response:
1. Parse the Problem Type: (e.g., Keplerian orbit, Hohmann Transfer, Tsiolkovsky Rocket Equation, Escape Velocity, Kepler's Third Law, Specific Orbital Energy).
2. Given Parameters: Extract the variables with correct units.
3. Formula Recommendation: State which physics equations apply, with diagrammatic representation suggestions.
4. Step-by-Step Calculation: Show substitutions and work with proper math notation in LaTeX.
5. Final Answer with proper physical units.
6. Similar Problem Recommendation: Provide a quick text snippet of a similar practice problem.

Format the response strictly as a JSON object with fields:
{
  "problemType": "...",
  "parameters": "...",
  "recommendedFormula": "...",
  "stepByStep": "...",
  "finalAnswer": "...",
  "similarProblem": "..."
}`;

    const response = await client.models.generateContent({
      model: "gemini-3.5-flash",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            problemType: { type: Type.STRING },
            parameters: { type: Type.STRING },
            recommendedFormula: { type: Type.STRING },
            stepByStep: { type: Type.STRING },
            finalAnswer: { type: Type.STRING },
            similarProblem: { type: Type.STRING },
          },
          required: ["problemType", "parameters", "recommendedFormula", "stepByStep", "finalAnswer", "similarProblem"],
        },
      },
    });

    const parsed = JSON.parse(response.text || "{}");
    res.json(parsed);
  } catch (error: any) {
    console.error("Error in /api/solve:", error);
    res.status(500).json({ error: error.message || "Failed to solve problem." });
  }
});

app.get("/health", (_req, res) => {
  res.status(200).json({ status: "ok" });
});

// Mount Vite middleware in development, or serve built bundle in production
async function startServer() {
  if (process.env.NODE_ENV === "production" && !process.env.GEMINI_API_KEY) {
    console.error("GEMINI_API_KEY is required in production.");
    process.exit(1);
  }
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`AstroAI express server booted and running at http://localhost:${PORT}`);
  });
}

startServer();
