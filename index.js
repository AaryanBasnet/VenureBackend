const http = require("http");
const app = require("./app");
const connectDB = require("./database/db");
const setupSocket = require("./socket/socket");

const PORT = process.env.PORT || 5050;

const server = http.createServer(app);

// Setup Socket.IO
const io = setupSocket(server);
app.set("io", io);

const startServer = async () => {
  try {
    await connectDB();
    server.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  } catch (err) {
    console.error("Server startup error:", err);
  }
};

startServer();
