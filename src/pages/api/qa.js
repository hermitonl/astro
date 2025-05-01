// No longer importing Permit SDK
import { GoogleGenerativeAI } from "@google/generative-ai";
import dotenv from "dotenv";
import fs from 'fs/promises'; // To read document files
import path from 'path'; // To handle file paths

dotenv.config();

// Initialize Gemini AI
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-2.5-pro-exp-03-25" }); // Or your preferred model

// Define PDP URL (use environment variable or default)
const PDP_URL = process.env.PERMIT_PDP_URL || "http://localhost:7766";

// Define the path to the documents directory (relative to project root)
const documentsDir = path.resolve(process.cwd(), 'src/documents'); // Assuming documents are in astro/src/documents

// Helper function to read document content
async function getDocumentContent(documentId) {
    // Basic security check: prevent directory traversal
    if (documentId.includes('..') || documentId.includes('/')) {
        throw new Error('Invalid document ID');
    }
    const filePath = path.join(documentsDir, `${documentId}.txt`); // Assuming .txt files
    try {
        // Ensure the documents directory exists
        await fs.mkdir(documentsDir, { recursive: true });
        const content = await fs.readFile(filePath, 'utf-8');
        return content;
    } catch (error) {
        if (error.code === 'ENOENT') {
            console.error(`Document not found: ${filePath}`);
            return null; // Or throw a specific error
        }
        console.error(`Error reading document ${documentId}:`, error);
        throw error; // Re-throw other errors
    }
}

export async function POST({ request }) {
    try {
        const { userId, question, documentId } = await request.json();

        if (!userId || !question || !documentId) {
            return new Response(JSON.stringify({ error: "Missing userId, question, or documentId" }), { status: 400 });
        }

        // --- Permit.io Check ---
        // Define the resource based on the documentId
        const resource = {
            type: 'document', // Resource type defined in Permit.io
            key: documentId   // Specific document instance
        };
        const action = 'query'; // Action defined in Permit.io

        console.log(`Checking permission via PDP for user '${userId}' to perform action '${action}' on resource '${resource.type}:${resource.key}'`);

        // --- Direct PDP Check using fetch ---
        const pdpPayload = {
            user: { key: userId },
            action: { key: action },
            resource: resource,
            // tenant: "default", // Add if using multi-tenancy
            // context: {}, // Add if using context
        };

        let permitted = false; // Default to false
        try {
            const pdpResponse = await fetch(`${PDP_URL}/allowed`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${process.env.PERMIT_API_KEY}` // Use the API key for PDP auth
                },
                body: JSON.stringify(pdpPayload)
            });

            if (!pdpResponse.ok) {
                const errorText = await pdpResponse.text();
                console.error(`PDP request failed: ${pdpResponse.status} - ${errorText}`);
                permitted = false;
            } else {
                const pdpResult = await pdpResponse.json();
                permitted = pdpResult?.allow === true;
            }
        } catch (pdpError) {
            console.error("Error contacting Permit PDP:", pdpError);
            permitted = false;
        }


        if (!permitted) {
            console.log(`Permission denied by PDP for user '${userId}'`);
            return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 });
        }
        console.log(`Permission granted for user '${userId}'`);

        // --- Fetch Document Content ---
        const documentContent = await getDocumentContent(documentId);
        if (documentContent === null) {
             return new Response(JSON.stringify({ error: `Document '${documentId}' not found.` }), { status: 404 });
        }

        // --- Call Gemini API ---
        const prompt = `Based on the following document content, answer the question:

Document Content:
---
${documentContent}
---

Question: ${question}

Answer:`;

        console.log(`Generating response for question: "${question}" regarding document: "${documentId}"`);
        const result = await model.generateContent(prompt);
        const response = await result.response;
        const answer = response.text();
        console.log("Gemini Answer:", answer);


        return new Response(JSON.stringify({ answer }), { status: 200 });

    } catch (error) {
        console.error("Error in /api/qa:", error);
        return new Response(JSON.stringify({ error: "Internal Server Error", details: error.message }), { status: 500 });
    }
}