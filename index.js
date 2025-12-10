require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { MongoClient, ServerApiVersion } = require('mongodb');

// Express App Initialization
const app = express();
const port = process.env.PORT || 3000;

// ========== MIDDLEWARE ==========
app.use(cors());
app.use(express.json());

// ========== MONGODB CONNECTION ==========
const uri = process.env.MONGODB_URI;

if (!uri) {
  console.error('MONGODB_URI is not defined in .env file');
  process.exit(1);
}

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

// ========== DATABASE & COLLECTIONS ==========
let database;
let usersCollection;

// ========== HEALTH CHECK ==========
// Health Check Route (Public)
app.get('/', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'GarFlex Server is Running!',
    timestamp: new Date().toISOString(),
  });
});

// ========== MAIN FUNCTION ==========
async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();

    // Initialize Database & Collections
    database = client.db('GarFlexDB');
    usersCollection = database.collection('users');

    // ========== ROUTES START ==========
    // ----------Users Collection APIs ----------
    // Create User
    app.post('/users', async (req, res) => {
      try {
        const newUser = req.body;
        const email = newUser.email;

        // Check if user already exists
        const existingUser = await usersCollection.findOne({ email });
        if (existingUser) {
          return res.status(409).json({
            success: false,
            message: 'User already exists.',
          });
        }

        const result = await usersCollection.insertOne(newUser);
        res.status(201).json({
          success: true,
          message: 'User created successfully.',
          data: result,
        });
      } catch (error) {
        console.error('Create user error:', error?.message);
        res.status(500).json({
          success: false,
          message: 'Failed to create user.',
        });
      }
    });

    // ========== ROUTES END ==========

    // Send a ping to confirm a successful connection
    await client.db('admin').command({ ping: 1 });
    console.log(
      'Pinged your deployment. You successfully connected to MongoDB!'
    );
  } catch (error) {
    console.error('MongoDB connection error:', error);
    process.exit(1);
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}

// Run the server
run().catch(console.dir);

// ========== SERVER START ==========
app.listen(port, () => {
  console.log(`GarFlex server listening on port ${port}`);
});

// ========== GRACEFUL SHUTDOWN ==========
process.on('SIGINT', async () => {
  console.log('Shutting down gracefully...');
  await client.close();
  process.exit(0);
});
