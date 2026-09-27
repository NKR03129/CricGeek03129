import NextAuth from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import GoogleProvider from "next-auth/providers/google";
import bcrypt from "bcryptjs";
import { prisma } from "./db";
import { verifyDemoCredentials } from "@/lib/demo-data";

const authUrl = process.env.AUTH_URL || process.env.NEXTAUTH_URL;
const authSecret = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET;
const trustHost =
  process.env.AUTH_TRUST_HOST === "true" ||
  process.env.TRUST_HOST === "true" ||
  Boolean(process.env.VERCEL) ||
  Boolean(process.env.VERCEL_ENV) ||
  Boolean(process.env.VERCEL_URL) ||
  Boolean(authUrl) ||
  process.env.NODE_ENV !== "production";

async function ensureOAuthUser(email: string, name?: string | null, image?: string | null) {
  const existingUser = await prisma.user.findUnique({
    where: { email },
  });

  if (existingUser) {
    const updatedUser = await prisma.user.update({
      where: { id: existingUser.id },
      data: {
        name: name || existingUser.name,
        avatar: image || existingUser.avatar,
        writerProfile: {
          upsert: {
            create: {
              averageBQS: 0,
              totalBlogs: 0,
              totalViews: 0,
              archetype: "fan",
              level: 1,
              xp: 0,
            },
            update: {},
          },
        },
        writerDNA: {
          upsert: {
            create: {
              analyst: 25,
              fan: 25,
              storyteller: 25,
              debater: 25,
            },
            update: {},
          },
        },
        feedPreferences: {
          upsert: {
            create: {},
            update: {},
          },
        },
      },
    });

    return updatedUser;
  }

  const placeholderPassword = await bcrypt.hash(crypto.randomUUID(), 12);

  return prisma.user.create({
    data: {
      name: name || email.split("@")[0] || "CricGeek User",
      email,
      avatar: image || null,
      password: placeholderPassword,
      role: "user",
      writerProfile: {
        create: {
          averageBQS: 0,
          totalBlogs: 0,
          totalViews: 0,
          archetype: "fan",
          level: 1,
          xp: 0,
        },
      },
      writerDNA: {
        create: {
          analyst: 25,
          fan: 25,
          storyteller: 25,
          debater: 25,
        },
      },
      feedPreferences: {
        create: {},
      },
    },
  });
}

async function ensureCredentialsUser(input: {
  email: string;
  name: string;
  role: string;
  id?: string;
}) {
  const existingByEmail = await prisma.user.findUnique({
    where: { email: input.email },
    select: { id: true, name: true, email: true, role: true },
  });

  if (existingByEmail) {
    const updated = await prisma.user.update({
      where: { id: existingByEmail.id },
      data: {
        name: input.name || existingByEmail.name,
        role: input.role || existingByEmail.role,
        writerProfile: {
          upsert: {
            create: {
              averageBQS: 0,
              totalBlogs: 0,
              totalViews: 0,
              archetype: "fan",
              level: 1,
              xp: 0,
            },
            update: {},
          },
        },
        writerDNA: {
          upsert: {
            create: {
              analyst: 25,
              fan: 25,
              storyteller: 25,
              debater: 25,
            },
            update: {},
          },
        },
        feedPreferences: {
          upsert: {
            create: {},
            update: {},
          },
        },
      },
      select: { id: true, name: true, email: true, role: true },
    });

    return updated;
  }

  const placeholderPassword = await bcrypt.hash(crypto.randomUUID(), 12);
  const created = await prisma.user.create({
    data: {
      id: input.id,
      name: input.name,
      email: input.email,
      password: placeholderPassword,
      role: input.role,
      writerProfile: {
        create: {
          averageBQS: 0,
          totalBlogs: 0,
          totalViews: 0,
          archetype: "fan",
          level: 1,
          xp: 0,
        },
      },
      writerDNA: {
        create: {
          analyst: 25,
          fan: 25,
          storyteller: 25,
          debater: 25,
        },
      },
      feedPreferences: {
        create: {},
      },
    },
    select: { id: true, name: true, email: true, role: true },
  });

  return created;
}

export const { handlers, signIn, signOut, auth } = NextAuth({
  trustHost,
  ...(authUrl ? { basePath: "/api/auth" } : {}),
  ...(authSecret ? { secret: authSecret } : {}),
  providers: [
    ...(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
      ? [
          GoogleProvider({
            clientId: process.env.GOOGLE_CLIENT_ID,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET,
          }),
        ]
      : []),
    CredentialsProvider({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          return null;
        }

        try {
          const user = await prisma.user.findUnique({
            where: { email: credentials.email as string },
          });

          if (user) {
            const isValid = await bcrypt.compare(
              credentials.password as string,
              user.password
            );

            if (isValid) {
              return {
                id: user.id,
                name: user.name,
                email: user.email,
                role: user.role,
              };
            }
          }
        } catch {
          // Fall through to demo credentials when local DB is unavailable.
        }

        const demoUser = await verifyDemoCredentials(
          credentials.email as string,
          credentials.password as string
        );

        if (!demoUser) return null;

        try {
          const ensuredUser = await ensureCredentialsUser({
            id: demoUser.id,
            name: demoUser.name,
            email: demoUser.email,
            role: demoUser.role,
          });

          return {
            id: ensuredUser.id,
            name: ensuredUser.name,
            email: ensuredUser.email,
            role: ensuredUser.role,
          };
        } catch (error) {
          console.error("Failed to ensure credentials user record:", error);
        }

        return demoUser;
      },
    }),
  ],
  callbacks: {
    async signIn({ user, account }) {
      if (account?.provider !== "google") {
        return true;
      }

      if (!user.email) {
        return false;
      }

      const appUser = await ensureOAuthUser(user.email, user.name, user.image);
      const appAuthUser = user as typeof user & { id: string; role: string };
      appAuthUser.id = appUser.id;
      appAuthUser.role = appUser.role;
      user.name = appUser.name;
      user.email = appUser.email;
      user.image = appUser.avatar || user.image;

      return true;
    },
    async jwt({ token, user }) {
      if (user) {
        token.role = (user as { role: string }).role;
        token.id = user.id;
      } else if (token.email) {
        const existingUser = await prisma.user.findUnique({
          where: { email: token.email },
          select: { id: true, role: true, name: true, avatar: true },
        });

        if (existingUser) {
          token.id = existingUser.id;
          token.role = existingUser.role;
          token.name = existingUser.name;
          token.picture = existingUser.avatar || token.picture;
        }
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as unknown as { role: string }).role = token.role as string;
        (session.user as unknown as { id: string }).id = token.id as string;
      }
      return session;
    },
  },
  pages: {
    signIn: "/auth/login",
  },
  session: {
    strategy: "jwt",
  },
});
