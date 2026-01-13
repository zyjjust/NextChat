import { NextRequest, NextResponse } from "next/server";
import { performOCR } from "../geminiServerService";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { base64Images } = body;

    if (!base64Images || !Array.isArray(base64Images)) {
      return NextResponse.json(
        { error: "Invalid base64Images" },
        { status: 400 },
      );
    }

    const result = await performOCR(base64Images);
    return NextResponse.json({ text: result });
  } catch (error: any) {
    console.error("Error in ocr API:", error);
    return NextResponse.json(
      { error: error.message || "Internal Server Error" },
      { status: 500 },
    );
  }
}
