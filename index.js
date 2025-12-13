require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { MongoClient, ServerApiVersion } = require('mongodb');
const admin = require('firebase-admin');

// Express App Initialization
const app = express();
const port = process.env.PORT || 3000;

// ========== MIDDLEWARE ==========
app.use(cors());
app.use(express.json());

// ========== FIREBASE ADMIN INITIALIZATION ==========
// Initialize Firebase Admin SDK
const decoded = Buffer.from(
  process.env.FIREBASE_SERVICE_KEY,
  'base64'
).toString('utf8');
const serviceAccount = JSON.parse(decoded);
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});
console.log('Firebase Admin initialized successfully!');

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

// ========== MIDDLEWARE: VERIFY FIREBASE TOKEN ==========
const verifyFirebaseToken = async (req, res, next) => {
  try {
    // Get token from Authorization header
    const authHeader = req.headers.authorization;
    // console.log(authHeader);

    if (!authHeader) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized: No token provided.',
      });
    }

    if (!authHeader.startsWith('Bearer')) {
      return res.status(403).json({
        success: false,
        message: 'Unauthorized: Invalid auth scheme.',
      });
    }

    const token = authHeader.replace('Bearer', '').trim();

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized: Token is empty.',
      });
    }

    // Verify token with Firebase Admin
    const decodedToken = await admin.auth().verifyIdToken(token);

    req.user = decodedToken;

    next();
  } catch (error) {
    console.error('Token verification error:', error?.message);

    if (error?.code === 'auth/id-token-expired') {
      return res.status(401).json({
        success: false,
        message: 'Token expired.',
      });
    }

    if (error?.code === 'auth/argument-error') {
      return res.status(401).json({
        success: false,
        message: 'Invalid token format.',
      });
    }

    return res.status(401).json({
      success: false,
      message: 'Unauthorized: Invalid token.',
      error:
        process.env.NODE_ENV === 'development' ? error?.message : undefined,
    });
  }
};

// ========== HEALTH CHECK ==========
// Health Check Route (Public)
app.get('/', (req, res) => {
  res.status(200).json({
    success: true,
    status: 'OK',
    service: 'GarFlex API',
    message: 'GarFlex Server is Running!',
    uptime: process.uptime(),
    timestamp: new Date(),
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
    // Create user via Email/password Auth (Protected)
    app.post('/users/register', verifyFirebaseToken, async (req, res) => {
      try {
        // User object
        const userData = req.body;
        // Insert user into database
        const result = await usersCollection.insertOne(userData);
        res.status(201).json({
          success: true,
          message: 'User registered successfully via Email/Password Auth.',
          data: result,
        });
      } catch (error) {
        console.error('User registration error:', error?.message);
        res.status(500).json({
          success: false,
          message: 'Failed to register user. Please try again later.',
          error:
            process.env.NODE_ENV === 'development' ? error?.message : undefined,
        });
      }
    });

    // Update user when login via Email/Password Auth (Protected)
    app.patch('/users/login', verifyFirebaseToken, async (req, res) => {
      try {
        const userData = req.user;
        const email = userData.email;

        // Update user
        await usersCollection.updateOne(
          { email },
          {
            $set: {
              updatedAt: new Date(),
              lastLoginAt: new Date(),
            },
          }
        );
        res.status(200).json({
          success: true,
          message: 'Login information synced successfully.',
        });
      } catch (error) {
        console.error('Failed to update user:', error?.message);
        res.status(500).json({
          success: false,
          message: 'Failed to update user. Please try again later.',
          error:
            process.env.NODE_ENV === 'development' ? error?.message : undefined,
        });
      }
    });

    // Create or Login user via Google OAuth (Protected)
    app.post('/users/google', verifyFirebaseToken, async (req, res) => {
      try {
        const user = req.user;

        // User object
        const userData = req.body;

        // Check if user already exists
        const email = user.email;
        const existingUser = await usersCollection.findOne({ email });
        if (existingUser) {
          // Update user
          await usersCollection.updateOne(
            { email },
            {
              $set: {
                name: userData.name,
                photoURL: userData.photoURL || existingUser.photoURL,
                updatedAt: new Date(),
                lastLoginAt: new Date(),
              },
            }
          );
          return res.status(200).json({
            success: true,
            message: 'User logged in successfully via Google OAuth.',
          });
        }

        // Insert user into database
        const result = await usersCollection.insertOne(userData);
        res.status(201).json({
          success: true,
          message: 'User registered successfully via Google OAuth.',
          data: result,
        });
      } catch (error) {
        console.error('User registration error:', error?.message);
        res.status(500).json({
          success: false,
          message: 'Failed to register user. Please try again later.',
          error:
            process.env.NODE_ENV === 'development' ? error?.message : undefined,
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
