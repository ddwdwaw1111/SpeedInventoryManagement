import { loginSession, getWithSession, checkOk, weightedPick, envNumber } from "./common.js";

const rate = envNumber("RATE", 20);
const duration = (__ENV.DURATION || "5m").trim() || "5m";
const preAllocatedVUs = envNumber("PRE_ALLOCATED_VUS", Math.max(20, rate));
const maxVUs = envNumber("MAX_VUS", Math.max(200, rate * 5));

export const options = {
  scenarios: {
    read_only_mix: {
      executor: "constant-arrival-rate",
      rate,
      timeUnit: "1s",
      duration,
      preAllocatedVUs,
      maxVUs,
    },
  },
  thresholds: {
    http_req_failed: ["rate<0.01"],
    http_req_duration: ["p(95)<800", "p(99)<1500"],
    checks: ["rate>0.99"],
  },
};

const requestMix = [
  { weight: 25, path: "/api/items?lowStock=false", name: "GET /api/items" },
  { weight: 20, path: "/api/dashboard", name: "GET /api/dashboard" },
  { weight: 15, path: "/api/auth/me", name: "GET /api/auth/me" },
  { weight: 15, path: "/api/inbound-documents?limit=50&archiveScope=active", name: "GET /api/inbound-documents" },
  { weight: 15, path: "/api/outbound-documents?limit=50&archiveScope=active", name: "GET /api/outbound-documents" },
  { weight: 5, path: "/api/customers", name: "GET /api/customers" },
  { weight: 5, path: "/api/locations", name: "GET /api/locations" },
];

export function setup() {
  return loginSession();
}

export default function (session) {
  const request = weightedPick(requestMix);
  const response = getWithSession(request.path, session, request.name);
  checkOk(response, request.name);
}
