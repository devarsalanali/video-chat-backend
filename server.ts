require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
// Enable CORS for Socket.IO server
const io = new Server(server, {
  cors: {
    origin: process.env.FRONTEND_URL, // The origin you want to allow (your frontend URL)
    methods: ['GET', 'POST'], // HTTP methods allowed
    allowedHeaders: ['my-custom-header'],
    credentials: true,
  },
});

// Use the environment variables
const PORT = process.env.PORT || 3001;

// Explicitly typed variables for TypeScript
let waitingUsers: string[] = []; // Queue of users waiting to connect
let socketToUsernameMap: Record<string, string> = {}; // Map socket ID to usernames for remote username display
let matchedPairs: Record<string, string> = {}; // Track matched users

// Type definition for signaling data
interface SignalingData {
  to: string;
  offer?: RTCSessionDescriptionInit;
  answer?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
}

io.on('connection', (socket: any) => {
  console.log(`New user connected: ${socket.id}`);

  // Store the username sent from the client
  socket.on('username', (username: string) => {
    socketToUsernameMap[socket.id] = username;
    console.log(`Username received from ${socket.id}: ${username}`);
  });

  // When a user requests to be matched (i.e., joins the queue or clicks "Next")
  socket.on('next', () => {
    console.log(`User ${socket.id} requested next`);
    waitingUsers = waitingUsers.filter((user) => user !== socket.id);

    // If there is someone in the queue, match them
    if (waitingUsers.length > 0) {
      const partnerSocketId = waitingUsers.shift()!;

      // Store matched users in a map
      matchedPairs[socket.id] = partnerSocketId;
      matchedPairs[partnerSocketId] = socket.id;

      // Notify both users that they are matched
      io.to(socket.id).emit(
        'match-found',
        partnerSocketId,
        socketToUsernameMap[partnerSocketId]
      );
      io.to(partnerSocketId).emit(
        'match-found',
        socket.id,
        socketToUsernameMap[socket.id]
      );
      console.log(`Matched ${socket.id} with ${partnerSocketId}`);
    } else {
      // Otherwise, put the user in the queue
      waitingUsers.push(socket.id);
      console.log(`No users available to match. ${socket.id} added to queue`);
    }
  });

  // Handle WebRTC signaling messages
  socket.on('offer', ({ to, offer }: SignalingData) => {
    console.log(`User ${socket.id} sending offer to ${to}`);
    io.to(to).emit('offer', { offer, from: socket.id });
  });

  socket.on('answer', ({ to, answer }: SignalingData) => {
    console.log(`User ${socket.id} sending answer to ${to}`);
    io.to(to).emit('answer', { answer });
  });

  socket.on('ice-candidate', ({ to, candidate }: SignalingData) => {
    console.log(`User ${socket.id} sending ICE candidate to ${to}`);
    io.to(to).emit('ice-candidate', { candidate });
  });

  // Handle incoming chat messages
  socket.on('chat-message', (message: { text: string; socketId: string }) => {
    const to = matchedPairs[socket.id];
    if (to) {
      console.log(`User ${socket.id} sending message to ${to}`);
      io.to(to).emit('chat-message', message);
    }
  });

  // Handle disconnection
  socket.on('disconnect', () => {
    console.log(`User disconnected: ${socket.id}`);
    waitingUsers = waitingUsers.filter((user) => user !== socket.id);

    // Notify matched user if they were connected
    const partnerSocketId = matchedPairs[socket.id];
    if (partnerSocketId) {
      io.to(partnerSocketId).emit('partner-disconnected');
      console.log(
        `Notifying ${partnerSocketId} that their partner has disconnected`
      );
      delete matchedPairs[partnerSocketId];
    }

    // Remove the disconnected user from maps
    delete matchedPairs[socket.id];
    delete socketToUsernameMap[socket.id];
  });
});

server.listen(PORT, () => {
  console.log('Server listening on port 3001');
});
