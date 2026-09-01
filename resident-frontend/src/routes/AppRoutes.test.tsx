import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderResidentApp, residentUser, seedResidentToken } from "../testUtils";

function mockFetch(handler: (url: string) => Response) {
  vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => handler(String(input))));
}

function defaultPublicResponse(url: string) {
  if (url.endsWith("/public/institutions")) return Response.json({ ok: true, data: [{ code: "ug", name: "University of Ghana" }] });
  return Response.json({ error: "Unauthorized" }, { status: 401 });
}

describe("resident routes", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders the app", async () => {
    mockFetch(defaultPublicResponse);
    render(renderResidentApp(["/login"]));
    expect(await screen.findByRole("heading", { name: /Resident Portal/i })).toBeInTheDocument();
  });

  it("redirects unauthenticated / to /login", async () => {
    mockFetch(defaultPublicResponse);
    render(renderResidentApp(["/"]));
    expect(await screen.findByRole("heading", { name: /Resident Portal/i })).toBeInTheDocument();
  });

  it("redirects authenticated / to /home", async () => {
    seedResidentToken();
    mockFetch(() => Response.json({ user: residentUser }));
    render(renderResidentApp(["/"]));
    expect(await screen.findByText(/Welcome, Ama Resident/i)).toBeInTheDocument();
  });

  it("redirects protected routes when unauthenticated", async () => {
    mockFetch(defaultPublicResponse);
    render(renderResidentApp(["/payments"]));
    expect(await screen.findByRole("heading", { name: /Resident Portal/i })).toBeInTheDocument();
  });

  it("renders the protected resident shell for a valid resident session", async () => {
    seedResidentToken();
    mockFetch(() => Response.json({ user: residentUser }));
    render(renderResidentApp(["/home"]));

    expect(await screen.findByText(/resident portal identity/i)).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Resident navigation" })).toBeInTheDocument();
  });

  it("renders expected mobile primary navigation items", async () => {
    seedResidentToken();
    mockFetch(() => Response.json({ user: residentUser }));
    render(renderResidentApp(["/home"]));

    expect(await screen.findByRole("navigation", { name: /Primary resident navigation/i })).toBeInTheDocument();
    expect(screen.getAllByText("Home").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Application").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Payments").length).toBeGreaterThan(0);
    expect(screen.getAllByText("My Room").length).toBeGreaterThan(0);
  });

  it("renders desktop navigation correctly", async () => {
    seedResidentToken();
    mockFetch(() => Response.json({ user: residentUser }));
    render(renderResidentApp(["/home"]));

    expect(await screen.findByRole("navigation", { name: "Resident navigation" })).toBeInTheDocument();
    expect(screen.getAllByText("Documents").length).toBeGreaterThan(0);
  });

  it("does not fabricate resident workflow data on Home", async () => {
    seedResidentToken();
    mockFetch(() => Response.json({ user: residentUser }));
    render(renderResidentApp(["/home"]));

    expect(await screen.findByText(/Your hostel journey summary will appear here/i)).toBeInTheDocument();
    expect(screen.queryByText(/Approved|Paid|Confirmed|Room 101/i)).not.toBeInTheDocument();
  });

  it("shows the resident name supplied by auth context", async () => {
    seedResidentToken();
    mockFetch(() => Response.json({ user: { ...residentUser, displayName: "Kojo Mensah" } }));
    render(renderResidentApp(["/home"]));

    expect(await screen.findByText(/Welcome, Kojo Mensah/i)).toBeInTheDocument();
  });

  it("opens the mobile More menu with secondary resident routes", async () => {
    seedResidentToken();
    mockFetch(() => Response.json({ user: residentUser }));
    render(renderResidentApp(["/home"]));

    await screen.findByText(/Welcome, Ama Resident/i);
    await userEvent.click(screen.getByRole("button", { name: "More" }));
    await waitFor(() => expect(screen.getByRole("navigation", { name: /More resident navigation/i })).toBeInTheDocument());
    expect(screen.getAllByText("Maintenance").length).toBeGreaterThan(0);
  });
});
