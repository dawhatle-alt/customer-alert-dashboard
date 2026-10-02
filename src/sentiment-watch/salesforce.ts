import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { config, PROJECT_ROOT } from "./config.ts";

type SoqlResult<T> = { records: T[]; totalSize: number; done: boolean };

export class SalesforceAuthError extends Error {}

/**
 * Read-only Salesforce access through the salesforce-bmc MCP server (`run_soql_query`),
 * authenticated by the local `sf` CLI session for the configured org alias.
 */
export class SalesforceMcp {
  private client: Client | null = null;
  private connecting: Promise<Client> | null = null;

  private connect(): Promise<Client> {
    if (this.client) return Promise.resolve(this.client);
    this.connecting ??= this.open().finally(() => {
      this.connecting = null;
    });
    return this.connecting;
  }

  private async open(): Promise<Client> {
    const transport = new StdioClientTransport({
      command: config.mcpServer.command,
      args: config.mcpServer.args,
      cwd: PROJECT_ROOT,
      stderr: "ignore",
    });
    const client = new Client({ name: "controlm-sentiment-watch", version: "0.1.0" });
    try {
      // `npx @salesforce/mcp@latest` may download a new release before it answers the handshake.
      await client.connect(transport, { timeout: 300_000 });
    } catch (error) {
      await transport.close().catch(() => {});
      throw error;
    }
    transport.onclose = () => {
      this.client = null;
    };
    this.client = client;
    return client;
  }

  async close(): Promise<void> {
    await this.client?.close();
    this.client = null;
  }

  async query<T>(soql: string): Promise<SoqlResult<T>> {
    const client = await this.connect();
    const result = await client.callTool(
      {
        name: "run_soql_query",
        arguments: { query: soql, usernameOrAlias: config.orgAlias, directory: PROJECT_ROOT },
      },
      undefined,
      { timeout: 300_000 },
    );
    const content = result.content as Array<{ type: string; text?: string }>;
    const text = content.find((c) => c.type === "text")?.text ?? "";
    if (result.isError) {
      if (/expired|invalid_grant|No authorization|not.*authoriz|INVALID_SESSION_ID|NamedOrgNotFound/i.test(text)) {
        throw new SalesforceAuthError(
          `Salesforce auth failed for alias "${config.orgAlias}". Run: ` +
            `sf org login web --instance-url https://bmcapps.my.salesforce.com --alias ${config.orgAlias}\n${text}`,
        );
      }
      throw new Error(`SOQL failed: ${text}\nQuery: ${soql}`);
    }
    const json = text.slice(text.indexOf("{"));
    return JSON.parse(json) as SoqlResult<T>;
  }

  /**
   * The MCP tool returns only the first batch and does not follow nextRecordsUrl,
   * so page with an Id cursor. `soqlWithoutOrder` must not contain ORDER BY or LIMIT.
   */
  async queryAll<T extends { Id: string }>(soqlWithoutOrder: string, pageSize = 200): Promise<T[]> {
    const all: T[] = [];
    let lastId: string | null = null;
    const hasWhere = /\bWHERE\b/i.test(soqlWithoutOrder);
    for (;;) {
      const cursor: string = lastId ? `${hasWhere ? " AND" : " WHERE"} Id > '${lastId}'` : "";
      const page: SoqlResult<T> = await this.query<T>(
        `${soqlWithoutOrder}${cursor} ORDER BY Id LIMIT ${pageSize}`,
      );
      all.push(...page.records);
      if (page.records.length < pageSize) return all;
      lastId = page.records[page.records.length - 1]!.Id;
    }
  }
}

export type SfCase = {
  Id: string;
  CaseNumber: string;
  OwnerId: string;
  Subject: string | null;
  Status: string | null;
  Priority: string | null;
  CreatedDate: string;
  Owner: { Name: string } | null;
  /** Operational_Segmentation__c is labelled "Tier Global" in the BMC org. */
  Account: { Name: string; Operational_Segmentation__c: string | null } | null;
  Contact: { Name: string } | null;
  sc_Case_Routed_To_Eng_Y_N__c: boolean | null;
  sc_Case_DateTime_Last_Customer_Contact__c: string | null;
};

export type SfEmail = {
  Id: string;
  ParentId: string;
  FromName: string | null;
  FromAddress: string | null;
  Subject: string | null;
  CreatedDate: string;
  TextBody: string | null;
};

export type SfFeedPost = {
  Id: string;
  ParentId: string;
  Type: string;
  Visibility: string;
  Body: string | null;
  CreatedDate: string;
  CreatedById: string;
  CreatedBy: { Name: string } | null;
};

export type SfUser = { Id: string; UserType: string };

function soqlDateTime(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

function openCaseFilter(): string {
  return `IsClosed = false AND sc_Service_Product_Family__c = '${config.productFamily}'`;
}

export function fetchOpenCases(sf: SalesforceMcp): Promise<SfCase[]> {
  return sf.queryAll<SfCase>(
    `SELECT Id, CaseNumber, OwnerId, Subject, Status, Priority, CreatedDate, Owner.Name, Account.Name, Account.Operational_Segmentation__c, Contact.Name, ` +
      `sc_Case_Routed_To_Eng_Y_N__c, sc_Case_DateTime_Last_Customer_Contact__c ` +
      `FROM Case WHERE ${openCaseFilter()}`,
  );
}

export type SfOwnerManager = { Id: string; Manager: { Name: string } | null };

/** Managers of users who own open Control-M cases (queue owners are not users and have none). */
export function fetchOwnerManagers(sf: SalesforceMcp): Promise<SfOwnerManager[]> {
  return sf.queryAll<SfOwnerManager>(
    `SELECT Id, Manager.Name FROM User WHERE Id IN (SELECT OwnerId FROM Case WHERE ${openCaseFilter()})`,
  );
}

/** Customer-to-BMC emails on open Control-M cases created after `since`. */
export function fetchInboundEmails(sf: SalesforceMcp, since: Date): Promise<SfEmail[]> {
  return sf.queryAll<SfEmail>(
    `SELECT Id, ParentId, FromName, FromAddress, Subject, CreatedDate, TextBody FROM EmailMessage ` +
      `WHERE Incoming = true AND CreatedDate > ${soqlDateTime(since)} ` +
      `AND ParentId IN (SELECT Id FROM Case WHERE ${openCaseFilter()})`,
    100,
  );
}

/** Text posts on open Control-M case feeds (customer portal comments and engineer notes). */
export function fetchFeedPosts(sf: SalesforceMcp, since: Date): Promise<SfFeedPost[]> {
  return sf.queryAll<SfFeedPost>(
    `SELECT Id, ParentId, Type, Visibility, Body, CreatedDate, CreatedById, CreatedBy.Name FROM CaseFeed ` +
      `WHERE Type IN ('TextPost', 'ContentPost') AND CreatedDate > ${soqlDateTime(since)} ` +
      `AND ParentId IN (SELECT Id FROM Case WHERE ${openCaseFilter()})`,
  );
}

export type SfClosedCase = {
  Id: string;
  CaseNumber: string;
  Subject: string | null;
  OwnerId: string;
  Owner: { Name: string } | null;
  ClosedDate: string;
  CreatedDate: string;
  sc_Case_Disposition__c: string | null;
  sc_Root_Cause_1__r: { Name: string; DR__r: { Name: string } | null } | null;
  sc_Root_Cause_2__r: { Name: string } | null;
  sc_Case_Defect_Attached_Y_N__c: boolean | null;
  sc_Case_RFE_Attached_Y_N__c: boolean | null;
  sc_Closed_in_Triage__c: boolean | null;
  Account: { Name: string } | null;
};

/** Control-M cases closed in the last `days` days, with their recorded root cause. */
export function fetchClosedCases(sf: SalesforceMcp, days: number): Promise<SfClosedCase[]> {
  return sf.queryAll<SfClosedCase>(
    `SELECT Id, CaseNumber, Subject, OwnerId, Owner.Name, ClosedDate, CreatedDate, sc_Case_Disposition__c, ` +
      `sc_Root_Cause_1__r.Name, sc_Root_Cause_1__r.DR__r.Name, sc_Root_Cause_2__r.Name, ` +
      `sc_Case_Defect_Attached_Y_N__c, sc_Case_RFE_Attached_Y_N__c, sc_Closed_in_Triage__c, Account.Name ` +
      `FROM Case WHERE IsClosed = true AND sc_Service_Product_Family__c = '${config.productFamily}' ` +
      `AND ClosedDate = LAST_N_DAYS:${days}`,
  );
}

type SubResult<T> = { records: T[] } | null;
export type SfCaseHistory = {
  Id: string;
  Description: string | null;
  EmailMessages: SubResult<{ Id: string; Incoming: boolean; CreatedDate: string; Subject: string | null; TextBody: string | null }>;
  Feeds: SubResult<{ Id: string; Body: string | null; CreatedDate: string; CreatedBy: { Name: string } | null }>;
};

/** Description plus the most recent emails and case feed posts for up to ~20 cases. */
export async function fetchCaseHistory(
  sf: SalesforceMcp,
  caseIds: string[],
  emails: number,
  notes: number,
): Promise<SfCaseHistory[]> {
  const found: SfCaseHistory[] = [];
  let remaining = caseIds;
  // Salesforce shrinks the first batch when subqueries return large bodies, and the MCP tool
  // does not follow nextRecordsUrl, so re-query whatever was left out.
  while (remaining.length) {
    const ids = remaining.map((id) => `'${id}'`).join(",");
    const page = await sf.query<SfCaseHistory>(
      `SELECT Id, Description, ` +
        `(SELECT Id, Incoming, CreatedDate, Subject, TextBody FROM EmailMessages ORDER BY CreatedDate DESC LIMIT ${emails}), ` +
        `(SELECT Id, Body, CreatedDate, CreatedBy.Name FROM Feeds WHERE Type = 'TextPost' ORDER BY CreatedDate DESC LIMIT ${notes}) ` +
        `FROM Case WHERE Id IN (${ids})`,
    );
    if (!page.records.length) break;
    found.push(...page.records);
    const got = new Set(page.records.map((r) => r.Id));
    remaining = remaining.filter((id) => !got.has(id));
  }
  return found;
}

export type SfUserManager = { Id: string; Manager: { Name: string } | null };

export async function fetchUserManagers(sf: SalesforceMcp, userIds: string[]): Promise<SfUserManager[]> {
  const users: SfUserManager[] = [];
  for (let i = 0; i < userIds.length; i += 200) {
    const ids = userIds.slice(i, i + 200).map((id) => `'${id}'`).join(",");
    const page = await sf.query<SfUserManager>(`SELECT Id, Manager.Name FROM User WHERE Id IN (${ids})`);
    users.push(...page.records);
  }
  return users;
}

export async function fetchUserTypes(sf: SalesforceMcp, userIds: string[]): Promise<SfUser[]> {
  const users: SfUser[] = [];
  for (let i = 0; i < userIds.length; i += 200) {
    const ids = userIds.slice(i, i + 200).map((id) => `'${id}'`).join(",");
    const page = await sf.query<SfUser>(`SELECT Id, UserType FROM User WHERE Id IN (${ids})`);
    users.push(...page.records);
  }
  return users;
}
