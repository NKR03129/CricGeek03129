import bcrypt from "bcryptjs";

export type DemoUser = {
  id: string;
  name: string;
  email: string;
  passwordHash: string;
  role: "writer" | "admin" | "user";
};

export type DemoWriter = {
  id: string;
  name: string;
  avatar: string | null;
  bio: string | null;
  role: string;
  createdAt: string;
  profile: {
    averageBQS: number;
    totalBlogs: number;
    totalViews: number;
    totalRuns: number;
    archetype: string;
    writerTitle: string;
    level: number;
    xp: number;
    bestBQS: number;
    featuredCount: number;
    streak: number;
    bcs: number;
    statAccuracy: number;
  };
  dna: {
    analyst: number;
    fan: number;
    storyteller: number;
    debater: number;
  };
  badges: { badge: string; title: string; description: string; tier: string; earnedAt: string }[];
  achievements: { achievement: string; title: string; description: string; milestone: number; earnedAt: string }[];
  recentBlogs: { id: string; title: string; slug: string; views: number; runs: number; createdAt: string; score: { bqs: number } | null }[];
};

const demoWriters: DemoWriter[] = [
  {
    id: "demo-writer-1",
    name: "Demo Writer",
    avatar: null,
    bio: "Local test writer for CricGeek demo flows.",
    role: "writer",
    createdAt: "2026-01-15T00:00:00.000Z",
    profile: {
      averageBQS: 88,
      totalBlogs: 4,
      totalViews: 1240,
      totalRuns: 420,
      archetype: "analyst",
      writerTitle: "CRAFTED ANALYST",
      level: 4,
      xp: 340,
      bestBQS: 92,
      featuredCount: 2,
      streak: 3,
      bcs: 84,
      statAccuracy: 81,
    },
    dna: {
      analyst: 78,
      fan: 18,
      storyteller: 44,
      debater: 60,
    },
    badges: [
      {
        badge: "first_blood",
        title: "First Blood",
        description: "Published your first expression",
        tier: "bronze",
        earnedAt: "2026-01-20T00:00:00.000Z",
      },
    ],
    achievements: [
      {
        achievement: "first_blog",
        title: "First Expression",
        description: "Published your first expression",
        milestone: 1,
        earnedAt: "2026-01-20T00:00:00.000Z",
      },
    ],
    recentBlogs: [
      {
        id: "demo-blog-1",
        title: "The Death Over Blueprint that Changed the Match",
        slug: "death-over-blueprint",
        views: 305,
        runs: 12,
        createdAt: "2026-01-20T00:00:00.000Z",
        score: { bqs: 92 },
      },
      {
        id: "demo-blog-2",
        title: "Why the Middle Overs Dictate Wicket Pressure",
        slug: "middle-overs-pressure",
        views: 178,
        runs: 9,
        createdAt: "2026-01-22T00:00:00.000Z",
        score: { bqs: 84 },
      },
    ],
  },
];

const demoBlogs = [
  {
    id: "demo-blog-1",
    title: "The Death Over Blueprint that Changed the Match",
    excerpt: "A tactical breakdown of the final-over adjustments that swung the game.",
    slug: "death-over-blueprint",
    tags: "analysis, strategy, death-overs",
    matchTag: null,
    views: 305,
    runs: 12,
    createdAt: "2026-01-20T00:00:00.000Z",
    author: {
      id: "demo-writer-1",
      name: "Demo Writer",
      avatar: null,
      role: "writer",
    },
    _count: { comments: 14 },
    score: { bqs: 92, archetypeLabel: "analyst" },
  },
  {
    id: "demo-blog-2",
    title: "Why the Middle Overs Dictate Wicket Pressure",
    excerpt: "The middle phase often decides the match long before the final over arrives.",
    slug: "middle-overs-pressure",
    tags: "analysis, pace, middle-overs",
    matchTag: null,
    views: 178,
    runs: 9,
    createdAt: "2026-01-22T00:00:00.000Z",
    author: {
      id: "demo-writer-1",
      name: "Demo Writer",
      avatar: null,
      role: "writer",
    },
    _count: { comments: 6 },
    score: { bqs: 84, archetypeLabel: "storyteller" },
  },
  {
    id: "demo-blog-3",
    title: "How the New Ball Pairing Changed the Powerplay Window",
    excerpt: "A short advanced look at seam movement and field alignment in the opening spell.",
    slug: "new-ball-pairing",
    tags: "powerplay, bowling, tactics",
    matchTag: null,
    views: 249,
    runs: 11,
    createdAt: "2026-01-25T00:00:00.000Z",
    author: {
      id: "demo-writer-2",
      name: "CricGeek Analyst",
      avatar: null,
      role: "writer",
    },
    _count: { comments: 9 },
    score: { bqs: 88, archetypeLabel: "analyst" },
  },
];

const demoUsers: DemoUser[] = [
  {
    id: "demo-writer-1",
    name: "Demo Writer",
    email: "writer@demo.local",
    passwordHash: bcrypt.hashSync("Writer@123", 12),
    role: "writer",
  },
  {
    id: "demo-admin-1",
    name: "Demo Admin",
    email: "admin@demo.local",
    passwordHash: bcrypt.hashSync("Admin@123", 12),
    role: "admin",
  },
];

export const DEMO_CREDENTIALS = [
  { email: "writer@demo.local", password: "Writer@123", role: "writer" },
  { email: "admin@demo.local", password: "Admin@123", role: "admin" },
] as const;

export function getDemoBlogs() {
  return demoBlogs;
}

export function getDemoWriter(id: string) {
  return demoWriters.find((writer) => writer.id === id) || null;
}

export async function verifyDemoCredentials(email: string, password: string) {
  const user = demoUsers.find((candidate) => candidate.email.toLowerCase() === email.toLowerCase());
  if (!user) return null;

  const isValid = await bcrypt.compare(password, user.passwordHash);
  if (!isValid) return null;

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
  };
}

export async function createDemoAccount(input: {
  name: string;
  email: string;
  password: string;
  role?: "user" | "writer" | "admin";
}) {
  const normalizedEmail = input.email.toLowerCase();
  const existing = demoUsers.find((user) => user.email.toLowerCase() === normalizedEmail);

  if (existing) {
    return null;
  }

  const user: DemoUser = {
    id: `demo-user-${Date.now()}`,
    name: input.name,
    email: normalizedEmail,
    passwordHash: await bcrypt.hash(input.password, 12),
    role: input.role ?? "user",
  };

  demoUsers.push(user);
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
  };
}
