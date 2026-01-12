require('dotenv').config();
const express = require('express');
const cors = require('cors');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
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
let productsCollection;
let ordersCollection;
let paymentsCollection;
let parcelsCollection;

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

    if (!authHeader.startsWith('Bearer ')) {
      return res.status(403).json({
        success: false,
        message: 'Unauthorized: Invalid auth scheme.',
      });
    }

    const token = authHeader.replace('Bearer ', '').trim();

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

// ========== MIDDLEWARE: VERIFY ADMIN ROLE ==========
const verifyAdmin = async (req, res, next) => {
  const email = req.user.email;
  const user = await usersCollection.findOne({ email });
  if (user.role !== 'Admin') {
    return res.status(403).json({
      success: false,
      message: 'Forbidden: Admin access required',
    });
  }
  next();
};

// ========== MIDDLEWARE: VERIFY MANAGER ROLE ==========
const verifyManager = async (req, res, next) => {
  const email = req.user.email;
  const user = await usersCollection.findOne({ email });
  if (user.role !== 'Manager') {
    return res.status(403).json({
      success: false,
      message: 'Forbidden: Manager access required',
    });
  }
  next();
};

// ========== MIDDLEWARE: VERIFY BUYER ROLE ==========
const verifyBuyer = async (req, res, next) => {
  const email = req.user.email;
  const user = await usersCollection.findOne({ email });
  if (user.role !== 'Buyer') {
    return res.status(403).json({
      success: false,
      message: 'Forbidden: Buyer access required',
    });
  }
  next();
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
    // await client.connect();

    // Initialize Database & Collections
    database = client.db('GarFlexDB');
    usersCollection = database.collection('users');
    productsCollection = database.collection('products');
    ordersCollection = database.collection('orders');
    paymentsCollection = database.collection('payments');
    parcelsCollection = database.collection('parcels');

    // ========== ROUTES START ==========

    // ---------- Users Collection APIs ----------
    // Create user via Email/password Auth (Protected)
    app.post('/users/register', verifyFirebaseToken, async (req, res) => {
      try {
        // User object
        const userData = req.body;
        // Insert user into database
        const user = await usersCollection.insertOne(userData);
        res.status(201).json({
          success: true,
          message: 'User registered successfully via Email/Password Auth.',
          data: user,
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

    // GET logged-in user from DB (Protected)
    app.get('/users/me', verifyFirebaseToken, async (req, res) => {
      try {
        const email = req.user.email;
        const user = await usersCollection.findOne({ email });

        res.status(200).json({
          success: true,
          data: user,
        });
      } catch (error) {
        res.status(500).json({
          success: false,
          message: 'Failed to fetch user',
          error:
            process.env.NODE_ENV === 'development' ? error?.message : undefined,
        });
      }
    });

    // Update user profile (Protected)
    app.patch('/users/profile', verifyFirebaseToken, async (req, res) => {
      try {
        const email = req.user.email;
        const { name, photoURL } = req.body;

        // Validation
        if (!name || name.trim().length < 3) {
          return res.status(400).json({
            success: false,
            message: 'Name must be at least 3 characters long',
          });
        }

        // Update user in database
        const result = await usersCollection.updateOne(
          { email },
          {
            $set: {
              name: name.trim(),
              photoURL: photoURL || '',
              updatedAt: new Date(),
            },
          }
        );

        if (result.matchedCount === 0) {
          return res.status(404).json({
            success: false,
            message: 'User not found',
          });
        }

        res.status(200).json({
          success: true,
          message: 'Profile updated successfully',
          data: result,
        });
      } catch (error) {
        console.error('Profile update error:', error?.message);
        res.status(500).json({
          success: false,
          message: 'Failed to update profile',
          error:
            process.env.NODE_ENV === 'development' ? error?.message : undefined,
        });
      }
    });

    // GET all users from DB (Admin Only - Protected)
    app.get(
      '/admin/manage-users',
      verifyFirebaseToken,
      verifyAdmin,
      async (req, res) => {
        try {
          const users = await usersCollection
            .find()
            .sort({ createdAt: -1 })
            .toArray();

          res.status(200).json({
            success: true,
            data: users,
            count: users.length,
          });
        } catch (error) {
          res.status(500).json({
            success: false,
            message: 'Failed to fetch users',
            error:
              process.env.NODE_ENV === 'development'
                ? error?.message
                : undefined,
          });
        }
      }
    );

    // Update user role & status (Admin Only - Protected)
    app.patch(
      '/admin/users/role/:id',
      verifyFirebaseToken,
      verifyAdmin,
      async (req, res) => {
        try {
          const { id } = req.params;
          const query = { _id: new ObjectId(id) };

          if (!ObjectId.isValid(id)) {
            return res.status(400).json({
              success: false,
              message: 'Invalid user ID format',
            });
          }

          const userData = req.body;
          const role = userData.role;
          const status = userData.status;
          const suspendReason = userData.suspendReason;

          const updateDoc = {
            $set: {
              updatedAt: new Date(),
            },
          };

          // Add role to update if provided
          if (role) {
            updateDoc.$set.role = role;
          }

          // Add status to update if provided
          if (status) {
            updateDoc.$set.status = status;
          }

          // Add suspend reason if suspending
          if (status === 'Suspended' && suspendReason) {
            updateDoc.$set.suspendReason = suspendReason;
          }

          // Remove suspend reason if approving or setting to pending
          if (status === 'Approved' || status === 'Pending') {
            updateDoc.$unset = { suspendReason: '' };
          }

          const result = await usersCollection.updateOne(query, updateDoc);

          if (result.matchedCount === 0) {
            return res.status(404).json({
              success: false,
              message: 'User not found',
            });
          }

          res.status(200).json({
            success: true,
            message: 'User updated successfully',
            data: result,
          });
        } catch (error) {
          res.status(500).json({
            success: false,
            message: 'Failed to update user',
            error:
              process.env.NODE_ENV === 'development'
                ? error?.message
                : undefined,
          });
        }
      }
    );

    // Delete user from DB (Admin Only - Protected)
    app.delete(
      '/admin/users/:id',
      verifyFirebaseToken,
      verifyAdmin,
      async (req, res) => {
        try {
          const { id } = req.params;
          const query = { _id: new ObjectId(id) };

          // Validate ObjectId
          if (!ObjectId.isValid(id)) {
            return res.status(400).json({
              success: false,
              message: 'Invalid user ID format',
            });
          }

          // Prevent admin from deleting themselves
          if (req.user.email) {
            const userToDelete = await usersCollection.findOne(query);

            if (userToDelete?.email === req.user.email) {
              return res.status(403).json({
                success: false,
                message: 'You cannot delete your own account',
              });
            }
          }

          const result = await usersCollection.deleteOne(query);

          if (result.deletedCount === 0) {
            return res.status(404).json({
              success: false,
              message: 'User not found',
            });
          }

          res.status(200).json({
            success: true,
            message: 'User deleted successfully',
            data: result,
          });
        } catch (error) {
          res.status(500).json({
            success: false,
            message: 'Failed to delete user',
            error:
              process.env.NODE_ENV === 'development'
                ? error?.message
                : undefined,
          });
        }
      }
    );

    // ---------- Products Collection APIs ----------
    // Get all products & specific user's products by email using query params (Public)
    app.get('/products', async (req, res) => {
      try {
        const email = req.query.email;
        const query = {};
        if (email) {
          query.createdBy = email;
        }
        const cursor = productsCollection.find(query);
        const products = await cursor.toArray();
        res.status(200).json(products);
      } catch (error) {
        res.status(500).json({
          success: false,
          message: 'Failed to fetch products',
          error:
            process.env.NODE_ENV === 'development' ? error?.message : undefined,
        });
      }
    });

    // Get recent 6 products with priority for showOnHomePage (Public)
    app.get('/products/recent', async (req, res) => {
      try {
        const limitNum = 8;

        const pipeline = [
          {
            $addFields: {
              homePriority: {
                $cond: {
                  if: { $eq: ['$showOnHomePage', true] },
                  then: 1,
                  else: 0,
                },
              },
            },
          },
          {
            $sort: {
              homePriority: -1,
              createdAt: -1,
            },
          },
          {
            $limit: limitNum,
          },
          {
            $project: {
              name: 1,
              shortDescription: 1,
              category: 1,
              price: 1,
              availableQuantity: 1,
              minimumOrderQuantity: 1,
              images: 1,
              showOnHomePage: 1,
              createdAt: 1,
            },
          },
        ];

        const products = await productsCollection.aggregate(pipeline).toArray();

        res.status(200).json(products);
      } catch (error) {
        res.status(500).json({
          success: false,
          message: 'Failed to fetch products',
          error:
            process.env.NODE_ENV === 'development' ? error?.message : undefined,
        });
      }
    });

    // Get specific product details (Protected)
    app.get('/products/:id', async (req, res) => {
      try {
        const id = req.params.id;
        const query = { _id: new ObjectId(id) };
        const product = await productsCollection.findOne(query);
        res.status(200).json(product);
      } catch (error) {
        res.status(500).json({
          success: false,
          message: 'Failed to fetch product',
          error:
            process.env.NODE_ENV === 'development' ? error?.message : undefined,
        });
      }
    });

    // GET All Products (Admin Only - Protected)
    app.get(
      '/admin/all-products',
      verifyFirebaseToken,
      verifyAdmin,
      async (req, res) => {
        try {
          const result = await productsCollection.find().toArray();
          res.status(200).json({
            success: true,
            data: result,
          });
        } catch (error) {
          res.status(500).json({
            success: false,
            message: 'Failed to fetch products',
            error:
              process.env.NODE_ENV === 'development'
                ? error?.message
                : undefined,
          });
        }
      }
    );

    // PATCH Update Product (Admin Only - Protected)
    app.patch(
      '/admin/products/:id',
      verifyFirebaseToken,
      verifyAdmin,
      async (req, res) => {
        const id = req.params.id;
        const query = { _id: new ObjectId(id) };
        const updatedProduct = req.body;
        const updatedDoc = {
          $set: updatedProduct,
        };
        try {
          const result = await productsCollection.updateOne(query, updatedDoc);
          res.status(200).json({
            success: true,
            data: result,
          });
        } catch (error) {
          res.status(500).json({
            success: false,
            message: 'Failed to update products',
            error:
              process.env.NODE_ENV === 'development'
                ? error?.message
                : undefined,
          });
        }
      }
    );

    // DELETE Product (Admin Only - Protected)
    app.delete(
      '/admin/products/:id',
      verifyFirebaseToken,
      verifyAdmin,
      async (req, res) => {
        const id = req.params.id;
        const query = { _id: new ObjectId(id) };
        try {
          const result = await productsCollection.deleteOne(query);
          res.status(200).json({
            success: true,
            data: result,
          });
        } catch (error) {
          res.status(500).json({
            success: false,
            message: 'Failed to delete product',
            error:
              process.env.NODE_ENV === 'development'
                ? error?.message
                : undefined,
          });
        }
      }
    );

    // Add Product (Manager Only - Protected)
    app.post(
      '/manager/products',
      verifyFirebaseToken,
      verifyManager,
      async (req, res) => {
        try {
          const {
            name,
            shortDescription,
            longDescription,
            category,
            price,
            availableQuantity,
            minimumOrderQuantity,
            images,
            demoVideo,
            paymentOptions,
            showOnHomePage,
          } = req.body;

          // Validation
          if (
            !name ||
            !shortDescription ||
            !longDescription ||
            !category ||
            !price ||
            !availableQuantity ||
            !minimumOrderQuantity ||
            !images ||
            !Array.isArray(images) ||
            images.length === 0 ||
            !paymentOptions ||
            !Array.isArray(paymentOptions) ||
            paymentOptions.length === 0
          ) {
            return res.status(400).json({
              success: false,
              message: 'Missing required fields or invalid data format',
            });
          }

          // Create product object
          const newProduct = {
            name: name.trim(),
            shortDescription: shortDescription.trim(),
            longDescription: longDescription.trim(),
            category: category.trim(),
            price: parseFloat(price),
            availableQuantity: parseInt(availableQuantity),
            minimumOrderQuantity: parseInt(minimumOrderQuantity),
            images: images,
            demoVideo: demoVideo?.trim() || '',
            paymentOptions: paymentOptions,
            showOnHomePage: showOnHomePage || false,
            createdBy: req.user.email,
            createdAt: new Date(),
            updatedAt: new Date(),
          };

          // Insert into database
          const result = await productsCollection.insertOne(newProduct);

          res.status(201).json({
            success: true,
            message: 'Product created successfully!',
            data: {
              productId: result.insertedId,
            },
          });
        } catch (error) {
          res.status(500).json({
            success: false,
            message: 'Failed to create product',
            error:
              process.env.NODE_ENV === 'development'
                ? error.message
                : undefined,
          });
        }
      }
    );

    // GET Managers Product (Manager Only - Protected)
    app.get(
      '/manager/my-products',
      verifyFirebaseToken,
      verifyManager,
      async (req, res) => {
        try {
          const email = req.user.email;
          const query = { createdBy: email };

          const products = await productsCollection
            .find(query)
            .sort({ createdAt: -1 })
            .toArray();

          res.json({
            success: true,
            data: products,
          });
        } catch (error) {
          res.status(500).json({
            success: false,
            message: 'Failed to fetch products',
            error:
              process.env.NODE_ENV === 'development'
                ? error.message
                : undefined,
          });
        }
      }
    );

    // DELETE Managers Product (Manager Only - Protected)
    app.delete(
      '/manager/products/:id',
      verifyFirebaseToken,
      verifyManager,
      async (req, res) => {
        try {
          const id = req.params.id;
          const email = req.user.email;

          const query = { _id: new ObjectId(id), createdBy: email };
          const result = await productsCollection.deleteOne(query);

          if (result.deletedCount === 1) {
            res.json({ success: true, message: 'Product deleted' });
          } else {
            res.status(404).json({
              success: false,
              message: 'Product not found or unauthorized',
            });
          }
        } catch (error) {
          res.status(500).json({
            success: false,
            message: 'Failed to delete product',
            error:
              process.env.NODE_ENV === 'development'
                ? error.message
                : undefined,
          });
        }
      }
    );

    // UPDATE Managers Product (Manager Only - Protected)
    app.patch(
      '/manager/products/:id',
      verifyFirebaseToken,
      verifyManager,
      async (req, res) => {
        try {
          const id = req.params.id;
          const email = req.user.email;
          const updatedData = req.body;

          const query = { _id: new ObjectId(id), createdBy: email };

          const updateDoc = {
            $set: updatedData,
          };

          const result = await productsCollection.updateOne(query, updateDoc);

          if (result.matchedCount === 1) {
            res.json({
              success: true,
              message: 'Product updated successfully',
              data: result,
            });
          } else {
            res.status(404).json({
              success: false,
              message: 'Product not found or unauthorized to update',
            });
          }
        } catch (error) {
          res.status(500).json({
            success: false,
            message: 'Failed to update product',
            error:
              process.env.NODE_ENV === 'development'
                ? error.message
                : undefined,
          });
        }
      }
    );

    // ---------- Orders Collection APIs ----------
    // Create new order (Buyer Only - Protected)
    app.post(
      '/buyer/orders',
      verifyFirebaseToken,
      verifyBuyer,
      async (req, res) => {
        try {
          const orderData = req.body;
          const idempotencyKey = req.headers['idempotency-key'];

          console.log('=== CREATING ORDER ===');
          console.log('Order data:', orderData);
          console.log('Idempotency key:', idempotencyKey);

          // For Stripe payments, check if order already exists by payment details
          if (
            orderData.paymentMethod === 'PayFirst' &&
            orderData.paymentDetails?.transactionId
          ) {
            const existingOrder = await ordersCollection.findOne({
              'paymentDetails.transactionId':
                orderData.paymentDetails.transactionId,
            });

            if (existingOrder) {
              console.log('Order already exists for this payment');
              return res.status(200).json({
                success: true,
                data: existingOrder,
                message: 'Order already exists for this payment',
              });
            }
          }

          // For idempotency key (if provided)
          if (idempotencyKey) {
            const existingOrder = await ordersCollection.findOne({
              idempotencyKey: idempotencyKey,
            });

            if (existingOrder) {
              console.log('Order already exists for this idempotency key');
              return res.status(200).json({
                success: true,
                data: existingOrder,
                message: 'Order already processed',
              });
            }

            // Add idempotency key to order data
            orderData.idempotencyKey = idempotencyKey;
          }

          // Add creation timestamp
          orderData.createdAt = new Date();

          const order = await ordersCollection.insertOne(orderData);
          console.log('Order created successfully:', order.insertedId);

          res.status(201).json({
            success: true,
            data: { ...orderData, _id: order.insertedId },
          });
        } catch (error) {
          console.error('Order creation error:', error);
          res.status(500).json({
            success: false,
            message: 'Failed to create order',
            error:
              process.env.NODE_ENV === 'development'
                ? error?.message
                : undefined,
          });
        }
      }
    );

    // GET All Orders (Admin Only - Protected)
    app.get(
      '/admin/all-orders',
      verifyFirebaseToken,
      verifyAdmin,
      async (req, res) => {
        try {
          const result = await ordersCollection
            .find()
            .sort({ createdAt: -1 })
            .toArray();

          res.status(200).json({
            success: true,
            data: result,
          });
        } catch (error) {
          res.status(500).json({
            success: false,
            message: 'Failed to fetch orders',
            error:
              process.env.NODE_ENV === 'development'
                ? error?.message
                : undefined,
          });
        }
      }
    );

    // PATCH Update Order Status (Admin Only - Protected)
    app.patch(
      '/admin/orders/:id/status',
      verifyFirebaseToken,
      verifyAdmin,
      async (req, res) => {
        const id = req.params.id;
        const { orderStatus } = req.body;
        const query = { _id: new ObjectId(id) };

        const updatedDoc = {
          $set: {
            orderStatus: orderStatus,
            updatedAt: new Date(),
          },
        };

        try {
          const result = await ordersCollection.updateOne(query, updatedDoc);

          if (result.matchedCount === 0) {
            return res.status(404).json({
              success: false,
              message: 'Order not found',
            });
          }

          res.status(200).json({
            success: true,
            message: `Order status updated to ${orderStatus}`,
            data: result,
          });
        } catch (error) {
          res.status(500).json({
            success: false,
            message: 'Failed to update order status',
            error:
              process.env.NODE_ENV === 'development'
                ? error?.message
                : undefined,
          });
        }
      }
    );

    // GET Single Order Details (Admin Only - Protected)
    app.get(
      '/admin/orders/:id',
      verifyFirebaseToken,
      verifyAdmin,
      async (req, res) => {
        const id = req.params.id;
        try {
          const query = { _id: new ObjectId(id) };
          const result = await ordersCollection.findOne(query);

          if (!result) {
            return res.status(404).json({
              success: false,
              message: 'Order not found',
            });
          }

          res.status(200).json({
            success: true,
            data: result,
          });
        } catch (error) {
          res.status(500).json({
            success: false,
            message: 'Failed to fetch order details',
            error:
              process.env.NODE_ENV === 'development'
                ? error?.message
                : undefined,
          });
        }
      }
    );

    // GET Pending Orders (Manager Only - Protected)
    app.get(
      '/manager/pending-orders',
      verifyFirebaseToken,
      verifyManager,
      async (req, res) => {
        try {
          const query = { orderStatus: 'Pending' };
          const orders = await ordersCollection
            .find(query)
            .sort({ orderDate: -1 })
            .toArray();

          res.status(200).json({
            success: true,
            data: orders,
          });
        } catch (error) {
          res.status(500).json({
            success: false,
            message: 'Failed to fetch pending orders',
            error:
              process.env.NODE_ENV === 'development'
                ? error?.message
                : undefined,
          });
        }
      }
    );

    // UPDATE Order Status (Manager Only - Protected)
    app.patch(
      '/manager/orders/:id/status',
      verifyFirebaseToken,
      verifyManager,
      async (req, res) => {
        try {
          const id = req.params.id;
          const { orderStatus } = req.body;

          const query = { _id: new ObjectId(id) };

          const updateFields = {
            orderStatus: orderStatus,
            processedAt: new Date(),
          };

          if (orderStatus === 'Approved') {
            updateFields.approvedAt = new Date();
          } else if (orderStatus === 'Rejected') {
            updateFields.rejectedAt = new Date();
          }

          const updateDoc = { $set: updateFields };

          const result = await ordersCollection.updateOne(query, updateDoc);

          res.status(200).json({
            success: true,
            message: `Order ${orderStatus} successfully`,
            data: result,
          });
        } catch (error) {
          res.status(500).json({
            success: false,
            message: 'Failed to update order status',
            error:
              process.env.NODE_ENV === 'development'
                ? error?.message
                : undefined,
          });
        }
      }
    );

    // GET Approved Orders (Manager Only - Protected)
    app.get(
      '/manager/approved-orders',
      verifyFirebaseToken,
      verifyManager,
      async (req, res) => {
        try {
          const query = { orderStatus: 'Approved' };
          const orders = await ordersCollection
            .find(query)
            .sort({ approvedAt: -1 })
            .toArray();
          res.status(200).json({
            success: true,
            data: orders,
          });
        } catch (error) {
          res.status(500).json({
            success: false,
            message: 'Failed to fetch approved orders',
            error:
              process.env.NODE_ENV === 'development'
                ? error?.message
                : undefined,
          });
        }
      }
    );

    // UPDATE Tracking Info (Manager Only - Protected)
    app.patch(
      '/manager/orders/:id/tracking',
      verifyFirebaseToken,
      verifyManager,
      async (req, res) => {
        try {
          const id = req.params.id;
          const newTracking = {
            ...req.body,
            updatedAt: new Date(),
          };

          const query = { _id: new ObjectId(id) };
          const updateDoc = {
            $push: { trackingHistory: newTracking },
            $set: {
              currentStatus: req.body.status,
              lastTrackingUpdate: new Date(),
            },
          };

          const result = await ordersCollection.updateOne(query, updateDoc);
          res.status(200).json({
            success: true,
            message: 'Tracking updated!',
            data: result,
          });
        } catch (error) {
          res.status(500).json({
            success: false,
            message: 'Failed to update tracking info',
            error:
              process.env.NODE_ENV === 'development'
                ? error?.message
                : undefined,
          });
        }
      }
    );

    // GET My Orders (Buyer Only - Protected)
    app.get(
      '/buyer/my-orders',
      verifyFirebaseToken,
      verifyBuyer,
      async (req, res) => {
        try {
          const email = req.user.email;
          const query = { userEmail: email };
          const orders = await ordersCollection
            .find(query)
            .sort({ createdAt: -1 })
            .toArray();

          res.status(200).json({
            success: true,
            data: orders,
          });
        } catch (error) {
          res.status(500).json({
            success: false,
            message: 'Failed to update tracking info',
            error:
              process.env.NODE_ENV === 'development'
                ? error?.message
                : undefined,
          });
        }
      }
    );

    // CANCEL Order (Buyer Only - Protected)
    app.delete(
      '/buyer/orders/:id',
      verifyFirebaseToken,
      verifyBuyer,
      async (req, res) => {
        try {
          const id = req.params.id;
          const email = req.user.email;

          const query = {
            _id: new ObjectId(id),
            userEmail: email,
            orderStatus: 'Pending',
          };

          const result = await ordersCollection.deleteOne(query);

          if (result.deletedCount === 0) {
            return res.status(400).json({
              success: false,
              message:
                'Cannot cancel. Order is already processed or not found.',
            });
          }

          res.status(200).json({
            success: true,
            message: 'Order cancelled successfully!',
            data: result,
          });
        } catch (error) {
          res.status(500).json({
            success: false,
            message: 'Failed to update tracking info',
            error:
              process.env.NODE_ENV === 'development'
                ? error?.message
                : undefined,
          });
        }
      }
    );

    // GET Specific Order Tracking (Buyer Only - Protected)
    app.get(
      '/buyer/track-order/:id',
      verifyFirebaseToken,
      verifyBuyer,
      async (req, res) => {
        try {
          const id = req.params.id;
          const email = req.user.email;

          const query = { _id: new ObjectId(id), userEmail: email };
          const order = await ordersCollection.findOne(query);

          if (!order) {
            return res.status(404).json({
              success: false,
              message: 'Order not found',
            });
          }

          res.status(200).json({
            success: true,
            data: order,
          });
        } catch (error) {
          res.status(500).json({
            success: false,
            message: 'Failed to update tracking info',
            error:
              process.env.NODE_ENV === 'development'
                ? error?.message
                : undefined,
          });
        }
      }
    );

    // ---------- Payments Collection APIs ----------
    // Payment Session Create (Buyer Only - Protected)
    app.post(
      '/create-checkout-session',
      verifyFirebaseToken,
      verifyBuyer,
      async (req, res) => {
        try {
          console.log('=== CREATE CHECKOUT SESSION ===');
          console.log('Request body:', req.body);
          console.log('User email:', req.decoded_email);

          // Validate required environment variables
          if (!process.env.STRIPE_SECRET_KEY) {
            console.error('STRIPE_SECRET_KEY is not configured');
            return res.status(500).json({
              success: false,
              message: 'Payment service not configured',
            });
          }

          if (!process.env.CLIENT_URL) {
            console.error('CLIENT_URL is not configured');
            return res.status(500).json({
              success: false,
              message: 'Client URL not configured',
            });
          }

          // Validate required request data
          const { cost, parcelId, customerEmail, productName, orderMetadata } =
            req.body;

          if (!cost || !parcelId || !customerEmail || !orderMetadata) {
            console.error('Missing required fields:', {
              cost: !!cost,
              parcelId: !!parcelId,
              customerEmail: !!customerEmail,
              orderMetadata: !!orderMetadata,
            });
            return res.status(400).json({
              success: false,
              message: 'Missing required payment information',
            });
          }

          // Validate cost is a valid number
          const numericCost = parseFloat(cost);
          if (isNaN(numericCost) || numericCost <= 0) {
            console.error('Invalid cost value:', cost);
            return res.status(400).json({
              success: false,
              message: 'Invalid cost amount',
            });
          }

          // Validate email format
          const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
          if (!emailRegex.test(customerEmail)) {
            console.error('Invalid email format:', customerEmail);
            return res.status(400).json({
              success: false,
              message: 'Invalid email format',
            });
          }

          // Validate orderMetadata is an object
          if (typeof orderMetadata !== 'object' || orderMetadata === null) {
            console.error('Invalid orderMetadata:', typeof orderMetadata);
            return res.status(400).json({
              success: false,
              message: 'Invalid order metadata',
            });
          }

          // Stripe expects amount in cents
          const amount = Math.round(numericCost * 100);
          console.log('Calculated amount in cents:', amount);

          // Create Stripe checkout session
          console.log('Creating Stripe session...');

          // Split order data into multiple metadata fields to respect Stripe's 500-char limit
          const metadata = {
            parcelId: parcelId,
            buyerEmail: customerEmail,
            // Essential order info (split into multiple fields)
            userId: orderMetadata.userId,
            userEmail: orderMetadata.userEmail,
            userName: orderMetadata.userName.substring(0, 100), // Truncate if too long
            productId: orderMetadata.productId,
            productTitle: orderMetadata.productTitle.substring(0, 100), // Truncate if too long
            productPrice: orderMetadata.productPrice.toString(),
            productCategory: orderMetadata.productCategory || 'General',
            orderQuantity: orderMetadata.orderQuantity.toString(),
            orderPrice: orderMetadata.orderPrice.toString(),
            contactNumber: orderMetadata.contactNumber,
            paymentMethod: orderMetadata.paymentMethod,
            orderDate: orderMetadata.orderDate,
          };

          // Store delivery address and notes separately (truncate if needed)
          if (orderMetadata.deliveryAddress) {
            metadata.deliveryAddress = orderMetadata.deliveryAddress.substring(
              0,
              400
            );
          }
          if (orderMetadata.additionalNotes) {
            metadata.additionalNotes = orderMetadata.additionalNotes.substring(
              0,
              400
            );
          }

          console.log(
            'Metadata character counts:',
            Object.entries(metadata).map(
              ([key, value]) => `${key}: ${value?.length || 0}`
            )
          );

          const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            line_items: [
              {
                price_data: {
                  currency: 'usd',
                  unit_amount: amount,
                  product_data: { name: productName || 'GarFlex Booking' },
                },
                quantity: 1,
              },
            ],
            customer_email: customerEmail,
            mode: 'payment',
            metadata: metadata,
            success_url: `${process.env.CLIENT_URL}/dashboard/payment-success?session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: `${process.env.CLIENT_URL}/dashboard/payment-cancelled`,
          });

          console.log('Stripe session created successfully:', session.id);
          res.json({
            success: true,
            url: session.url,
            sessionId: session.id,
          });
        } catch (error) {
          console.error('=== CHECKOUT SESSION ERROR ===');
          console.error('Error details:', error);
          console.error('Error message:', error.message);
          console.error('Error stack:', error.stack);

          // Handle specific Stripe errors
          if (error.type === 'StripeCardError') {
            return res.status(400).json({
              success: false,
              message: 'Card error: ' + error.message,
            });
          } else if (error.type === 'StripeInvalidRequestError') {
            return res.status(400).json({
              success: false,
              message: 'Invalid request: ' + error.message,
            });
          } else if (error.type === 'StripeAPIError') {
            return res.status(500).json({
              success: false,
              message: 'Stripe API error occurred',
            });
          } else if (error.type === 'StripeConnectionError') {
            return res.status(500).json({
              success: false,
              message: 'Network error occurred',
            });
          } else if (error.type === 'StripeAuthenticationError') {
            return res.status(500).json({
              success: false,
              message: 'Authentication error with payment service',
            });
          }

          // Generic error response
          res.status(500).json({
            success: false,
            message: 'Failed to create payment session',
            error:
              process.env.NODE_ENV === 'development'
                ? error.message
                : undefined,
          });
        }
      }
    );

    // Payment Verification & DB Update (Buyer Only - Protected)
    app.patch(
      '/payment-success',
      verifyFirebaseToken,
      verifyBuyer,
      async (req, res) => {
        const { session_id } = req.query;

        try {
          console.log('=== PAYMENT VERIFICATION ===');
          console.log('Session ID:', session_id);
          console.log('User email:', req.decoded_email);

          // Validate session_id
          if (!session_id) {
            console.error('No session_id provided');
            return res.status(400).json({
              success: false,
              message: 'Session ID is required',
            });
          }

          // Retrieve session from Stripe
          console.log('Retrieving Stripe session...');
          const session = await stripe.checkout.sessions.retrieve(session_id);
          console.log('Session payment status:', session.payment_status);
          console.log('Session metadata:', session.metadata);

          if (session.payment_status === 'paid') {
            const transactionId = session.payment_intent;
            const parcelId = session.metadata.parcelId;

            if (!parcelId) {
              console.error('No parcelId in session metadata');
              return res.status(400).json({
                success: false,
                message: 'Invalid session metadata',
              });
            }

            const trackingId = `#GF-${parcelId.slice(-16).toUpperCase()}`;
            console.log('Generated tracking ID:', trackingId);

            // Duplicate payment check
            console.log('Checking for duplicate payment...');
            const paymentExist = await paymentsCollection.findOne({
              transactionId,
            });

            if (paymentExist) {
              console.log(
                'Payment already exists, returning existing transaction'
              );

              // Also check if order exists
              const existingOrder = await ordersCollection.findOne({
                _id: new ObjectId(paymentExist.orderId),
              });

              return res.json({
                success: true,
                transactionId,
                orderId: paymentExist.orderId,
                trackingId: existingOrder?.trackingId,
                message: 'Payment already processed',
              });
            }

            // Additional check: Look for existing order with same payment intent
            const existingOrderByPayment = await ordersCollection.findOne({
              'paymentDetails.transactionId': transactionId,
            });

            if (existingOrderByPayment) {
              console.log('Order already exists for this payment intent');
              return res.json({
                success: true,
                transactionId,
                orderId: existingOrderByPayment._id.toString(),
                trackingId: existingOrderByPayment.trackingId,
                message: 'Order already exists for this payment',
              });
            }

            // Reconstruct order data from metadata fields
            let orderData;
            try {
              orderData = {
                userId: session.metadata.userId,
                userEmail: session.metadata.userEmail,
                userName: session.metadata.userName,
                productId: session.metadata.productId,
                productTitle: session.metadata.productTitle,
                productPrice: parseFloat(session.metadata.productPrice),
                productCategory: session.metadata.productCategory || 'General',
                orderQuantity: parseInt(session.metadata.orderQuantity),
                orderPrice: parseFloat(session.metadata.orderPrice),
                contactNumber: session.metadata.contactNumber,
                deliveryAddress: session.metadata.deliveryAddress || '',
                additionalNotes: session.metadata.additionalNotes || '',
                paymentMethod: session.metadata.paymentMethod,
                orderDate: session.metadata.orderDate,
              };
              console.log('Reconstructed order data:', orderData);
            } catch (parseError) {
              console.error(
                'Failed to reconstruct order data from metadata:',
                parseError
              );
              return res.status(400).json({
                success: false,
                message: 'Invalid order data in session metadata',
              });
            }

            // Validate required order data fields
            const requiredFields = [
              'userId',
              'userEmail',
              'userName',
              'productId',
              'productTitle',
              'productPrice',
              'orderQuantity',
              'orderPrice',
            ];
            const missingFields = requiredFields.filter(
              (field) => !orderData[field]
            );

            if (missingFields.length > 0) {
              console.error('Missing required order fields:', missingFields);
              return res.status(400).json({
                success: false,
                message: `Missing required order fields: ${missingFields.join(
                  ', '
                )}`,
              });
            }

            // 1. Create Order in Database
            console.log('Creating order in database...');
            const newOrder = {
              userId: orderData.userId,
              userEmail: orderData.userEmail,
              userName: orderData.userName,
              productId: orderData.productId,
              productTitle: orderData.productTitle,
              productPrice: orderData.productPrice,
              productCategory: orderData.productCategory || 'General',
              orderQuantity: orderData.orderQuantity,
              orderPrice: orderData.orderPrice,
              contactNumber: orderData.contactNumber,
              deliveryAddress: orderData.deliveryAddress,
              additionalNotes: orderData.additionalNotes || '',
              paymentMethod: orderData.paymentMethod,
              paymentStatus: 'Paid',
              orderStatus: 'Pending',
              trackingId: trackingId,
              orderDate: new Date(orderData.orderDate),
              paidAt: new Date(),
              createdAt: new Date(),
              // Add payment details for duplicate prevention
              paymentDetails: {
                transactionId: transactionId,
                sessionId: session_id,
                paymentIntentId: session.payment_intent,
              },
            };

            const orderResult = await ordersCollection.insertOne(newOrder);
            const orderId = orderResult.insertedId;
            console.log('Order created with ID:', orderId);

            // 2. Insert into Payments Collection
            console.log('Creating payment record...');
            const payment = {
              amount: session.amount_total / 100,
              customerEmail:
                session.customer_email || session.metadata.buyerEmail,
              orderId: orderId.toString(),
              productId: orderData.productId,
              transactionId: transactionId,
              paidAt: new Date(),
              status: 'completed',
            };

            await paymentsCollection.insertOne(payment);
            console.log('Payment record created');

            console.log('Payment verification completed successfully');
            res.json({
              success: true,
              transactionId,
              orderId: orderId.toString(),
              trackingId,
              message: 'Payment verified and order created successfully',
            });
          } else {
            console.log(
              'Payment not completed, status:',
              session.payment_status
            );
            res.status(400).json({
              success: false,
              message: 'Payment not completed',
              paymentStatus: session.payment_status,
            });
          }
        } catch (error) {
          console.error('=== PAYMENT VERIFICATION ERROR ===');
          console.error('Error details:', error);
          console.error('Error message:', error.message);
          console.error('Error stack:', error.stack);

          // Handle specific Stripe errors
          if (error.type === 'StripeInvalidRequestError') {
            return res.status(400).json({
              success: false,
              message: 'Invalid session ID or session not found',
            });
          } else if (error.type === 'StripeAPIError') {
            return res.status(500).json({
              success: false,
              message: 'Stripe API error occurred',
            });
          } else if (error.type === 'StripeConnectionError') {
            return res.status(500).json({
              success: false,
              message: 'Network error occurred',
            });
          }

          // Database errors
          if (
            error.name === 'MongoError' ||
            error.name === 'MongoServerError'
          ) {
            return res.status(500).json({
              success: false,
              message: 'Database error occurred',
            });
          }

          // Generic error response
          res.status(500).json({
            success: false,
            message: 'Payment verification failed',
            error:
              process.env.NODE_ENV === 'development'
                ? error.message
                : undefined,
          });
        }
      }
    );

    // User Specific Payment History (GET)
    app.get('/payments', verifyFirebaseToken, async (req, res) => {
      const email = req.query.email;
      if (email !== req.decoded_email)
        return res.status(403).send({ message: 'Forbidden' });

      const result = await paymentsCollection
        .find({ customerEmail: email })
        .sort({ paidAt: -1 })
        .toArray();
      res.send(result);
    });

    // ---------- Dashboard Stats APIs ----------
    // GET Admin Dashboard Stats (Admin Only - Protected)
    app.get(
      '/admin/dashboard-stats',
      verifyFirebaseToken,
      verifyAdmin,
      async (req, res) => {
        try {
          // Get counts
          const totalUsers = await usersCollection.countDocuments();
          const totalProducts = await productsCollection.countDocuments();
          const totalOrders = await ordersCollection.countDocuments();

          // Get users by role
          const adminCount = await usersCollection.countDocuments({
            role: 'Admin',
          });
          const managerCount = await usersCollection.countDocuments({
            role: 'Manager',
          });
          const buyerCount = await usersCollection.countDocuments({
            role: 'Buyer',
          });

          // Get orders by status
          const pendingOrders = await ordersCollection.countDocuments({
            orderStatus: 'Pending',
          });
          const approvedOrders = await ordersCollection.countDocuments({
            orderStatus: 'Approved',
          });
          const shippedOrders = await ordersCollection.countDocuments({
            orderStatus: 'Shipped',
          });
          const deliveredOrders = await ordersCollection.countDocuments({
            orderStatus: 'Delivered',
          });
          const rejectedOrders = await ordersCollection.countDocuments({
            orderStatus: 'Rejected',
          });

          // Calculate total revenue from delivered/paid orders
          const revenueResult = await ordersCollection
            .aggregate([
              { $match: { paymentStatus: 'Paid' } },
              { $group: { _id: null, total: { $sum: '$orderPrice' } } },
            ])
            .toArray();
          const totalRevenue = revenueResult[0]?.total || 0;

          // Get monthly order data for charts (last 6 months)
          const sixMonthsAgo = new Date();
          sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

          const monthlyOrders = await ordersCollection
            .aggregate([
              { $match: { orderDate: { $gte: sixMonthsAgo.toISOString() } } },
              {
                $group: {
                  _id: { $substr: ['$orderDate', 0, 7] },
                  orders: { $sum: 1 },
                  revenue: { $sum: '$orderPrice' },
                },
              },
              { $sort: { _id: 1 } },
            ])
            .toArray();

          // Get recent orders
          const recentOrders = await ordersCollection
            .find()
            .sort({ orderDate: -1 })
            .limit(5)
            .toArray();

          // Get products by category
          const productsByCategory = await productsCollection
            .aggregate([
              { $group: { _id: '$category', count: { $sum: 1 } } },
              { $sort: { count: -1 } },
            ])
            .toArray();

          res.status(200).json({
            success: true,
            data: {
              overview: {
                totalUsers,
                totalProducts,
                totalOrders,
                totalRevenue,
              },
              usersByRole: {
                admin: adminCount,
                manager: managerCount,
                buyer: buyerCount,
              },
              ordersByStatus: {
                pending: pendingOrders,
                approved: approvedOrders,
                shipped: shippedOrders,
                delivered: deliveredOrders,
                rejected: rejectedOrders,
              },
              monthlyOrders,
              recentOrders,
              productsByCategory,
            },
          });
        } catch (error) {
          res.status(500).json({
            success: false,
            message: 'Failed to fetch dashboard stats',
            error:
              process.env.NODE_ENV === 'development'
                ? error?.message
                : undefined,
          });
        }
      }
    );

    // GET Manager Dashboard Stats (Manager Only - Protected)
    app.get(
      '/manager/dashboard-stats',
      verifyFirebaseToken,
      verifyManager,
      async (req, res) => {
        try {
          const email = req.user.email;

          // Get manager's products count
          const myProducts = await productsCollection.countDocuments({
            createdBy: email,
          });

          // Get orders related to manager's products
          const managerProducts = await productsCollection
            .find({ createdBy: email })
            .toArray();
          const productIds = managerProducts.map((p) => p._id.toString());

          // Get pending orders count
          const pendingOrders = await ordersCollection.countDocuments({
            orderStatus: 'Pending',
          });
          const approvedOrders = await ordersCollection.countDocuments({
            orderStatus: 'Approved',
          });
          const shippedOrders = await ordersCollection.countDocuments({
            orderStatus: 'Shipped',
          });
          const deliveredOrders = await ordersCollection.countDocuments({
            orderStatus: 'Delivered',
          });

          // Get monthly order data for charts (last 6 months)
          const sixMonthsAgo = new Date();
          sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

          const monthlyOrders = await ordersCollection
            .aggregate([
              { $match: { orderDate: { $gte: sixMonthsAgo.toISOString() } } },
              {
                $group: {
                  _id: { $substr: ['$orderDate', 0, 7] },
                  orders: { $sum: 1 },
                  revenue: { $sum: '$orderPrice' },
                },
              },
              { $sort: { _id: 1 } },
            ])
            .toArray();

          // Get recent pending orders
          const recentPendingOrders = await ordersCollection
            .find({ orderStatus: 'Pending' })
            .sort({ orderDate: -1 })
            .limit(5)
            .toArray();

          // Get products by category for this manager
          const productsByCategory = await productsCollection
            .aggregate([
              { $match: { createdBy: email } },
              { $group: { _id: '$category', count: { $sum: 1 } } },
              { $sort: { count: -1 } },
            ])
            .toArray();

          res.status(200).json({
            success: true,
            data: {
              overview: {
                myProducts,
                pendingOrders,
                approvedOrders,
                shippedOrders,
                deliveredOrders,
              },
              ordersByStatus: {
                pending: pendingOrders,
                approved: approvedOrders,
                shipped: shippedOrders,
                delivered: deliveredOrders,
              },
              monthlyOrders,
              recentPendingOrders,
              productsByCategory,
            },
          });
        } catch (error) {
          res.status(500).json({
            success: false,
            message: 'Failed to fetch dashboard stats',
            error:
              process.env.NODE_ENV === 'development'
                ? error?.message
                : undefined,
          });
        }
      }
    );

    // GET Buyer Dashboard Stats (Buyer Only - Protected)
    app.get(
      '/buyer/dashboard-stats',
      verifyFirebaseToken,
      verifyBuyer,
      async (req, res) => {
        try {
          const email = req.user.email;

          // Get buyer's orders
          const myOrders = await ordersCollection.countDocuments({
            userEmail: email,
          });
          const pendingOrders = await ordersCollection.countDocuments({
            userEmail: email,
            orderStatus: 'Pending',
          });
          const approvedOrders = await ordersCollection.countDocuments({
            userEmail: email,
            orderStatus: 'Approved',
          });
          const shippedOrders = await ordersCollection.countDocuments({
            userEmail: email,
            orderStatus: 'Shipped',
          });
          const deliveredOrders = await ordersCollection.countDocuments({
            userEmail: email,
            orderStatus: 'Delivered',
          });

          // Calculate total spent
          const spentResult = await ordersCollection
            .aggregate([
              { $match: { userEmail: email, paymentStatus: 'Paid' } },
              { $group: { _id: null, total: { $sum: '$orderPrice' } } },
            ])
            .toArray();
          const totalSpent = spentResult[0]?.total || 0;

          // Get monthly order data for charts (last 6 months)
          const sixMonthsAgo = new Date();
          sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

          const monthlyOrders = await ordersCollection
            .aggregate([
              {
                $match: {
                  userEmail: email,
                  orderDate: { $gte: sixMonthsAgo.toISOString() },
                },
              },
              {
                $group: {
                  _id: { $substr: ['$orderDate', 0, 7] },
                  orders: { $sum: 1 },
                  spent: { $sum: '$orderPrice' },
                },
              },
              { $sort: { _id: 1 } },
            ])
            .toArray();

          // Get recent orders
          const recentOrders = await ordersCollection
            .find({ userEmail: email })
            .sort({ orderDate: -1 })
            .limit(5)
            .toArray();

          // Get orders by category
          const ordersByCategory = await ordersCollection
            .aggregate([
              { $match: { userEmail: email } },
              {
                $group: {
                  _id: '$productCategory',
                  count: { $sum: 1 },
                  spent: { $sum: '$orderPrice' },
                },
              },
              { $sort: { count: -1 } },
            ])
            .toArray();

          res.status(200).json({
            success: true,
            data: {
              overview: {
                myOrders,
                totalSpent,
                pendingOrders,
                deliveredOrders,
              },
              ordersByStatus: {
                pending: pendingOrders,
                approved: approvedOrders,
                shipped: shippedOrders,
                delivered: deliveredOrders,
              },
              monthlyOrders,
              recentOrders,
              ordersByCategory,
            },
          });
        } catch (error) {
          res.status(500).json({
            success: false,
            message: 'Failed to fetch dashboard stats',
            error:
              process.env.NODE_ENV === 'development'
                ? error?.message
                : undefined,
          });
        }
      }
    );

    // ========== ROUTES END ==========

    // Send a ping to confirm a successful connection
    // await client.db('admin').command({ ping: 1 });
    // console.log(
    //   'Pinged your deployment. You successfully connected to MongoDB!'
    // );
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
