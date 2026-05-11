import assert from "node:assert/strict";
import { test } from "node:test";
import { checkAuth } from "../src/backend/auth-middleware.js";

function makeResponse() {
  return {
    statusCode: null,
    headers: null,
    body: "",
    writeHead(statusCode, headers) {
      this.statusCode = statusCode;
      this.headers = headers;
    },
    end(body) {
      this.body = body || "";
    }
  };
}

test("auth middleware allows localhost mode without bearer token by default", () => {
  const prev = process.env.FITCHECK_REQUIRE_API_TOKEN;
  delete process.env.FITCHECK_REQUIRE_API_TOKEN;

  try {
    const response = makeResponse();
    const record = checkAuth({ headers: {} }, response, { isAiCall: false });

    assert.equal(record.token, "local_no_auth");
    assert.equal(response.statusCode, null);
  } finally {
    if (prev === undefined) delete process.env.FITCHECK_REQUIRE_API_TOKEN;
    else process.env.FITCHECK_REQUIRE_API_TOKEN = prev;
  }
});

test("auth middleware enforces bearer token when explicitly enabled", () => {
  const prev = process.env.FITCHECK_REQUIRE_API_TOKEN;
  process.env.FITCHECK_REQUIRE_API_TOKEN = "true";

  try {
    const response = makeResponse();
    const record = checkAuth({ headers: {} }, response, { isAiCall: false });

    assert.equal(record, null);
    assert.equal(response.statusCode, 401);
    assert.match(response.body, /Authorization header required/);
  } finally {
    if (prev === undefined) delete process.env.FITCHECK_REQUIRE_API_TOKEN;
    else process.env.FITCHECK_REQUIRE_API_TOKEN = prev;
  }
});
