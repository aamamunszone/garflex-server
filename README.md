<div align="center">

# 📦 GarFlex Server

### Backend API for Garments Manufacturing & Order Management Platform

🌐 [Live API](https://garflex-server.vercel.app) | 🐛 [Report Bug](https://github.com/aamamunszone/garflex-server/issues) | ✨ [Request Feature](https://github.com/aamamunszone/garflex-server/issues)

</div>

---

## 📋 Table of Contents

- [🎯 About The Project](#-about-the-project)
- [✨ Core Features](#-core-features)
- [🛠 Tech Stack](#-tech-stack)
- [🚀 Getting Started](#-getting-started)
- [🔗 API Endpoints](#-api-endpoints)
- [📂 Project Structure](#-project-structure)
- [🔐 Security & Middleware](#-security--middleware)
- [🌐 Deployment](#-deployment)
- [👨‍💻 Developer](#-developer)

---

## 🎯 About The Project

**GarFlex Server** is the robust backend REST API for the GarFlex platform. It manages a multi-role ecosystem (Admin, Manager, and Buyer) to handle garments manufacturing, order processing, tracking, and secure financial transactions. Built with **Node.js**, **Express.js**, and **MongoDB**, it ensures seamless data flow between the client and the database.

### Purpose

- Securely handle garment orders and manufacturing management
- Provide role-based access control for different user types
- Integrate **Stripe** for secure online payments
- Real-time order tracking with location-based updates
- Maintain a reliable history of transactions and order statuses

---

## ✨ Core Features

### 🧩 API Functionality

✅ **RESTful Architecture** – Standardized and scalable endpoint structure  
✅ **Multi-Role RBAC** – Specialized access for Admin, Manager, and Buyer  
✅ **Payment Integration** – Secure Stripe Checkout for order payments  
✅ **Order Lifecycle** – Track orders from "Pending" to "Delivered"  
✅ **Dynamic Filtering** – Search and filter data by email, role, or status  
✅ **Real-time Tracking** – Location-based order tracking with history  
✅ **Product Management** – CRUD operations for garment products

### 🔐 Security & Performance

✅ **Firebase Auth** – Server-side token verification for all private routes  
✅ **JWT Authorization** – Secure Bearer token validation  
✅ **CORS Protection** – Configured for secure cross-origin resource sharing  
✅ **Database Integrity** – Handled with MongoDB native drivers and strict error checking  
✅ **Role-based Middleware** – Separate verification for Admin, Manager, and Buyer

---

## 🛠 Tech Stack

### Core Technologies

- **Node.js** – JavaScript runtime for scalable backend logic
- **Express.js 5** – Minimalist web framework for routing
- **MongoDB 7** – High-performance NoSQL database

### Additional Tools

- **Stripe** – Payment gateway infrastructure
- **Firebase Admin SDK** – Secure user authentication & verification
- **Dotenv** – Environment variable management
- **Cors** – Cross-Origin security management

---

## 🚀 Getting Started

### 🔧 Prerequisites

```bash
node >= 18.0.0
npm >= 9.0.0
mongodb >= 6.0.0
```

### 🪄 Installation

**1. Clone the repository**

```bash
git clone https://github.com/aamamunszone/garflex-server.git
cd garflex-server
```

**2. Install dependencies**

```bash
npm install
```

**3. Setup environment variables**

Create a `.env` file in the project root:

```env
# MongoDB
MONGODB_URI=your_mongodb_connection_string

# Stripe
STRIPE_SECRET_KEY=your_stripe_secret_key

# Firebase Admin
FIREBASE_PROJECT_ID=your_project_id
FIREBASE_PRIVATE_KEY="your_private_key"
FIREBASE_CLIENT_EMAIL=your_client_email

# Server
PORT=5000
SITE_DOMAIN=http://localhost:5173
```

**4. Start development server**

```bash
npm run dev
```

---

## 🔗 API Endpoints

### 👥 User Management

| Method  | Endpoint             | Access  | Description            |
| ------- | -------------------- | ------- | ---------------------- |
| `GET`   | `/users`             | Admin   | Get all users          |
| `POST`  | `/users`             | Public  | Create new user        |
| `GET`   | `/users/role/:email` | Private | Get user role by email |
| `PATCH` | `/users/role/:email` | Admin   | Update user role       |

### 📦 Product Management

| Method   | Endpoint        | Access | Description        |
| -------- | --------------- | ------ | ------------------ |
| `GET`    | `/products`     | Public | Get all products   |
| `GET`    | `/products/:id` | Public | Get single product |
| `POST`   | `/products`     | Admin  | Create new product |
| `PUT`    | `/products/:id` | Admin  | Update product     |
| `DELETE` | `/products/:id` | Admin  | Delete product     |

### 🛍️ Order Management

#### Buyer Routes

| Method   | Endpoint                 | Access | Description          |
| -------- | ------------------------ | ------ | -------------------- |
| `GET`    | `/buyer/my-orders`       | Buyer  | Get buyer's orders   |
| `GET`    | `/buyer/track-order/:id` | Buyer  | Track specific order |
| `POST`   | `/buyer/orders`          | Buyer  | Place new order      |
| `DELETE` | `/buyer/orders/:id`      | Buyer  | Cancel pending order |

#### Manager Routes

| Method  | Endpoint                       | Access  | Description          |
| ------- | ------------------------------ | ------- | -------------------- |
| `GET`   | `/manager/orders`              | Manager | Get all orders       |
| `PATCH` | `/manager/orders/:id/approve`  | Manager | Approve order        |
| `PATCH` | `/manager/orders/:id/reject`   | Manager | Reject order         |
| `PATCH` | `/manager/orders/:id/tracking` | Manager | Update tracking info |
| `GET`   | `/manager/stats`               | Manager | Get order statistics |

#### Admin Routes

| Method   | Endpoint                 | Access | Description                  |
| -------- | ------------------------ | ------ | ---------------------------- |
| `GET`    | `/admin/orders`          | Admin  | Get all orders (full access) |
| `GET`    | `/admin/dashboard-stats` | Admin  | Get dashboard statistics     |
| `DELETE` | `/admin/orders/:id`      | Admin  | Delete any order             |

### 💳 Payment & Checkout

| Method  | Endpoint                   | Access  | Description                   |
| ------- | -------------------------- | ------- | ----------------------------- |
| `POST`  | `/create-checkout-session` | Buyer   | Create Stripe payment session |
| `PATCH` | `/payment-success`         | Private | Confirm payment success       |
| `GET`   | `/payments?email=...`      | Private | Get payment history           |

---

## 📂 Project Structure

```
garflex-server/
├── node_modules/
├── .env                    # Environment variables
├── .gitignore
├── index.js               # Main application logic & routes
├── package.json
├── vercel.json            # Deployment configuration
└── README.md
```

---

## 🔐 Security & Middleware

This server uses custom middlewares to protect sensitive data:

### Authentication Middleware

- **`verifyFirebaseToken`**: Validates the incoming Bearer token via Firebase Admin
- **`verifyAdmin`**: Ensures the user has an 'Admin' role in the database
- **`verifyManager`**: Grants access only to users with 'Manager' privileges
- **`verifyBuyer`**: Restricts access to 'Buyer' role only

### Implementation Example

```javascript
// Protected route with role verification
app.get('/admin/orders', verifyFirebaseToken, verifyAdmin, async (req, res) => {
  // Admin-only logic
});
```

### Error Handling

All endpoints return standardized error responses:

```json
{
  "success": false,
  "message": "Error description",
  "error": "Detailed error (development only)"
}
```

---

## 🌐 Deployment

### Vercel Deployment

The server is optimized for Vercel deployment. Ensure you add all environment variables in the Vercel Dashboard settings.

**Deploy to production:**

```bash
vercel --prod
```

### Configuration File (`vercel.json`)

```json
{
  "version": 2,
  "builds": [
    {
      "src": "index.js",
      "use": "@vercel/node"
    }
  ],
  "routes": [
    {
      "src": "/(.*)",
      "dest": "index.js"
    }
  ]
}
```

### Environment Variables (Vercel Dashboard)

Make sure to add these in your Vercel project settings:

- `MONGODB_URI`
- `STRIPE_SECRET_KEY`
- `FIREBASE_PROJECT_ID`
- `FIREBASE_PRIVATE_KEY`
- `FIREBASE_CLIENT_EMAIL`
- `SITE_DOMAIN`

---

## 👨‍💻 Developer

<div align="center">

**Abdullah Al Mamun**  
Full Stack Developer | MERN Stack Specialist

[![GitHub](https://img.shields.io/badge/GitHub-100000?style=for-the-badge&logo=github&logoColor=white)](https://github.com/aamamunszone)
[![LinkedIn](https://img.shields.io/badge/LinkedIn-0077B5?style=for-the-badge&logo=linkedin&logoColor=white)](https://linkedin.com/in/aamamunszone)
[![Portfolio](https://img.shields.io/badge/Portfolio-FF5722?style=for-the-badge&logo=todoist&logoColor=white)](https://aamamuns.vercel.app)

</div>

---

<div align="center">

Made with ❤️ and 📦 by **Abdullah Al Mamun**

⭐ **Star this repo if you like it!**

</div>
