import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorState } from "../components/common/ErrorState";
import { LoadingState } from "../components/common/LoadingState";
import { RESIDENT_TOKEN_KEY } from "./AuthContext";
import { renderResidentApp, residentEndpointResponse, residentUser, seedResidentToken, staffUser } from "../testUtils";

function mockFetch(handler: (url: string, init?: RequestInit) => Promise<Response> | Response) {
  vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) => handler(String(input), init)));
}

describe("resident auth provider", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("restores a valid resident session from GET /auth/me", async () => {
    seedResidentToken();
    mockFetch((url) => residentEndpointResponse(url) ?? Response.json({ user: residentUser }));
    render(renderResidentApp(["/home"]));

    expect(await screen.findByText(/Welcome, Ama Resident/i)).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith("http://localhost:8787/auth/me", expect.objectContaining({
      headers: expect.any(Headers)
    }));
  });

  it("clears auth state on 401", async () => {
    seedResidentToken();
    mockFetch(() => Response.json({ error: "Unauthorized" }, { status: 401 }));
    render(renderResidentApp(["/home"]));

    expect(await screen.findByRole("heading", { name: /Resident Portal/i })).toBeInTheDocument();
    expect(localStorage.getItem(RESIDENT_TOKEN_KEY)).toBeNull();
  });

  it("rejects a non-resident authenticated user safely", async () => {
    seedResidentToken("staff-token");
    mockFetch(() => Response.json({ user: staffUser }));
    render(renderResidentApp(["/home"]));

    expect(await screen.findByRole("heading", { name: /Resident Portal/i })).toBeInTheDocument();
    expect(localStorage.getItem(RESIDENT_TOKEN_KEY)).toBeNull();
  });

  it("calls logout, clears the resident token, and redirects", async () => {
    seedResidentToken();
    mockFetch((url) => {
      if (url.endsWith("/auth/logout")) return Response.json({ ok: true });
      return residentEndpointResponse(url) ?? Response.json({ user: residentUser });
    });
    render(renderResidentApp(["/home"]));

    await screen.findByText(/Welcome, Ama Resident/i);
    await userEvent.click(screen.getAllByRole("button", { name: /logout/i })[0]);

    await waitFor(() => expect(localStorage.getItem(RESIDENT_TOKEN_KEY)).toBeNull());
    expect(await screen.findByRole("heading", { name: /Resident Portal/i })).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith("http://localhost:8787/auth/logout", expect.any(Object));
  });

  it("renders reusable loading and API error states", () => {
    render(
      <div>
        <LoadingState label="Restoring your session" />
        <ErrorState message="Unable to load resident portal data." />
      </div>
    );
    expect(screen.getByRole("status")).toHaveTextContent(/restoring/i);
    expect(screen.getByRole("alert")).toHaveTextContent(/unable to load/i);
  });
});
