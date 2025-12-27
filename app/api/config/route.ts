import { NextResponse } from "next/server";

import { getServerSideConfig } from "../../config/server";

declare global {
  type DangerConfig = {
    needCode: boolean;
    hideUserApiKey: boolean;
    disableGPT4: boolean;
    hideBalanceQuery: boolean;
    disableFastLink: boolean;
    customModels: string;
    defaultModel: string;
    visionModels: string;
  };
}

async function handle() {
  // Get server config at request time (not module load time) to ensure env vars are available
const serverConfig = getServerSideConfig();

// Danger! Do not hard code any secret value here!
// 警告！不要在这里写入任何敏感信息！
  const DANGER_CONFIG: DangerConfig = {
  needCode: serverConfig.needCode,
  hideUserApiKey: serverConfig.hideUserApiKey,
  disableGPT4: serverConfig.disableGPT4,
  hideBalanceQuery: serverConfig.hideBalanceQuery,
  disableFastLink: serverConfig.disableFastLink,
  customModels: serverConfig.customModels,
  defaultModel: serverConfig.defaultModel,
  visionModels: serverConfig.visionModels,
};

  return NextResponse.json(DANGER_CONFIG);
}

export const GET = handle;
export const POST = handle;

// Use Node.js runtime to ensure server env vars (e.g. GOOGLE_API_KEY/DEFAULT_MODEL) are available in local dev
export const runtime = "nodejs";
