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

// Polling configuration - Customize intervals here
const POLL_INTERVAL_SECONDS = 60; // Poll ESP32 every 60 seconds (1 minute)
const HISTORY_INTERVAL_MINUTES = 60; // Add to history every 60 minutes (1 hour)
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
const MAX_HISTORY = 24;
let serverState = {
	temperature: null,
	power: false,
	mode: "cool",
	fanSpeed: "auto",
	history: [],
};

// Track when the last history entry was added
let lastHistoryTimestamp = null;

// Middleware
app.use(express.json()); // Enable JSON body parsing for REST API
app.use(express.static(path.join(__dirname, "public")));

// Helper function to update serverState based on incoming commands
function updateServerStateFromCommand(command) {
	if (!command || !command.action) {
		console.warn("Invalid command received:", command);
		return false;
	}

	let updated = false;

	switch (command.action) {
		case "power":
			if (typeof command.value === "boolean") {
				serverState.power = command.value;
				console.log(`[State Update] Power: ${command.value}`);
				updated = true;
			}
			break;

		case "set_mode":
			const validModes = ["cool", "dry", "fan"];
			if (validModes.includes(command.value)) {
				serverState.mode = command.value;
				console.log(`[State Update] Mode: ${command.value}`);
				updated = true;
			}
			break;

		case "set_fan":
			const validFanSpeeds = ["low", "med", "high", "auto"];
			if (validFanSpeeds.includes(command.value)) {
				serverState.fanSpeed = command.value;
				console.log(`[State Update] Fan Speed: ${command.value}`);
				updated = true;
			}
			break;

		case "report":
			// report doesn't change state
			break;

		default:
			console.warn(`Unknown command action: ${command.action}`);
	}

	return updated;
}

// REST API Endpoint for commands
app.post("/api/command", (req, res) => {
	const data = req.body;
	console.log("Command from Web (REST):", data);

	// Update server state based on command action
	const stateUpdated = updateServerStateFromCommand(data);

	// Relay command to ESP32 via Socket.IO
	io.emit("esp32_command", data);

	// Broadcast updated state to all web clients if state changed
	if (stateUpdated) {
		io.emit("web_update", serverState);
	}

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

	// Handle state request from client
	socket.on("request_state", () => {
		socket.emit("web_update", serverState);
	});

	// Handle data from ESP32
	socket.on("esp32_message", (data) => {
		console.log("Data received:", data);

		// Update server state (always update current temperature)
		serverState = { ...serverState, ...data };

		// Add temperature to history only once per hour
		if (data.temperature !== undefined) {
			const now = Date.now();
			const historyIntervalMs = HISTORY_INTERVAL_MINUTES * 60 * 1000;

			// Add to history if:
			// 1. This is the first entry (lastHistoryTimestamp is null), OR
			// 2. Enough time has passed since the last history entry
			if (lastHistoryTimestamp === null ||
			    (now - lastHistoryTimestamp) >= historyIntervalMs) {

				serverState.history.push(data.temperature);
				lastHistoryTimestamp = now;

				console.log(`[${new Date(now).toISOString()}] Temperature ${data.temperature}°C added to history (${serverState.history.length}/${MAX_HISTORY})`);

				// Limit history size
				if (serverState.history.length > MAX_HISTORY) {
					serverState.history.shift();
				}
			}
		}

		// Broadcast to web clients with history
		io.emit("web_update", serverState);
	});

	// Handle commands from the Web Client (Legacy Socket method, kept for compatibility if needed)
	socket.on("web_command", (data) => {
		console.log("Command from Web (Socket):", data);

		// Update server state based on command action
		const stateUpdated = updateServerStateFromCommand(data);

		// Relay command to ESP32 via Socket.IO
		io.emit("esp32_command", data);

		// Broadcast updated state to all web clients if state changed
		if (stateUpdated) {
			io.emit("web_update", serverState);
		}
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
