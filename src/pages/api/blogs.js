import { MongoClient } from 'mongodb';
// No longer importing Permit SDK
import dotenv from "dotenv"; // Import dotenv

dotenv.config(); // Load .env variables

// Define PDP URL (use environment variable or default)
const PDP_URL = process.env.PERMIT_PDP_URL || "http://localhost:7766"; // Defaulting to local PDP, adjust if using cloud PDP

// MongoDB Connection URI
const uri = process.env.MONGODB_URI || ''; // Use consistent env var name
let client; // Declare client outside try block

// Define database and collection names (as per user feedback)
const USER_DB_NAME = 'test';
const USER_COLLECTION_NAME = 'users';
const DATA_DB_NAME = 'capybara_db';
const DATA_COLLECTION_NAME = 'resumes';

export async function GET({ request }) {
  const url = new URL(request.url);
  // Change query parameter name from 'userId' to 'username'
  const username = url.searchParams.get('username');

  if (!username) {
    return new Response(JSON.stringify({ error: 'username query parameter is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (!uri) {
    console.error('MONGODB_URI environment variable is not set.');
    return new Response(JSON.stringify({ error: 'Server configuration error: Missing database URI.' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    // Initialize and connect MongoDB client
    client = new MongoClient(uri);
    await client.connect();
    console.log('Connected to MongoDB Atlas');

    // --- Fetch User Role from MongoDB ---
    const userDb = client.db(USER_DB_NAME);
    const usersCollection = userDb.collection(USER_COLLECTION_NAME);
    // Use the 'username' variable to query the 'username' field
    const user = await usersCollection.findOne({ username: username });

    if (!user) {
      console.log(`User not found in MongoDB: ${username}`);
      // Decide if this should be 404 Not Found or 403 Forbidden
      return new Response(JSON.stringify({ error: 'User not found' }), {
        status: 404, // Or 403?
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const userRole = user.role || 'guest'; // Default to 'guest' if role field is missing
    console.log(`User ${username} found with role: ${userRole}`); // Use username variable

    // --- Permit.io Check with User Role Attribute ---
    // --- Authorization Logic using Proxy User for Role Check (Cloud PDP Compatible) ---
    let permitted = false;
    const PROXY_USER_KEY_FOR_BASIC_ROLE = '_proxy_for_basic_role'; // Define a key for the proxy user in Permit.io

    // 1. Check if user's role from DB is 'basic'
    if (userRole === 'basic') {
      // 2. If role is 'basic', check permission for the predefined proxy user in Permit.io
      console.log(`User role is 'basic'. Checking Permit.io for proxy user '${PROXY_USER_KEY_FOR_BASIC_ROLE}', action: read, resource: Blog`);
      // --- Direct PDP Check using fetch for Proxy User ---
      const pdpPayload = {
          user: { key: PROXY_USER_KEY_FOR_BASIC_ROLE },
          action: { key: 'read' },
          resource: { type: 'Blog' }, // Assuming 'Blog' is the resource type
          // tenant: "default", // Add if using multi-tenancy
          // context: {}, // Add if using context
      };

      try {
          const pdpResponse = await fetch(`${PDP_URL}/allowed`, {
              method: 'POST',
              headers: {
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${process.env.PERMIT_API_KEY}` // Use consistent API key name
              },
              body: JSON.stringify(pdpPayload)
          });

          if (!pdpResponse.ok) {
              const errorText = await pdpResponse.text();
              console.error(`PDP request failed for proxy user '${PROXY_USER_KEY_FOR_BASIC_ROLE}': ${pdpResponse.status} - ${errorText}`);
              permitted = false;
          } else {
              const pdpResult = await pdpResponse.json();
              permitted = pdpResult?.allow === true;
          }
      } catch (pdpError) {
          console.error(`Error contacting Permit PDP for proxy user '${PROXY_USER_KEY_FOR_BASIC_ROLE}':`, pdpError);
          permitted = false; // Fail closed on error
      }
    } else {
      // 3. If user role from DB is not 'basic', deny access.
      console.log(`User ${username} role is '${userRole}' (not 'basic'), access denied.`); // Use username variable
      permitted = false;
    }

    if (!permitted) {
      console.log(`Access Denied for user ${username} (role: ${userRole}). Check failed for role 'basic' via proxy user '${PROXY_USER_KEY_FOR_BASIC_ROLE}' in Permit.io.`);
      return new Response(JSON.stringify({ error: 'Forbidden' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    // Log indicates permission granted (either via DB role 'basic' + proxy check, or potentially other logic if added later)
    console.log(`User ${username} is PERMITTED to read Blogs`); // Use username variable

    // --- Fetch User Data (as requested) ---
    // Re-use the usersCollection variable from the role check above

    // Fetch all users - adjust query if needed (e.g., filter fields)
    const data = await usersCollection.find({}).toArray(); // Use existing usersCollection
    console.log(`Fetched ${data.length} documents from ${USER_COLLECTION_NAME}`); // Log user collection name

    return new Response(JSON.stringify(data), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('API Error:', error);
    return new Response(JSON.stringify({ error: 'An internal server error occurred.' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  } finally {
    // Ensure the client will close when you finish/error
    if (client && client.topology && client.topology.isConnected()) {
      await client.close();
      console.log('MongoDB connection closed');
    }
  }
}