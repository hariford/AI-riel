import sql from 'mssql';
import type { UsageRecord } from '@airiel/protocol';

export interface UsageSummaryRow {
  userId: string;
  userName: string;
  model: string;
  day: string;
  promptTokens: number;
  completionTokens: number;
  cachedTokens: number;
  requests: number;
}

export interface UsageStore {
  record(rec: UsageRecord): Promise<void>;
  /** Tokens (prompt + completion) consumed by a user since UTC midnight. */
  todayTokens(userId: string): Promise<number>;
  summary(opts: { from: Date; to: Date; userId?: string }): Promise<UsageSummaryRow[]>;
  close(): Promise<void>;
}

/** In-memory store for tests and local development without SQL. */
export class MemoryUsageStore implements UsageStore {
  readonly records: UsageRecord[] = [];
  async record(rec: UsageRecord) {
    this.records.push(rec);
  }
  async todayTokens(userId: string) {
    const start = new Date();
    start.setUTCHours(0, 0, 0, 0);
    return this.records
      .filter((r) => r.userId === userId && new Date(r.createdAt) >= start)
      .reduce((n, r) => n + r.promptTokens + r.completionTokens, 0);
  }
  async summary({ from, to, userId }: { from: Date; to: Date; userId?: string }) {
    const map = new Map<string, UsageSummaryRow>();
    for (const r of this.records) {
      const at = new Date(r.createdAt);
      if (at < from || at > to || (userId && r.userId !== userId)) continue;
      const day = r.createdAt.slice(0, 10);
      const key = `${r.userId}|${r.model}|${day}`;
      const row = map.get(key) ?? {
        userId: r.userId, userName: r.userName, model: r.model, day,
        promptTokens: 0, completionTokens: 0, cachedTokens: 0, requests: 0,
      };
      row.promptTokens += r.promptTokens;
      row.completionTokens += r.completionTokens;
      row.cachedTokens += r.cachedTokens;
      row.requests += 1;
      map.set(key, row);
    }
    return [...map.values()];
  }
  async close() {}
}

/** Azure SQL store; schema in sql/schema.sql. */
export class SqlUsageStore implements UsageStore {
  private pool: Promise<sql.ConnectionPool>;
  constructor(connectionString: string) {
    this.pool = new sql.ConnectionPool(connectionString).connect();
  }
  async record(rec: UsageRecord) {
    const p = await this.pool;
    await p
      .request()
      .input('UserId', sql.NVarChar(128), rec.userId)
      .input('UserName', sql.NVarChar(256), rec.userName)
      .input('ConversationId', sql.NVarChar(64), rec.conversationId)
      .input('Model', sql.NVarChar(128), rec.model)
      .input('PromptTokens', sql.Int, rec.promptTokens)
      .input('CompletionTokens', sql.Int, rec.completionTokens)
      .input('CachedTokens', sql.Int, rec.cachedTokens)
      .input('ToolCalls', sql.Int, rec.toolCalls)
      .input('LatencyMs', sql.Int, rec.latencyMs)
      .input('CreatedAt', sql.DateTime2, new Date(rec.createdAt))
      .query(
        `INSERT INTO dbo.Usage (UserId, UserName, ConversationId, Model, PromptTokens, CompletionTokens, CachedTokens, ToolCalls, LatencyMs, CreatedAt)
         VALUES (@UserId, @UserName, @ConversationId, @Model, @PromptTokens, @CompletionTokens, @CachedTokens, @ToolCalls, @LatencyMs, @CreatedAt)`,
      );
  }
  async todayTokens(userId: string) {
    const p = await this.pool;
    const r = await p
      .request()
      .input('UserId', sql.NVarChar(128), userId)
      .query<{ Tokens: number | null }>(
        `SELECT SUM(PromptTokens + CompletionTokens) AS Tokens FROM dbo.Usage
         WHERE UserId = @UserId AND CreatedAt >= CAST(SYSUTCDATETIME() AS date)`,
      );
    return r.recordset[0]?.Tokens ?? 0;
  }
  async summary({ from, to, userId }: { from: Date; to: Date; userId?: string }) {
    const p = await this.pool;
    const req = p.request().input('From', sql.DateTime2, from).input('To', sql.DateTime2, to);
    if (userId) req.input('UserId', sql.NVarChar(128), userId);
    const r = await req.query<UsageSummaryRow>(
      `SELECT UserId AS userId, MAX(UserName) AS userName, Model AS model,
              CONVERT(varchar(10), CreatedAt, 23) AS day,
              SUM(PromptTokens) AS promptTokens, SUM(CompletionTokens) AS completionTokens,
              SUM(CachedTokens) AS cachedTokens, COUNT(*) AS requests
       FROM dbo.Usage
       WHERE CreatedAt BETWEEN @From AND @To ${userId ? 'AND UserId = @UserId' : ''}
       GROUP BY UserId, Model, CONVERT(varchar(10), CreatedAt, 23)
       ORDER BY day DESC, userName`,
    );
    return r.recordset;
  }
  async close() {
    (await this.pool).close();
  }
}
