export interface HotspotProfile {
  id: string;
  name: string;
  sharedUsers: number;
}

export interface HotspotUser {
  id: string;
  name: string;
  profile: string;
  disabled: boolean;
  comment?: string;
}

export interface HotspotSession {
  id: string;
  user: string;
  address?: string;
  macAddress?: string;
  uptime?: string;
}

export interface CreateUserInput {
  username: string;
  password: string;
  profile: string;
  comment?: string;
}

export interface RouterOsClient {
  health(): Promise<{ ok: true; board?: string; version?: string }>;
  getProfile(name: string): Promise<HotspotProfile | null>;
  createProfile(name: string, sharedUsers: number): Promise<HotspotProfile>;
  getUser(username: string): Promise<HotspotUser | null>;
  createUser(input: CreateUserInput): Promise<HotspotUser>;
  setUserDisabled(username: string, disabled: boolean): Promise<HotspotUser>;
  setUserPassword(username: string, password: string): Promise<HotspotUser>;
  removeUser(username: string): Promise<void>;
  listActiveSessions(username: string): Promise<HotspotSession[]>;
  disconnectSessions(username: string): Promise<number>;
  close?(): Promise<void>;
}

export class ProfileConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProfileConflictError";
  }
}

export class RouterOsUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RouterOsUnavailableError";
  }
}
