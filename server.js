const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const path = require('path');

const app = express();
const server = http.createServer(app);

// 1. Dynamic Configuration
// Railway sets process.env.PORT. If it's missing, we use 3000 (Localhost).
const PORT = process.env.PORT || 3000;

// Check if we are in Production or Dev
const isProduction = process.env.NODE_ENV === 'production';

const io = new Server(server, {
  cors: {
    // In production, you might want to restrict this to your frontend domain
    // But for ESP32, keeping it "*" (Allow All) is often easiest to prevent blocking
    origin: "*", 
    methods: ["GET", "POST"]
  }
});

app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

io.on('connection', (socket) => {
  console.log(`[${new Date().toISOString()}] User connected: ${socket.id}`);

  socket.on('esp32_message', (data) => {
    console.log('Data received:', data);
    // Broadcast to web clients if you have a frontend
    io.emit('web_update', data); 
  });

  // Handle commands from the Web Client and send to ESP32
  socket.on('web_command', (data) => {
    console.log('Command from Web:', data);
    io.emit('esp32_command', data);
  });

  socket.on('disconnect', () => {
    console.log('User disconnected');
  });
});

server.listen(PORT, () => {
  console.log(`-------------------------------------------`);
  console.log(`🚀 Server started in ${isProduction ? 'PRODUCTION' : 'DEVELOPMENT'} mode`);
  console.log(`🔌 Listening on port ${PORT}`);
  if(!isProduction) {
    console.log(`💻 Local IP for ESP32: Use 'ipconfig' (Win) or 'ifconfig' (Mac) to find it.`);
  }
  console.log(`-------------------------------------------`);
});