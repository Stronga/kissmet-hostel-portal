declare module "node-routeros" {
  export interface RouterOSAPIOptions {
    host: string;
    user: string;
    password: string;
    port?: number;
    timeout?: number;
  }

  export class RouterOSAPI {
    constructor(options: RouterOSAPIOptions);
    connected: boolean;
    connect(): Promise<RouterOSAPI>;
    write(path: string, params?: string[]): Promise<Record<string, string>[]>;
    close(): void;
  }
}
