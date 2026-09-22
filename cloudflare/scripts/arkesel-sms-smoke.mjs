#!/usr/bin/env node
/**
 * Opt-in ONE-MESSAGE Arkesel SMS smoke test.
 *
 * Refuses to run unless ALL of the following are set in the environment
 * (typically via cloudflare/.dev.vars loaded manually / exported):
 *   ARKESEL_SMOKE_OPT_IN=YES_SEND_ONE_MESSAGE
 *   ARKESEL_API_KEY
 *   ARKESEL_SENDER_ID
 *   ARKESEL_SMOKE_TO   (233XXXXXXXXX)
 *
 * Never prints API key or OTP. Not invoked by CI or npm test.
 */
const OPT_IN = "YES_SEND_ONE_MESSAGE";
const ENDPOINT = process.env.ARKESEL_SMS_ENDPOINT || "https://sms.arkesel.com/api/v2/sms/send";

function fail(msg) {
  console.error(`[arkesel-smoke] REFUSED: ${msg}`);
  process.exit(1);
}

if (process.env.ARKESEL_SMOKE_OPT_IN !== OPT_IN) {
  fail(`Set ARKESEL_SMOKE_OPT_IN=${OPT_IN} to authorize exactly one test message.`);
}

const apiKey = (process.env.ARKESEL_API_KEY || "").trim();
const sender = (process.env.ARKESEL_SENDER_ID || "").trim();
const to = (process.env.ARKESEL_SMOKE_TO || "").trim();

if (!apiKey) fail("ARKESEL_API_KEY is required.");
if (!sender) fail("ARKESEL_SENDER_ID is required (do not invent KISSMET before approval).");
if (!/^233[2-5]\d{8}$/.test(to)) fail("ARKESEL_SMOKE_TO must be 233XXXXXXXXX.");

const code = String(Math.floor(100000 + Math.random() * 900000));
const message = `Your Kissmet verification code is ${code}. It expires in 10 minutes. Do not share this code.`;
const masked = `${to.slice(0, 3)}****${to.slice(-3)}`;

const controller = new AbortController();
const timer = setTimeout(() => controller.abort(), 10_000);

let response;
try {
  response = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "api-key": apiKey
    },
    body: JSON.stringify({
      sender,
      message,
      recipients: [to]
    }),
    signal: controller.signal
  });
} catch (e) {
  clearTimeout(timer);
  const aborted = e && typeof e === "object" && "name" in e && e.name === "AbortError";
  fail(aborted ? "request timed out" : "network error");
} finally {
  clearTimeout(timer);
}

let body = null;
try {
  body = await response.json();
} catch {
  body = null;
}

const ok = response.ok && body && body.status === "success";
const id =
  ok && Array.isArray(body.data) && body.data[0] && typeof body.data[0].id === "string"
    ? body.data[0].id.slice(0, 64)
    : undefined;

console.log(
  JSON.stringify({
    event: "arkesel_smoke",
    success: Boolean(ok),
    httpStatus: response.status,
    maskedPhone: masked,
    senderConfigured: Boolean(sender),
    providerMessageId: id || null
  })
);

if (!ok) process.exit(2);
