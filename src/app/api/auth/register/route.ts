import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { createDemoAccount } from "@/lib/demo-data";

export async function POST(req: NextRequest) {
  try {
    const { name, email, phone, password } = await req.json();

    if (!name || !email || !password) {
      return NextResponse.json(
        { error: "Name, email, and password are required" },
        { status: 400 }
      );
    }

    if (password.length < 8) {
      return NextResponse.json(
        { error: "Password must be at least 8 characters" },
        { status: 400 }
      );
    }

    try {
      const existingUser = await prisma.user.findUnique({
        where: { email },
      });

      if (existingUser) {
        return NextResponse.json(
          { error: "An account with this email already exists" },
          { status: 409 }
        );
      }

      const hashedPassword = await bcrypt.hash(password, 12);

      // Create user, writer profile, and writer DNA together
      const user = await prisma.user.create({
        data: {
          name,
          email,
          phone: phone || null,
          password: hashedPassword,
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
              storyteller: 25,
              debater: 25,
              fan: 25,
            },
          },
          feedPreferences: {
            create: {},
          },
        },
        include: {
          writerProfile: true,
          writerDNA: true,
          feedPreferences: true,
        },
      });

      return NextResponse.json(
        {
          message: "Account created successfully",
          user: { id: user.id, name: user.name, email: user.email },
        },
        { status: 201 }
      );
    } catch {
      const demoUser = await createDemoAccount({
        name,
        email,
        password,
        role: "writer",
      });

      if (!demoUser) {
        return NextResponse.json(
          { error: "An account with this email already exists" },
          { status: 409 }
        );
      }

      return NextResponse.json(
        {
          message: "Demo account created successfully",
          user: { id: demoUser.id, name: demoUser.name, email: demoUser.email },
        },
        { status: 201 }
      );
    }
  } catch (error) {
    console.error("Registration error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
