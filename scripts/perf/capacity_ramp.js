import { loginSession, getWithSession, checkOk, weightedPick, envNumber } from "./common.js";

const stage1 = envNumber("STAGE1_RATE", 10);
const stage2 = envNumber("STAGE2_RATE", 25);
const stage3 = envNumber("STAGE3_RATE", 50);
const stage4 = envNumber("STAGE4_RATE", 75);
const stage5 = envNumber("STAGE5_RATE", 100);
const preAllocatedVUs = envNumber("PRE_ALLOCATED_VUS", 50);
const maxVUs = envNumber("MAX_VUS", 500);

export const options = {
  scenarios: {
    capacity_ramp: {
      executor: "ramping-arrival-rate",
      startRate: 1,
      timeUnit: "1s",
      preAllocatedVUs,
      maxVUs,
      stages: [
        { target: stage1, duration: (__ENV.STAGE1_DURATION || "30s").trim() || "30s" },
        { target: stage2, duration: (__ENV.STAGE2_DURATION || "1m").trim() || "1m" },
        { target: stage3, duration: (__ENV.STAGE3_DURATION || "1m").trim() || "1m" },
        { target: stage4, duration: (__ENV.STAGE4_DURATION || "1m").trim() || "1m" },
        { target: stage5, duration: (__ENV.STAGE5_DURATION || "1m").trim() || "1m" },
        { target: 0, duration: (__ENV.COOLDOWN_DURATION || "30s").trim() || "30s" },
      ],
    },
  },
  thresholds: {
    http_req_failed: ["rate<0.02"],
    http_req_duration: ["p(95)<1200", "p(99)<2000"],
    checks: ["rate>0.98"],
  },
};

const requestMix = [
  { weight: 30, path: "/api/items?lowStock=false", name: "GET /api/items" },
  { weight: 25, path: "/api/dashboard", name: "GET /api/dashboard" },
  { weight: 15, path: "/api/auth/me", name: "GET /api/auth/me" },
  { weight: 15, path: "/api/inbound-documents?limit=50&archiveScope=active", name: "GET /api/inbound-documents" },
  { weight: 15, path: "/api/outbound-documents?limit=50&archiveScope=active", name: "GET /api/outbound-documents" },
];

export function setup() {
  return loginSession();
}

export default function (session) {
  const request = weightedPick(requestMix);
  const response = getWithSession(request.path, session, request.name);
  checkOk(response, request.name);
}
