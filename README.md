
# Venure Backend

The backend for **Venure**, a venue discovery and booking platform. Built using **Node.js**, **Express.js**, and **MongoDB** following the **MERN stack** architecture. This service provides RESTful APIs for venue listings, user authentication, booking management, and admin controls.

---

## 🧱 Tech Stack

- **Runtime**: Node.js
- **Framework**: Express.js
- **Database**: MongoDB (with Mongoose ODM)
- **Auth**: JWT-based authentication
- **File Uploads**: Multer (multipart/form-data)
- **Validation**: Express-validator, custom middleware
- **Architecture**: MVC with layered folder structure

---

## 📂 Project Structure

```
backend/
├── controller/        # Route logic and business processing
├── middleware/        # Auth, validation, and error handling
├── model/             # Mongoose schemas
├── routes/            # Express route definitions
├── uploads/           # Venue images storage (local)
├── utils/             # Helper utilities (file deletion, etc.)
├── .env               # Environment variables
└── index.js          # Application entry point
```

---

## 🔐 Features

### 🧑‍💼 Admin
- Approve / reject / set venue status
- Manage registered venues and owners

### 🧑 Owner
- Add, update, delete venue listings
- Upload venue images
- View booking requests

### 👤 User
- Register/login
- Browse venues by filters
- Book venues using multi-step booking
- View booking summary

### ⚙️ Misc
- Robust error handling
- Secure route access with JWT middleware
- CORS and body-parser integration
- Modular and scalable architecture

---

## ⚙️ Setup & Installation

### Prerequisites
- Node.js (v16+)
- MongoDB instance running locally or on cloud

### Installation

```bash
# Clone repository
git clone https://github.com/AaryanBasnet/VenureBackend.git
cd venure-backend

# Install dependencies
npm install

# Run the server
npm run devStart
```

### Environment Variables

Create a `.env` file in the root directory:

```env
PORT=5050
MONGO_URI=mongodb://localhost:27017/venure
JWT_SECRET=your_jwt_secret
```

---

## 🛠️ API Endpoints

| Method | Endpoint                | Description                    |
|--------|-------------------------|--------------------------------|
| POST   | /api/auth/register      | Register user or owner         |
| POST   | /api/auth/login         | Login and receive JWT          |
| GET    | /api/venues             | Get all venues                 |
| POST   | /api/venues             | Create a new venue             |
| PUT    | /api/venues/:id         | Update venue                   |
| DELETE | /api/venues/:id         | Delete venue                   |
| PATCH  | /api/venues/status/:id  | Update venue status (admin)    |
| POST   | /api/bookings           | Create new booking             |
| GET    | /api/bookings/:userId   | Get bookings by user           |

> More endpoints are documented inside the `/routes/` folder

---

## 📁 Image Handling

Uploaded images are stored locally in `/uploads` directory and served via static middleware. Use absolute URLs when referencing from the frontend.

---

## 📄 License

This project is licensed under the MIT License.

---

## 📬 Contact

**Author**: Aryan Basnet  
**Email**: basnetaryan1011@gmail.com 
**LinkedIn**: [Basnet Aryan](https://www.linkedin.com/in/basnet-aryan-4511a22a4/)
