const dotenv = require("dotenv");

dotenv.config({
  path: process.env.NODE_ENV === "test" ? ".env.test" : ".env",
});

const http = require("http");
const app = require("./app");
const connectDB = require("./database/db");
const setupSocket = require("./socket/socket");

const PORT = process.env.PORT || 5050;
const server = http.createServer(app);


/* ========================
   SOCKET SETUP
======================== */
const io = setupSocket(server);
app.set("io",io)


/* ========================
   VALIDATE ENV VARIABLES
======================== */
const requiredEnv = ["MONGO_URI", "JWT_SECRET"];

requiredEnv.forEach((key) => {
  if (!process.env[key]) {
    console.error(`❌ Missing environment variable: ${key}`);
    process.exit(1);
  }
});

const startServer = async() => {
  try{
    await connectDB();
    server.listen(PORT, ()=> {
      console.log(` Server running on port ${PORT}`);
    })

  } catch (err){
    console.error("Server startup error: ", err),
    process.exit(1);
  }
}

startServer();

/* ========================
   GRACEFUL SHUTDOWN
======================== */
const shutdown = async (signal) => {
  console.log(`\n⚠️ Received ${signal}. Shutting down gracefully...`);

  server.close(() => {
    console.log("HTTP server closed.");
    process.exit(0);
  });

  // force shutdown after 10s
  setTimeout(() => {
    console.error(" Forced shutdown");
    process.exit(1);
  }, 10000);
};

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

/* ========================
   HANDLE UNCAUGHT ERRORS
======================== */
process.on("unhandledRejection", (err) => {
  console.error(" Unhandled Promise Rejection:", err);

  server.close(() => {
    process.exit(1);
  });
});

process.on("uncaughtException", (err) => {
  console.error(" Uncaught Exception:", err);
  process.exit(1);
});