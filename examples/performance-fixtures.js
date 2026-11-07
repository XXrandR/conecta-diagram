// Explicit simulated BACKEND metrics, not inferred from browser timings or result sequences.
// The existing replay reducer is unchanged; the host feeds these into the separate metrics model.
export const performanceFixtures = {
  python: {
    process: "Parent process",
    startMs: 0,
    durationMs: 145,
    cost: 3,
    memory: [
      { timeMs: 0, bytes: "33554432" },
      { timeMs: 145, bytes: "38797312" },
    ],
  },
  api: {
    process: "Parent process",
    startMs: 150,
    durationMs: 280,
    cost: 2,
    network: [
      { startMs: 162, durationMs: 250, label: "GET /orders", bytes: "8192" },
    ],
    memory: [{ timeMs: 430, bytes: "40370176" }],
  },
  database: {
    process: "Parent process",
    startMs: 440,
    durationMs: 510,
    cost: 6,
    network: [
      {
        startMs: 455,
        durationMs: 470,
        label: "Database query",
        bytes: "65536",
      },
    ],
    memory: [
      { timeMs: 700, bytes: "52428800" },
      { timeMs: 950, bytes: "46137344" },
    ],
  },
  file: {
    process: "Parent process",
    startMs: 960,
    durationMs: 620,
    cost: 4,
    network: [
      {
        startMs: 980,
        durationMs: 570,
        label: "Report transfer",
        bytes: "131072",
      },
    ],
    memory: [
      { timeMs: 1200, bytes: "48234496" },
      { timeMs: 1580, bytes: "41943040" },
    ],
  },
  mail: {
    process: "Parent process",
    startMs: 1700,
    durationMs: 240,
    cost: 1,
    network: [
      {
        startMs: 1710,
        durationMs: 210,
        label: "Mail notification",
        bytes: "2048",
      },
    ],
    memory: [{ timeMs: 1940, bytes: "37748736" }],
  },
};
