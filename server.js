const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const cron = require("node-cron");

const app = express();
const server = http.createServer(app);

// 1. Dynamic Configuration
// Railway sets process.env.PORT. If it's missing, we use 3000 (Localhost).
const PORT = process.env.PORT || 3000;

// Check if we are in Production or Dev
const isProduction = process.env.NODE_ENV === "production";

// Polling configuration - Customize interval here
const POLL_INTERVAL_SECONDS = 5;
const CRON_EXPRESSION = `*/${POLL_INTERVAL_SECONDS} * * * * *`; // Every N seconds

const io = new Server(server, {
	cors: {
		// In production, you might want to restrict this to your frontend domain
		// But for ESP32, keeping it "*" (Allow All) is often easiest to prevent blocking
		origin: "*",
		methods: ["GET", "POST"],
	},
});

// Server state to track temperature history
const MAX_HISTORY = 20;
let serverState = {
	roomTemp: null,
	power: false,
	mode: "cool",
	fanSpeed: "auto",
	history: [],
};

// Middleware
app.use(express.json()); // Enable JSON body parsing for REST API
app.use(express.static(path.join(__dirname, "public")));

// REST API Endpoint for commands
app.post("/api/command", (req, res) => {
	const data = req.body;
	console.log("Command from Web (REST):", data);
	// Relay command to ESP32 via Socket.IO
	io.emit("esp32_command", data);
	res.json({ status: "success", data });
});

// Serve Frontend
app.get("/", (req, res) => {
	res.sendFile(path.join(__dirname, "public", "index.html"));
});

// Socket.IO Logic
io.on("connection", (socket) => {
	console.log(`[${new Date().toISOString()}] User connected: ${socket.id}`);

	// Send initial state to newly connected client
	socket.emit("web_update", serverState);

	// Handle data from ESP32
	socket.on("esp32_message", (data) => {
		console.log("Data received:", data);

		// Update server state
		serverState = { ...serverState, ...data };

		// Add temperature to history if present
		if (data.temperature !== undefined) {
			serverState.history.push(data.temperature);
			// Limit history size
			if (serverState.history.length > MAX_HISTORY) {
				serverState.history.shift();
			}
		}

		// Broadcast to web clients with history
		io.emit("web_update", serverState);
	});

	// Handle commands from the Web Client (Legacy Socket method, kept for compatibility if needed)
	socket.on("web_command", (data) => {
		console.log("Command from Web (Socket):", data);
		io.emit("esp32_command", data);
	});

	socket.on("disconnect", () => {
		console.log("User disconnected");
	});
});

// Setup cron job to poll ESP32 for updates
cron.schedule(CRON_EXPRESSION, () => {
	console.log(`[${new Date().toISOString()}] Polling ESP32 for updates...`);
	io.emit("esp32_command", { action: "report" });
});

server.listen(PORT, () => {
	console.log(`-------------------------------------------`);
	console.log(
		`🚀 Server started in ${
			isProduction ? "PRODUCTION" : "DEVELOPMENT"
		} mode`
	);
	console.log(`🔌 Listening on port ${PORT}`);
	if (!isProduction) {
		console.log(
			`💻 Local IP for ESP32: Use 'ipconfig' (Win) or 'ifconfig' (Mac) to find it.`
		);
	}
	console.log(`-------------------------------------------`);
});
