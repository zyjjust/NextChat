// resume-match 类型定义

export interface Resume {
    id: string;
    fileName: string;
    fileType: string;
    rawContent: string;
    parsedData?: ResumeParsedInfo;
    status?: ItemStatus;
}

export type ItemStatus = "analyzing" | "done" | "error";

export interface ResumeParsedInfo {
    name: string;
    education: string;
    skills: string[];
    experience: string;
    summary: string;
}

export interface JobDescription {
    id: string;
    title: string;
    fileName: string;
    rawContent: string;
    parsedData?: JDParsedInfo;
}

export interface JDParsedInfo {
    jobCode?: string;
    title: string;
    keyClarification?: string;
    responsibilities: string[];
    description: string;
    requirements: {
        education: string;
        skills: string[];
        experience: string;
        abilities: string[];
    };
}

export interface MatchResult {
    resumeId: string;
    resumeName: string;
    matches: JDMatchDetail[];
}

export interface JDMatchDetail {
    jdId: string;
    jdTitle: string;
    score: number;
    comprehensiveEvaluation: string;
    strengths: string[];
    weaknesses: string[];
    improvementSuggestions: string[];
    isBestMatch: boolean;
}

export interface UsageMetrics {
    promptTokens: number;
    outputTokens: number;
    totalCost: number;
}

export enum AppTab {
    RESUMES = "resumes",
    JDS = "jds",
    MATCHING = "matching",
    RESULTS = "results",
}

// 匹配模型类型
export type MatchModelType =
    | "gemini-3-flash-preview"
    | "gemini-3-pro-preview";
