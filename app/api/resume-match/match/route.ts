import { NextRequest, NextResponse } from "next/server";
import { matchResumeToJDs } from "../geminiServerService";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { resume, jds, matchModel } = body;

    if (!resume || !jds) {
      return NextResponse.json(
        { error: "Missing resume or jds" },
        { status: 400 },
      );
    }

    const result = await matchResumeToJDs(resume, jds, matchModel);
    return NextResponse.json(result);
  } catch (error: any) {
    console.error("Error in match API:", error);
    return NextResponse.json(
      { error: error.message || "Internal Server Error" },
      { status: 500 },
    );
  }
}
