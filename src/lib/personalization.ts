import { prisma } from "@/lib/db";

const KNOWN_PLAYERS = [
  "Virat Kohli",
  "Rohit Sharma",
  "Jasprit Bumrah",
  "KL Rahul",
  "Rishabh Pant",
  "Hardik Pandya",
  "MS Dhoni",
  "Shubman Gill",
  "Yashasvi Jaiswal",
  "Ravindra Jadeja",
  "Pat Cummins",
  "Steve Smith",
  "Travis Head",
  "Jos Buttler",
  "Ben Stokes",
  "Joe Root",
  "Babar Azam",
  "Shaheen Afridi",
  "David Warner",
  "Mitchell Starc",
  "Suryakumar Yadav",
  "Andre Russell",
  "Sunil Narine",
  "Ruturaj Gaikwad",
  "Rinku Singh",
  "KL Rahul",
];

const KNOWN_TEAMS = [
  "India",
  "Australia",
  "England",
  "South Africa",
  "New Zealand",
  "Pakistan",
  "Sri Lanka",
  "West Indies",
  "Bangladesh",
  "Afghanistan",
  "Mumbai Indians",
  "Chennai Super Kings",
  "Royal Challengers Bengaluru",
  "Royal Challengers Bangalore",
  "Kolkata Knight Riders",
  "Delhi Capitals",
  "Gujarat Titans",
  "Rajasthan Royals",
  "Punjab Kings",
  "Sunrisers Hyderabad",
  "Lucknow Super Giants",
];

type PreferenceSignal = {
  tags?: string[];
  teams?: string[];
  players?: string[];
  writers?: string[];
  matchTypes?: string[];
};

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function mergePreferenceValues(current: unknown, incoming: string[], limit = 24): string[] {
  const existing = Array.isArray(current)
    ? current.filter((value): value is string => typeof value === "string")
    : [];

  return unique([...incoming, ...existing]).slice(0, limit);
}

function collectEntities(source: string, candidates: string[]): string[] {
  const haystack = source.toLowerCase();
  return candidates.filter((candidate) => haystack.includes(candidate.toLowerCase()));
}

export function extractMentionSignals(input: {
  title?: string | null;
  content?: string | null;
  tags?: string | null;
  matchName?: string | null;
  matchTeams?: string[];
  matchType?: string | null;
}) {
  const title = input.title ?? "";
  const content = input.content ?? "";
  const tags = input.tags ?? "";
  const matchName = input.matchName ?? "";
  const normalizedTags = unique(
    tags
      .split(",")
      .map((tag) => tag.trim().toLowerCase())
      .filter(Boolean)
  );

  const combinedText = [title, content, tags, matchName, ...(input.matchTeams ?? [])].join(" ");
  const mentionedPlayers = unique(collectEntities(combinedText, KNOWN_PLAYERS));
  const mentionedTeams = unique([
    ...collectEntities(combinedText, KNOWN_TEAMS),
    ...(input.matchTeams ?? []),
  ]);
  const matchTypes = input.matchType ? [input.matchType.toUpperCase()] : [];

  return {
    normalizedTags,
    mentionedPlayers,
    mentionedTeams,
    matchTypes,
  };
}

export async function updateUserFeedPreferences(userId: string, signal: PreferenceSignal) {
  const existing = await prisma.userFeedPreference.findUnique({
    where: { userId },
  });

  const favoriteTags = mergePreferenceValues(existing?.favoriteTags, signal.tags ?? []);
  const favoriteTeams = mergePreferenceValues(existing?.favoriteTeams, signal.teams ?? []);
  const favoritePlayers = mergePreferenceValues(existing?.favoritePlayers, signal.players ?? []);
  const favoriteWriters = mergePreferenceValues(existing?.favoriteWriters, signal.writers ?? []);
  const favoriteMatchTypes = mergePreferenceValues(existing?.favoriteMatchTypes, signal.matchTypes ?? []);

  await prisma.userFeedPreference.upsert({
    where: { userId },
    create: {
      userId,
      favoriteTags,
      favoriteTeams,
      favoritePlayers,
      favoriteWriters,
      favoriteMatchTypes,
    },
    update: {
      favoriteTags,
      favoriteTeams,
      favoritePlayers,
      favoriteWriters,
      favoriteMatchTypes,
    },
  });
}

function getStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

export function getPersonalizationScore(input: {
  blog: {
    tags?: string | null;
    mentionedPlayers?: unknown;
    mentionedTeams?: unknown;
    authorId: string;
    createdAt: Date | string;
  };
  followedWriterIds: Set<string>;
  preferences?: {
    favoriteTags?: unknown;
    favoriteTeams?: unknown;
    favoritePlayers?: unknown;
  } | null;
}) {
  const favoriteTags = new Set(getStringArray(input.preferences?.favoriteTags).map((value) => value.toLowerCase()));
  const favoriteTeams = new Set(getStringArray(input.preferences?.favoriteTeams).map((value) => value.toLowerCase()));
  const favoritePlayers = new Set(getStringArray(input.preferences?.favoritePlayers).map((value) => value.toLowerCase()));
  const blogTags = (input.blog.tags ?? "")
    .split(",")
    .map((tag) => tag.trim().toLowerCase())
    .filter(Boolean);
  const blogTeams = getStringArray(input.blog.mentionedTeams).map((value) => value.toLowerCase());
  const blogPlayers = getStringArray(input.blog.mentionedPlayers).map((value) => value.toLowerCase());

  let score = 0;

  if (input.followedWriterIds.has(input.blog.authorId)) {
    score += 40;
  }

  score += blogTags.filter((tag) => favoriteTags.has(tag)).length * 8;
  score += blogTeams.filter((team) => favoriteTeams.has(team)).length * 10;
  score += blogPlayers.filter((player) => favoritePlayers.has(player)).length * 12;

  const ageMs = Date.now() - new Date(input.blog.createdAt).getTime();
  const ageDays = ageMs / (1000 * 60 * 60 * 24);
  score += Math.max(0, 10 - ageDays);

  return score;
}
