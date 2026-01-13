import { NextRequest, NextResponse } from "next/server";
import { parseResumeWithAI } from "../geminiServerService";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { content } = body;

    if (!content) {
      return NextResponse.json({ error: "Missing content" }, { status: 400 });
    }

    const result = await parseResumeWithAI(content);
    return NextResponse.json(result);
  } catch (error: any) {
    console.error("Error in parse-resume API:", error);
    return NextResponse.json(
      { error: error.message || "Internal Server Error" },
      { status: 500 },
    );
  }
}
