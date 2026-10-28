declare module "sql.js" {
  export interface SqlValue {}
  export interface Statement {
    bind(params?: Array<string | number | null>): boolean;
    step(): boolean;
    getAsObject(): Record<string, unknown>;
    free(): void;
  }
  export interface Database {
    run(sql: string, params?: Array<string | number | null>): Database;
    prepare(sql: string): Statement;
    close(): void;
  }
  export interface SqlJsStatic {
    Database: new (data?: ArrayLike<number> | Buffer | null) => Database;
  }
  export type { Database, SqlJsStatic };
  export default function initSqlJs(config?: { locateFile?: (file: string) => string }): Promise<SqlJsStatic>;
}
