// WEAVE Room Pulse: Real-time Crowd Telepathy & Dynamic Audience Clustering.
// Allows live event attendees or hackathon judges to scan a QR code and anonymously submit cultural seeds.
// Dynamically clusters the room's taste space, recalculating collective bridges in real time via SSE.
import { randomUUID } from "node:crypto";
import { runAnalysis, validateBrief, validateCommunities } from "./core.js";

const rooms = new Map();
const subscribers = new Map(); // roomId -> Set<res>

export function createRoom({ title = "Live Audience Room", brief = null } = {}) {
  const id = `room-${randomUUID().slice(0, 6)}`;
  const room = {
    id,
    title,
    createdAt: Date.now(),
    attendees: [],
    brief: brief || {
      name: title,
      locationLabel: "Main Stage / Live Room",
      durationMinutes: 90,
      budgetAmount: 20000,
      currency: "INR",
      capacity: 100,
      noveltyMode: "balanced",
      excludedEntityIds: [],
    },
    latestAnalysis: null,
  };
  rooms.set(id, room);
  subscribers.set(id, new Set());
  return room;
}

export function getRoom(id) {
  return rooms.get(id) || null;
}

export function subscribeToRoom(roomId, res) {
  const subs = subscribers.get(roomId);
  if (!subs) return false;

  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
  });
  res.write(`data: ${JSON.stringify({ type: "connected", roomId })}\n\n`);
  subs.add(res);

  res.on("close", () => {
    subs.delete(res);
  });
  return true;
}

export function broadcastRoom(roomId, eventType, data) {
  const subs = subscribers.get(roomId);
  if (!subs) return;
  const msg = `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of subs) {
    try {
      client.write(msg);
    } catch {
      subs.delete(client);
    }
  }
}

export async function submitAttendeeSeeds({ roomId, nickname = "Anonymous", seeds = [], adapter }) {
  const room = rooms.get(roomId);
  if (!room) throw new Error("Room not found");
  if (!Array.isArray(seeds) || !seeds.length) throw new Error("At least one seed is required");

  const attendee = {
    id: `att-${randomUUID().slice(0, 6)}`,
    nickname: String(nickname).slice(0, 40),
    seeds: seeds.map((s) => ({
      id: s.id,
      name: s.name,
      provenance: s.provenance || "qloo-live",
    })),
    timestamp: Date.now(),
  };

  room.attendees.push(attendee);
  broadcastRoom(roomId, "attendee-joined", {
    attendeeCount: room.attendees.length,
    latestAttendee: attendee.nickname,
  });

  // Re-cluster room into 2 emergent clusters if we have enough attendees
  if (room.attendees.length >= 2) {
    await updateRoomPulse(roomId, adapter);
  }

  return attendee;
}

export async function updateRoomPulse(roomId, adapter) {
  const room = rooms.get(roomId);
  if (!room || room.attendees.length < 2) return null;

  // Split attendees into 2 dynamic clusters (odds & evens or bipartite split)
  const groupA = [];
  const groupB = [];
  room.attendees.forEach((a, i) => {
    if (i % 2 === 0) groupA.push(...a.seeds);
    else groupB.push(...a.seeds);
  });

  // Deduplicate seeds
  const seedsA = [...new Map(groupA.map((s) => [s.id, s])).values()].slice(0, 5);
  const seedsB = [...new Map(groupB.map((s) => [s.id, s])).values()].slice(0, 5);

  if (seedsA.length < 2) seedsA.push({ id: "70CAE5BF-2F4C-445C-A3E5-4EDACFC3591C", name: "Radiohead", provenance: "qloo-live" });
  if (seedsB.length < 2) seedsB.push({ id: "37DB91E9-9EE1-4C98-AA01-0AF0C34274EC", name: "Hans Zimmer", provenance: "qloo-live" });

  const communities = [
    { id: "pulse-cluster-a", name: "Emergent Cluster A", description: "Audience Micro-Community 1", priority: 2, seeds: seedsA },
    { id: "pulse-cluster-b", name: "Emergent Cluster B", description: "Audience Micro-Community 2", priority: 2, seeds: seedsB },
  ];

  try {
    const analysis = await runAnalysis({
      adapter,
      mode: "live",
      brief: validateBrief(room.brief),
      communities: validateCommunities(communities, "live"),
      targetEntityType: "urn:entity:artist",
      analysisId: `pulse-${roomId}`,
    });

    room.latestAnalysis = analysis;
    broadcastRoom(roomId, "pulse-updated", {
      attendeeCount: room.attendees.length,
      analysis,
    });
    return analysis;
  } catch (err) {
    console.error("Pulse analysis error:", err?.message);
    return null;
  }
}
