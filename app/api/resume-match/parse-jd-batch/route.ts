import { NextRequest, NextResponse } from "next/server";
import { parseJDBatchWithAI } from "../geminiServerService";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { inputs } = body;

    if (!inputs || !Array.isArray(inputs)) {
      return NextResponse.json({ error: "Invalid inputs" }, { status: 400 });
    }

    const result = await parseJDBatchWithAI(inputs);
    return NextResponse.json(result);
  } catch (error: any) {
    console.error("Error in parse-jd-batch API:", error);
    return NextResponse.json(
      { error: error.message || "Internal Server Error" },
      { status: 500 },
    );
  }
}
