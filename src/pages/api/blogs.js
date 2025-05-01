import { MongoClient } from 'mongodb';
import { Permit } from 'permitio';

// Initialize Permit SDK
// Ensure PERMIT_TOKEN is set in your environment variables
const permit = new Permit({
  token: process.env.PERMIT_TOKEN || '', // Use Vercel env var
  pdp: 'https://cloudpdp.api.permit.io', // or your PDP address
});

// MongoDB Connection URI
// Ensure MONGODB_URI is set in your environment variables
const uri = process.env.MONGODB_URI || ''; // Use Vercel env var
const client = new MongoClient(uri);

export async function GET({ request }) {
  const url = new URL(request.url);
  const userId = url.searchParams.get('userId'); // Get userId from query param

  if (!userId) {
    return new Response(JSON.stringify({ error: 'userId query parameter is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    // --- Permit.io Check ---
    console.log(`Checking permit for user: ${userId}, action: read, resource: Blog`);
    const permitted = await permit.check(userId, 'read', 'Blog');

    if (!permitted) {
      console.log(`User ${userId} is NOT PERMITTED to read Blogs`);
      return new Response(JSON.stringify({ error: 'Forbidden' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    console.log(`User ${userId} is PERMITTED to read Blogs`);

    // --- MongoDB Fetch ---
    if (!uri) {
        console.error('MONGODB_URI environment variable is not set.');
        return new Response(JSON.stringify({ error: 'Server configuration error: Missing database URI.' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
        });
    }

    await client.connect();
    console.log('Connected to MongoDB Atlas');
    const database = client.db('capybara_db'); // Replace with your actual database name
    const blogsCollection = database.collection('resumes'); // Replace with your actual collection name

    const blogs = await blogsCollection.find({}).toArray();
    console.log(`Fetched ${blogs.length} blogs`);

    return new Response(JSON.stringify(blogs), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('API Error:', error);
    // Determine if it's a Permit error or MongoDB error for more specific logging if needed
    return new Response(JSON.stringify({ error: 'An internal server error occurred.' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  } finally {
    // Ensure the client will close when you finish/error
    await client.close();
    console.log('MongoDB connection closed');
  }
}