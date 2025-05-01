// No longer importing Permit SDK
import dotenv from "dotenv"; // Import dotenv if not already globally configured for API routes

dotenv.config(); // Load .env variables

// Define PDP URL (use environment variable or default)
const PDP_URL = process.env.PERMIT_PDP_URL || "http://localhost:7766"; // Defaulting to local PDP, adjust if using cloud PDP

export const GET = async ({request}) =>  {
    const url = new URL(request.url);
    const params = new URLSearchParams(url.search);

    const id =  params.get("id") ;
    const operation = params.get("operation");
      
    console.log(id);
    console.log(operation);
    let response;

    try{

        // --- Direct PDP Check using fetch ---
        const pdpPayload = {
            user: { key: String(id) },
            action: { key: String(operation) },
            resource: {
                type: "Blog",
                // key: "*", // Or specify a specific blog key if needed
                tenant: "blog-tenant",
            },
            // context: {}, // Add if using context
        };

        let permitted = false; // Default to false
        try {
            const pdpResponse = await fetch(`${PDP_URL}/allowed`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    // Use PERMIT_API_KEY consistent with qa.js and .env
                    'Authorization': `Bearer ${process.env.PERMIT_API_KEY}`
                },
                body: JSON.stringify(pdpPayload)
            });

            if (!pdpResponse.ok) {
                const errorText = await pdpResponse.text();
                console.error(`PDP request failed for ${id}/${operation}: ${pdpResponse.status} - ${errorText}`);
                permitted = false;
            } else {
                const pdpResult = await pdpResponse.json();
                permitted = pdpResult?.allow === true;
            }
        } catch (pdpError) {
            console.error(`Error contacting Permit PDP for ${id}/${operation}:`, pdpError);
            permitted = false;
        }

        // --- Construct Response ---
        if (permitted) {
            console.log(`Permission granted by PDP for ${id}/${operation} on Blog`);
            response = { "status" : "permitted" };
        } else {
            console.log(`Permission denied by PDP for ${id}/${operation} on Blog`);
            response = { "status" : "not-permitted" };
        }

        return new Response(JSON.stringify(response), { status : 200 });

    } catch(err) { // Catch errors outside the PDP check
        
        response = {
            "problem": "internal server error",
            "error" : err
        }

        return new Response(JSON.stringify(response), { status :  500 })
    }

  }