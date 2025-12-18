require('dotenv').config();
const express = require('express');
const cors = require('cors');
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
    await client.connect();

    // Initialize Database & Collections
    database = client.db('GarFlexDB');
    usersCollection = database.collection('users');
    productsCollection = database.collection('products');
    ordersCollection = database.collection('orders');

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

    // Get recent 6 products (Public)
    app.get('/products/recent', async (req, res) => {
      try {
        const sortFields = { createdAt: -1 };
        const limitNum = 6;
        const projection = {
          name: 1,
          shortDescription: 1,
          category: 1,
          price: 1,
          availableQuantity: 1,
          minimumOrderQuantity: 1,
          images: 1,
        };
        const cursor = productsCollection
          .find()
          .sort(sortFields)
          .limit(limitNum)
          .project(projection);
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

    // Get specific product details (Protected)
    app.get('/products/:id', verifyFirebaseToken, async (req, res) => {
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
          const order = await ordersCollection.insertOne(orderData);
          res.status(201).json({
            success: true,
            data: order,
          });
        } catch (error) {
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
          const query = { orderStatus: 'Pending', userEmail: req.user.email };
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
          const query = { orderStatus: 'Approved', userEmail: req.user.email };
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
