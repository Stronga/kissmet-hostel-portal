import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import puppeteer from "puppeteer-core";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUT = path.resolve(ROOT, "../docs/ui-qa/resident-portal-consistency");
fs.mkdirSync(OUT, { recursive: true });

const PORT = 4177;
const BASE = `http://127.0.0.1:${PORT}`;

const profile = {
  id: 3,
  resident_code: "KSM-RES-0009",
  first_name: "Ama",
  middle_name: "Efua",
  last_name: "Resident",
  status: "resident",
  phone_verified_at: "2026-08-28T03:37:35.599Z",
  phone: "+233555111222",
  email: "ama@example.com",
  institution_code: "UG",
  institution_name: "University of Ghana",
  student_id: "UG-123"
};

const session = { id: 1, code: "2026", name: "2026 Academic Year", status: "active", starts_on: "2026-01-01", ends_on: "2026-12-31" };
const applications = [{
  id: 1, application_number: "KSM-APP-0001", academic_session_id: 1, status: "approved",
  created_at: "2026-08-28T03:37:35.599Z", submitted_at: "2026-08-29T03:37:35.599Z", reviewed_at: "2026-08-30T03:37:35.599Z"
}];
const bookings = [{
  id: 1, booking_number: "KSM-BKG-0001", status: "confirmed", total_amount_minor: 250000, currency: "GHS",
  academic_session_name: "2026 Academic Year", academic_session_code: "2026", application_number: "KSM-APP-0001",
  priced_room_code: "B202", priced_room_name: "Priced Room", booked_at: "2026-09-01T10:00:00.000Z",
  payment_attention_required: false
}];
const allocation = {
  id: 1, status: "active", room_code: "A101", room_name: "North Room", bed_code: "A101-B2", label: "Bed 2",
  academic_session_name: "2026 Academic Year", booking_number: "KSM-BKG-0001",
  starts_on: "2026-09-05", assigned_at: "2026-09-05T08:00:00.000Z", room_gender_policy: "female"
};
const summary = {
  bookingId: 1, bookingNumber: "KSM-BKG-0001", bookingStatus: "confirmed",
  bookingTotalMinor: 250000, verifiedTotalMinor: 150000, outstandingMinor: 100000,
  submittedTotalMinor: 50000, pendingTotalMinor: 0, refundedTotalMinor: 0,
  requiredConfirmationAmountMinor: 125000, remainingToConfirmationMinor: 0,
  confirmationRequirementMet: true, currency: "GHS", paymentAttentionRequired: false
};
const payments = [
  { id: 1, booking_id: 1, payment_reference: "KSM-PAY-0001", status: "verified", amount_minor: 150000, currency: "GHS", method: "mobile_money", created_at: "2026-08-28T03:37:35.599Z", submitted_at: "2026-08-29T03:37:35.599Z", verified_at: "2026-08-30T03:37:35.599Z", slip_filename: "verified.pdf" },
  { id: 2, booking_id: 1, payment_reference: "KSM-PAY-0002", status: "submitted", amount_minor: 50000, currency: "GHS", method: "bank_transfer", slip_filename: "submitted.png" }
];
const receipts = [{ id: 1, receipt_number: "KSM-RCP-0001", status: "issued", issued_at: "2026-08-31T03:37:35.599Z", payment_reference: "KSM-PAY-0001", amount_minor: 150000, currency: "GHS", method: "mobile_money" }];
const documents = [
  { id: 1, document_type: "student_card", status: "uploaded", original_filename: "student.pdf", size_bytes: 120000, content_type: "application/pdf", created_at: "2026-08-20T10:00:00.000Z" },
  { id: 2, document_type: "ghana_card", status: "verified", original_filename: "ghana.png", size_bytes: 220000, content_type: "image/png", created_at: "2026-08-21T10:00:00.000Z" }
];
const maintenance = [
  { id: 1, request_number: "KSM-MNT-0001", category: "plumbing", priority: "urgent", status: "open", title: "Leaking sink", description: "Pipe leak under the sink", opened_at: "2026-09-01T00:00:00.000Z", room_code: "A101", room_name: "North Room", bed_code: "A101-B2", bed_label: "Bed 2" },
  { id: 2, request_number: "KSM-MNT-0002", category: "electrical", priority: "normal", status: "resolved", title: "Socket spark", description: null, opened_at: "2026-08-01T00:00:00.000Z", resolved_at: "2026-08-03T00:00:00.000Z", room_code: "A101", room_name: "North Room", bed_code: "A101-B2", bed_label: "Bed 2" }
];
const messages = [
  { id: 1, subject: "Accounts note", body: "Please upload your remaining payment slip.", status: "unread", sent_at: "2026-09-10T09:00:00.000Z", sender_label: "Kissmet Hostel", message_status: "delivered" },
  { id: 2, subject: "Welcome", body: "Welcome to Kissmet Hostel.", status: "read", sent_at: "2026-09-01T09:00:00.000Z", read_at: "2026-09-01T10:00:00.000Z", sender_label: "Kissmet Hostel", message_status: "delivered" }
];
const announcements = [
  { id: 1, title: "Water update", body: "Water supply will pause from 2pm to 5pm on Friday.", severity: "info", published_at: "2026-09-12T08:00:00.000Z" },
  { id: 2, title: "Security notice", body: "Always lock your room when leaving.", severity: "warning", published_at: "2026-09-08T08:00:00.000Z" }
];

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS"
};

function json(data, extra = {}) {
  return {
    status: 200,
    contentType: "application/json",
    headers: cors,
    body: JSON.stringify({ ok: true, data, ...extra })
  };
}

async function mockApi(page) {
  await page.setRequestInterception(true);
  page.on("request", (req) => {
    const url = req.url();
    if (req.method() === "OPTIONS") {
      return req.respond({ status: 204, headers: cors });
    }
    if (!(url.includes("localhost:8787") || url.includes("/auth/") || url.includes("/resident/") || url.includes("/institutions"))) {
      return req.continue();
    }
    if (url.includes("/institutions")) return req.respond(json([{ code: "UG", name: "University of Ghana" }]));
    if (url.endsWith("/auth/me") || url.includes("/auth/me")) {
      return req.respond({
        status: 200,
        contentType: "application/json",
        headers: cors,
        body: JSON.stringify({
          user: {
            id: 10, userType: "resident", displayName: "Ama Efua Resident", email: "ama@example.com",
            role: "resident", staffId: null, residentId: 3, sessionId: 99
          }
        })
      });
    }
    if (url.includes("/resident/me/documents")) return req.respond(json(documents));
    if (url.includes("/resident/me/applications")) return req.respond(json(applications));
    if (url.includes("/resident/me/academic-session")) return req.respond(json(session));
    if (url.includes("/resident/me/bookings")) return req.respond(json(bookings));
    if (url.includes("/resident/me/payments/summary")) return req.respond(json(summary));
    if (url.includes("/resident/me/payments")) return req.respond(json(payments));
    if (url.includes("/resident/me/receipts")) return req.respond(json(receipts));
    if (url.includes("/resident/me/allocations")) {
      return req.respond(json([{ ...allocation, status: "transferred", room_code: "C303", room_name: "Old Room", id: 2 }, allocation]));
    }
    if (url.includes("/resident/me/allocation")) return req.respond(json(allocation));
    if (url.includes("/resident/me/maintenance")) return req.respond(json(maintenance));
    if (/\/resident\/me\/messages\/\d+/.test(url)) {
      return req.respond(json({ ...messages[0], status: "read", read_at: "2026-09-12T10:00:00.000Z" }));
    }
    if (url.includes("/resident/me/messages")) return req.respond(json(messages));
    if (/\/resident\/me\/announcements\/\d+/.test(url)) return req.respond(json(announcements[0]));
    if (url.includes("/resident/me/announcements")) return req.respond(json(announcements));
    if (url.includes("/resident/me/internet-access/sessions")) return req.respond(json({ activeCount: 1, deviceLimit: 3 }));
    if (url.includes("/resident/me/internet-access")) {
      return req.respond(json({ hasAccess: true, status: "active", internetId: "ama.resident", deviceLimit: 3, syncStatus: "synced" }));
    }
    if (url.includes("/resident/me")) return req.respond(json(profile));
    return req.continue();
  });
}

const pages = [
  { route: "/application", name: "application" },
  { route: "/payments", name: "payments" },
  { route: "/room", name: "my-room" },
  { route: "/booking", name: "booking" },
  { route: "/maintenance", name: "maintenance" },
  { route: "/messages", name: "messages" },
  { route: "/announcements", name: "announcements" },
  { route: "/profile", name: "profile" },
  { route: "/documents", name: "documents" }
];

const viewports = [
  { width: 1440, height: 1100, label: "1440" },
  { width: 430, height: 900, label: "430" },
  { width: 1024, height: 900, label: "1024" }
];

function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForServer() {
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch(BASE);
      if (res.ok || res.status === 200) return;
    } catch {}
    await wait(250);
  }
  throw new Error("preview server did not start");
}

const preview = spawn("npx", ["vite", "preview", "--host", "127.0.0.1", "--port", String(PORT)], {
  cwd: ROOT,
  stdio: "pipe"
});

try {
  await waitForServer();
  const browser = await puppeteer.launch({
    executablePath: "/usr/bin/google-chrome",
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"]
  });

  const notes = [];
  for (const pageDef of pages) {
    for (const vp of viewports) {
      if (vp.label === "1024" && !["application", "payments", "booking", "announcements", "profile"].includes(pageDef.name)) {
        continue;
      }
      const page = await browser.newPage();
      await page.setViewport({ width: vp.width, height: vp.height, deviceScaleFactor: 1 });
      await mockApi(page);
      await page.evaluateOnNewDocument(() => {
        localStorage.setItem("kissmet_resident_token", "ui-qa-token");
      });
      await page.goto(`${BASE}${pageDef.route}`, { waitUntil: "domcontentloaded", timeout: 30000 });
      await page.waitForSelector('h1', { timeout: 10000 });
      await wait(500);
      const file = path.join(OUT, `${pageDef.name}-${vp.label}.png`);
      await page.screenshot({ path: file, fullPage: true });
      const metrics = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth,
        overflowX: document.documentElement.scrollWidth > window.innerWidth + 1
      }));
      notes.push({ page: pageDef.name, width: vp.width, path: file, ...metrics });
      await page.close();
      console.log("saved", file);
    }
  }

  fs.writeFileSync(path.join(OUT, "qa-notes.json"), JSON.stringify(notes, null, 2));
  await browser.close();
  console.log('done', notes.length);
} finally {
  try { preview.kill("SIGKILL"); } catch {}
}
