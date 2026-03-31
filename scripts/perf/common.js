import http from "k6/http";
import { check, fail } from "k6";

export function envString(name, fallbackValue) {
  var value = (__ENV[name] || "").trim();
  return value || fallbackValue;
}

export function envNumber(name, fallbackValue) {
  var raw = (__ENV[name] || "").trim();
  if (!raw) {
    return fallbackValue;
  }

  var parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallbackValue;
}

export function baseUrl() {
  return envString("BASE_URL", "http://localhost:8080").replace(/\/+$/, "");
}

export function jsonHeaders(extra) {
  var headers = {
    "Content-Type": "application/json",
  };

  var source = extra || {};
  var keys = Object.keys(source);
  for (var index = 0; index < keys.length; index += 1) {
    headers[keys[index]] = source[keys[index]];
  }

  return headers;
}

export function loginSession() {
  var email = envString("LOGIN_EMAIL", "admin@gmail.com");
  var password = envString("LOGIN_PASSWORD", "password");
  var url = baseUrl() + "/api/auth/login";
  var response = http.post(
    url,
    JSON.stringify({ email, password }),
    {
      headers: jsonHeaders(),
      tags: { name: "POST /api/auth/login" },
    }
  );

  var loginOk = check(response, {
    "login status is 200": function (r) { return r.status === 200; },
  });
  if (!loginOk) {
    var body = response.body || "";
    if (body.indexOf("this account is inactive") !== -1) {
      fail(
        "login failed: account is inactive. " +
        "Use an active account via LOGIN_EMAIL/LOGIN_PASSWORD, " +
        "or reactivate the default admin by running scripts/seed_admin_user.sh first."
      );
    }

    fail("login failed with status " + response.status + ": " + body);
  }

  var cookieNames = Object.keys(response.cookies || {});
  if (cookieNames.length === 0) {
    fail("login succeeded but no session cookie was returned");
  }

  var sessionCookieName = cookieNames[0];
  var cookieValues = response.cookies[sessionCookieName];
  if (!cookieValues || cookieValues.length === 0 || !cookieValues[0].value) {
    fail("login succeeded but session cookie " + sessionCookieName + " had no value");
  }

  return {
    sessionCookieName: sessionCookieName,
    sessionCookieValue: cookieValues[0].value,
  };
}

export function authHeaders(session) {
  return {
    Cookie: session.sessionCookieName + "=" + session.sessionCookieValue,
  };
}

export function getWithSession(path, session, name) {
  return http.get(baseUrl() + path, {
    headers: authHeaders(session),
    tags: { name },
  });
}

export function checkOk(response, label) {
  var checks = {};
  checks[label + " status is 200"] = function (r) { return r.status === 200; };
  var ok = check(response, checks);

  if (!ok) {
    fail(label + " failed with status " + response.status);
  }
}

export function weightedPick(weightedEntries) {
  var totalWeight = 0;
  for (var index = 0; index < weightedEntries.length; index += 1) {
    totalWeight += weightedEntries[index].weight;
  }

  var target = Math.random() * totalWeight;

  var running = 0;
  for (var entryIndex = 0; entryIndex < weightedEntries.length; entryIndex += 1) {
    var entry = weightedEntries[entryIndex];
    running += entry.weight;
    if (target <= running) {
      return entry;
    }
  }

  return weightedEntries[weightedEntries.length - 1];
}
