import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { verifyDemoCredentials } from "@/lib/demo-data";

export async function POST(req: NextRequest) {
  try {
    const { email, password } = await req.json();

    if (!email || !password) {
      return NextResponse.json(
        { error: "Email and password are required" },
        { status: 400 }
      );
    }

    try {
      const user = await prisma.user.findUnique({
        where: { email },
      });

      if (user) {
        const isValid = await bcrypt.compare(password, user.password);

        if (isValid) {
          return NextResponse.json({
            message: "Login successful",
            user: {
              id: user.id,
              name: user.name,
              email: user.email,
              role: user.role,
            },
          });
        }
      }
    } catch {
      // Fall back to local demo credentials if database auth is unavailable.
    }

    const demoUser = await verifyDemoCredentials(email, password);
    if (!demoUser) {
      return NextResponse.json(
        { error: "Invalid email or password" },
        { status: 401 }
      );
    }

    return NextResponse.json({
      message: "Login successful",
      user: demoUser,
    });
  } catch (error) {
    console.error("Login error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
