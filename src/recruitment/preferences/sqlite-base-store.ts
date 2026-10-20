import { chmodSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { BaseStore } from "@langchain/langgraph";
import type { Item, Operation, OperationResults } from "@langchain/langgraph";
import { MemoryOwnerIdSchema, RecruitmentPreferenceKeySchema, RecruitmentPreferenceSchema } from "./schemas.js";

type StoredItem = Item;

const defaultStorePath = ".data/recruitment-preferences.sqlite";

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function isPrefix(namespace: string[], prefix: string[]): boolean {
  return prefix.length <= namespace.length && prefix.every((part, index) => namespace[index] === part);
}

function namespaceMatches(namespace: string[], condition: { matchType: string; path: string[] }): boolean {
  if (condition.matchType === "prefix") return isPrefix(namespace, condition.path);
  if (condition.matchType === "suffix") return condition.path.every((part, index) => namespace[namespace.length - condition.path.length + index] === part);
  return sameValue(namespace, condition.path);
}

/** Small durable local BaseStore implementation for the single-user prototype. */
export class SQLiteBaseStore extends BaseStore {
  readonly path: string;
  private readonly database: DatabaseSync;
  private closed = false;

  constructor(path = process.env.TACTISCOUT_PREFERENCE_STORE_PATH?.trim() || defaultStorePath) {
    super();
    this.path = resolve(path);
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
    this.database = new DatabaseSync(this.path);
    chmodSync(this.path, 0o600);
    this.database.exec("PRAGMA busy_timeout=3000; CREATE TABLE IF NOT EXISTS store_items (namespace TEXT NOT NULL, item_key TEXT NOT NULL, value TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(namespace, item_key))");
    this.database.exec("CREATE INDEX IF NOT EXISTS store_items_namespace ON store_items(namespace)");
  }

  override async batch<Op extends Operation[]>(operations: Op): Promise<OperationResults<Op>> {
    this.assertOpen();
    const results: unknown[] = [];
    this.database.exec("BEGIN IMMEDIATE");
    try {
      for (const operation of operations) {
        if ("namespacePrefix" in operation) results.push(this.searchOperation(operation as Extract<Operation, { namespacePrefix: string[] }>));
        else if ("key" in operation && "value" in operation) {
          this.putOperation(operation as Extract<Operation, { value: unknown }>);
          results.push(null);
        } else if ("key" in operation) results.push(this.getOperation(operation as Extract<Operation, { key: string }>));
        else if ("matchConditions" in operation) results.push(this.listNamespacesOperation(operation as Extract<Operation, { matchConditions: unknown }>));
        else throw new Error("Unsupported LangGraph BaseStore operation.");
      }
      this.database.exec("COMMIT");
      return results as OperationResults<Op>;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  override async start(): Promise<void> {
    this.assertOpen();
  }

  override async stop(): Promise<void> {
    this.close();
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.database.close();
  }

  private getOperation(operation: Extract<Operation, { key: string }>): StoredItem | null {
    this.assertPreferenceNamespace(operation.namespace);
    RecruitmentPreferenceKeySchema.parse(operation.key);
    const row = this.database.prepare("SELECT value, created_at, updated_at FROM store_items WHERE namespace=? AND item_key=?")
      .get(JSON.stringify(operation.namespace), operation.key);
    return row ? {
      namespace: operation.namespace,
      key: operation.key,
      value: JSON.parse(String(row.value)) as Record<string, unknown>,
      createdAt: new Date(String(row.created_at)),
      updatedAt: new Date(String(row.updated_at)),
    } : null;
  }

  private putOperation(operation: Extract<Operation, { value: unknown }>): void {
    this.assertPreferenceNamespace(operation.namespace);
    RecruitmentPreferenceKeySchema.parse(operation.key);
    const namespace = JSON.stringify(operation.namespace);
    if (operation.value === null) {
      this.database.prepare("DELETE FROM store_items WHERE namespace=? AND item_key=?").run(namespace, operation.key);
      return;
    }
    const preference = RecruitmentPreferenceSchema.parse(operation.value);
    if (preference.key !== operation.key) throw new Error("长期偏好键与内容不匹配。");
    const now = new Date().toISOString();
    this.database.prepare("INSERT INTO store_items(namespace,item_key,value,created_at,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(namespace,item_key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at")
      .run(namespace, operation.key, JSON.stringify(operation.value), now, now);
  }

  private searchOperation(operation: Extract<Operation, { namespacePrefix: string[] }>): StoredItem[] {
    this.assertPreferenceNamespace(operation.namespacePrefix);
    if (operation.query?.trim()) {
      throw new Error("本地偏好 Store 不支持向量检索；请使用命名空间和 key 精确读取。");
    }
    const prefix = operation.namespacePrefix;
    const filter = operation.filter;
    const rows = this.database.prepare("SELECT namespace,item_key,value,created_at,updated_at FROM store_items ORDER BY namespace,item_key").all();
    const items = rows.flatMap((row): StoredItem[] => {
      const namespace = JSON.parse(String(row.namespace)) as string[];
      if (!isPrefix(namespace, prefix)) return [];
      const value = JSON.parse(String(row.value)) as Record<string, unknown>;
      if (filter && !Object.entries(filter).every(([key, expected]) => sameValue(value[key], expected))) return [];
      return [{
        namespace,
        key: String(row.item_key),
        value,
        createdAt: new Date(String(row.created_at)),
        updatedAt: new Date(String(row.updated_at)),
      }];
    });
    const offset = Math.max(0, operation.offset ?? 0);
    const limit = Math.max(0, operation.limit ?? 10);
    return items.slice(offset, offset + limit);
  }

  private listNamespacesOperation(operation: Extract<Operation, { matchConditions?: unknown }>): string[][] {
    const rows = this.database.prepare("SELECT DISTINCT namespace FROM store_items ORDER BY namespace").all();
    let namespaces = rows.map(row => JSON.parse(String(row.namespace)) as string[]);
    if (operation.matchConditions?.length) {
      namespaces = namespaces.filter(namespace => operation.matchConditions!.every(condition => namespaceMatches(namespace, condition)));
    }
    if (operation.maxDepth !== undefined) {
      namespaces = [...new Map(namespaces.map(namespace => {
        const truncated = namespace.slice(0, operation.maxDepth);
        return [JSON.stringify(truncated), truncated] as const;
      })).values()];
    }
    const offset = Math.max(0, operation.offset ?? 0);
    const limit = Math.max(0, operation.limit ?? namespaces.length);
    return namespaces.slice(offset, offset + limit);
  }

  private assertOpen(): void {
    if (this.closed) throw new Error("偏好 Store 已关闭。");
  }

  private assertPreferenceNamespace(namespace: string[]): void {
    if (namespace.length !== 3 || namespace[0] !== "users" || namespace[2] !== "preferences"
      || !MemoryOwnerIdSchema.safeParse(namespace[1]).success) {
      throw new Error("持久化 Store 只接受浏览器身份下经批准的招募偏好命名空间。");
    }
  }
}
