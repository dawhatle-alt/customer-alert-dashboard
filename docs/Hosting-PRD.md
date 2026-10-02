# PRD: Hosting the Control-M Support Dashboard

| | |
|---|---|
| **Document owner** | _[Name]_, Control-M Support |
| **Audience** | BMC IT (Infrastructure, Salesforce Platform, Information Security), Support management |
| **Status** | Draft for review and approval |
| **Date** | October 1, 2026 |

---

## 1. Summary

The Control-M Support Dashboard is an internal tool that reads Control-M cases from Salesforce and uses an AI model (TypeSafe Jev) to:

- flag open cases where the customer may be upset or dissatisfied,
- show case workload by engineer and manager, and
- check how accurately Root Cause 1 and Root Cause 2 were recorded on closed cases, against the Root Cause Best Practices guide.

Today it runs only on one engineer's laptop, using that engineer's personal Salesforce login. Nobody else can open it, and it stops whenever the laptop is off.

**We are asking for approval and help to host it on a BMC internal server**, so that support engineers and managers can open it in a browser and sign in with their own Salesforce account. That is the same BMC sign-in they already use for Salesforce and the Salesforce CLI.

**What is needed:**

1. **Salesforce Platform team:** register the dashboard as a Connected App, and create a read-only integration user.
2. **IT Infrastructure:** one small internal Linux server or container with HTTPS and a DNS name.
3. **Information Security / Privacy:** review of the data flow, in particular the case text sent to TypeSafe for analysis.
4. **Management:** approval of the above, the running cost (estimated under $5 per month for AI usage, plus the server), and agreement on how the root cause rankings may be used.

The application is read-only. It never creates, changes or deletes Salesforce records.

---

## 2. Background

### 2.1 What the application does

The dashboard has three tabs.

| Tab | What it shows | Who uses it |
|---|---|---|
| **Customer alert** | Open Control-M cases where the customer may be upset: frustrated tone, escalation requests, complaints about slow response, relationship threats, and so on. It shows the reason for each flag and the customer's own words as evidence. Each manager's list can be exported as an email-ready daily report or a spreadsheet. | Engineers, team leads, managers |
| **Case workload** | Open case counts per engineer and manager, matching the existing manager workload report. | Managers |
| **Root cause accuracy** | For every Control-M case closed in the last 30 days, whether the recorded Root Cause 1 and 2 match what the Root Cause Best Practices guide would choose. Results are ranked per engineer (TSA), with a case-by-case explanation. | Managers, quality leads |

Data refreshes automatically every 30 minutes.

### 2.2 How it works today

```
 Engineer's laptop
 ┌──────────────────────────────────────────────────────────┐
 │  Dashboard server (Node.js)  ── every 30 min ──┐         │
 │        │                                       │         │
 │        │ Salesforce CLI login (personal)       │         │
 │        ▼                                       ▼         │
 │  Salesforce MCP tool ──► BMC Salesforce   TypeSafe Jev   │
 │                         (read-only)       (AI analysis)  │
 │  Browser ──► http://localhost:3000                       │
 └──────────────────────────────────────────────────────────┘
```

Measured on the current version:

- About 900 open Control-M cases are read each cycle, about 770 of them with recent activity.
- About 2,850 Control-M cases closed in the last 30 days are assessed for root cause accuracy.
- A full re-analysis of every case costs about $0.80 in AI usage and takes about 3 minutes. A normal 30-minute refresh only analyzes cases with new activity, and takes seconds and fractions of a cent.

### 2.3 Why it needs to be hosted

| Problem today | Effect |
|---|---|
| Runs only on one laptop | Nobody else can see it. It stops when the laptop sleeps, restarts or leaves the VPN. |
| Uses one person's Salesforce login | Everything is pulled under that person's identity. This doesn't scale, and it isn't appropriate for a shared tool. |
| No sign-in on the dashboard | It can't safely be opened to other people as it is. |
| Each person would have to run their own copy | Duplicated AI cost and setup effort, and inconsistent numbers between managers. |

---

## 3. Goals and non-goals

### Goals

1. Support staff and managers open the dashboard at one internal web address, for example `https://controlm-dashboard.bmc.com`.
2. Users sign in with their **own Salesforce account** through the normal BMC Salesforce sign-in, including single sign-on. No new password is created.
3. Only approved Salesforce users can open it, for example Control-M support profiles and managers.
4. Data refreshes every 30 minutes without anyone being logged in.
5. No personal credentials are stored on the server.
6. Everyone sees the same numbers.

### Non-goals

- Writing anything back to Salesforce. The tool stays read-only.
- Access from outside the BMC network. It is internal and VPN-only.
- Replacing Salesforce reports or dashboards.
- Using the root cause rankings as a performance-review metric without a human checking the cases (see section 10).

---

## 4. Users and access

| Group | Access | Approx. size |
|---|---|---|
| Control-M support engineers (TSAs) | All three tabs | ~75 |
| Team leads and managers | All three tabs | ~10–15 |
| Others (by request) | Granted through Salesforce permission set | — |

Access is controlled in Salesforce, not in the application. A user can sign in only if the Salesforce admin has given their profile or permission set access to the Connected App. Adding or removing someone is the same as any other Salesforce access change.

---

## 5. Proposed solution

### 5.1 Target design

```
                          BMC internal network / VPN only
 ┌───────────┐  HTTPS   ┌────────────────────────────────────────────┐
 │  Browser  │ ───────► │  Reverse proxy / load balancer (TLS)       │
 └───────────┘          └───────────────────┬────────────────────────┘
       │                                    ▼
       │ 1. "Sign in with Salesforce"   ┌──────────────────────────────┐
       ▼                                │  Dashboard server (Node.js)  │
 ┌──────────────────┐ 2. login code ──► │  - checks the user's session │
 │ BMC Salesforce   │                   │  - serves the dashboard      │
 │ login / SSO      │                   │  - 30-minute background job  │
 └──────────────────┘                   └───────┬───────────────┬──────┘
                                                │ read-only     │ case text
                         3. integration user    ▼               ▼
                            (certificate)  ┌──────────┐   ┌──────────────┐
                                           │Salesforce│   │ TypeSafe Jev │
                                           │ REST API │   │ (AI service) │
                                           └──────────┘   └──────────────┘
                                                │
                                         ┌──────▼──────┐
                                         │ Data volume │  cached results
                                         └─────────────┘
```

### 5.2 How sign-in works

1. The user opens the dashboard and is sent to the normal BMC Salesforce sign-in page, with SSO where it is enabled.
2. Salesforce checks that the user is allowed to use the Connected App, then sends them back to the dashboard with a one-time code.
3. The dashboard confirms the user's identity with Salesforce and starts a session. The session lasts 8 hours by default and is stored in a secure, HTTP-only cookie.
4. The dashboard asks Salesforce **only for the user's identity**. It does not request permission to read data as that user.

**Why not use the Salesforce CLI login directly?** The Salesforce CLI saves its login on each person's own computer. A server can't read or reuse it, and it shouldn't. The user signs in with the same Salesforce account that their CLI uses, through the standard and supported OAuth 2.0 sign-in for web applications, which Salesforce calls the "web server flow". This is the same sign-in page `sf org login web` opens.

### 5.3 How data is refreshed (recommended: Option A)

The 30-minute refresh runs when nobody is signed in, so it needs a credential of its own. There are two ways to do this.

| | **Option A: Integration user (recommended)** | Option B: Each user's own login |
|---|---|---|
| How it works | A dedicated, read-only Salesforce integration user runs the 30-minute refresh. Signed-in users see the shared results. | Each user's refresh runs with their own saved Salesforce login. Each user has separate results. |
| What users see | The same data for everyone, limited to Control-M case data | Only what their own Salesforce permissions allow |
| Credentials on the server | One certificate-based integration login, with no password | A saved login token for every user |
| AI cost | Analysis runs once for everybody | Analysis runs once per user, so about 75–90 times the cost |
| Consistency | Every manager sees the same numbers | Numbers can differ between users |
| Build effort | Lower | Higher (per-user storage, token encryption, per-user scheduling) |

**Why Option A:** it is simpler, cheaper and easier to secure, and it gives everyone one consistent set of numbers. The trade-off is that every approved user sees the same Control-M case data. That is acceptable because access is limited to Control-M support staff, who already work these cases in Salesforce. Clicking a case in the dashboard opens it in Salesforce under the user's own login, so Salesforce's normal record security still applies there.

### 5.4 Change from today: connecting to Salesforce directly

Today the app reaches Salesforce through the Salesforce MCP tool, which relies on a locally saved CLI login. The hosted version will call the **Salesforce REST API** directly, using the integration user. This:

- removes the need for the Salesforce CLI and any personal login on the server,
- uses Salesforce's normal paging, which is more reliable than the workaround the MCP tool needed, and
- leaves the queries, and the data read, unchanged (see Appendix A).

---

## 6. Requirements

### 6.1 Functional

| ID | Requirement |
|---|---|
| F1 | Users sign in with their Salesforce account through OAuth 2.0 (web server flow with PKCE). |
| F2 | Users who aren't approved for the Connected App can't sign in. |
| F3 | Every page and data request requires a valid session; anything else is sent to sign-in. |
| F4 | Users can sign out, and sessions expire after 8 hours. |
| F5 | The 30-minute refresh runs under the integration user, with nobody signed in. |
| F6 | "Run check now" is available to signed-in users, and only one refresh can run at a time. |
| F7 | All three existing tabs behave the same as today. |
| F8 | A health-check address (`/api/health`) reports whether the server, the Salesforce connection and the last refresh are healthy, for monitoring. |

### 6.2 Security

| ID | Requirement | Why |
|---|---|---|
| S1 | HTTPS only, through the BMC reverse proxy or load balancer, with a BMC-issued certificate. | Protects sessions and case data in transit. |
| S2 | Reachable only from the BMC network and VPN, never the public internet. | The tool shows customer case data. |
| S3 | Integration user signs in with the OAuth 2.0 JWT bearer flow (certificate), not a password. | No password to leak or rotate. The certificate can be revoked at any time. |
| S4 | Integration user is read-only, limited to the objects and fields in Appendix A, and uses a Salesforce Integration license where available. | Least privilege. |
| S5 | Secrets (TypeSafe key, Connected App ID and secret, certificate private key, session secret) live in the BMC secrets store, not in files or code. | Standard secret handling. |
| S6 | Session cookies are Secure, HttpOnly and SameSite=Lax. | Prevents session theft and cross-site request forgery. |
| S7 | Logs record sign-ins, sign-outs and refresh results, but never case text, email bodies or tokens. | Audit trail without copying customer data into logs. |
| S8 | No data is written back to Salesforce. | Read-only by design. |

### 6.3 Operational

| ID | Requirement |
|---|---|
| O1 | One running instance only. Two instances would run duplicate AI analysis and conflict on the data files. |
| O2 | Restarts automatically after a crash or reboot (container restart policy or systemd). |
| O3 | Business-hours availability is enough. Brief outages are acceptable, because the dashboard shows the last results when it comes back. |
| O4 | Data volume backups are optional. All data can be rebuilt from Salesforce in about 5 minutes, for about $0.80 of AI usage. |
| O5 | Deployments come from a version-controlled repository. |

---

## 7. What we need from each team, and why

### 7.1 Salesforce Platform team

| # | Request | Why it is needed |
|---|---|---|
| SF1 | **Create a Connected App** (External Client App) named "Control-M Support Dashboard": OAuth enabled, callback URL `https://<dashboard-host>/oauth/callback`, scopes `openid` only, PKCE required, refresh tokens off for user sign-in. | Lets users sign in with their Salesforce account. Requesting only `openid` means the dashboard learns who the user is, but can't read data as them. |
| SF2 | **Set "Admin approved users are pre-authorized"** and assign the Control-M support profiles or a new permission set, such as "Control-M Dashboard Access". | Controls who can open the dashboard. Access changes stay inside Salesforce. |
| SF3 | **Create a read-only integration user**, with a Salesforce Integration license if available and API Enabled, plus read access to the objects and fields in Appendix A. It must be able to see all Control-M cases. | Runs the 30-minute refresh without anyone's personal login. |
| SF4 | **Enable the JWT bearer flow for the integration user** on the Connected App, or a second app for server use, and upload the certificate we provide. | Lets the server sign in as the integration user without a password. |
| SF5 | **Provide** the Connected App's consumer key, the integration username, and the My Domain login URL (`https://bmcapps.my.salesforce.com`). | Needed to configure the server. |
| SF6 | **Confirm API usage is acceptable.** Estimated at a few thousand API calls per day (about 50–100 per refresh, 48 refreshes per day), far below normal org limits. | Avoids surprises on org API limits. |

Estimated admin effort: 2–4 hours.

### 7.2 IT Infrastructure

| # | Request | Why it is needed |
|---|---|---|
| IT1 | **One Linux VM or container**: 2 vCPU, 4 GB RAM, 20 GB disk, Node.js 24 LTS (or Docker, where we supply the image). | Runs the dashboard and the 30-minute background job. The load is light: mostly waiting on Salesforce and the AI service. |
| IT2 | **Persistent storage** of at least 1 GB, mounted for the `data/` folder. Current size is about 10 MB. | Keeps cached results across restarts, so the dashboard doesn't have to re-analyze every case each time. |
| IT3 | **Internal DNS name and TLS certificate**, for example `controlm-dashboard.bmc.com`, behind the standard reverse proxy or load balancer. | HTTPS is required for secure sign-in, and Salesforce requires an HTTPS callback address. |
| IT4 | **Network rules.** Inbound: HTTPS (443) from the BMC network and VPN only. Outbound: HTTPS (443) to `bmcapps.my.salesforce.com` and `api.typesafe.ai`. | Users reach the dashboard, and the server reaches Salesforce and the AI service. Nothing else is needed. |
| IT5 | **Secrets store access** (e.g. Vault or Azure Key Vault) for 5 secrets. | Keeps credentials out of files and code (S5). |
| IT6 | **Monitoring** of `/api/health`, with an alert to the owner if it fails for more than 1 hour. | Spots failed refreshes or expired credentials early. |
| IT7 | **Process supervision**: restart on failure and on boot. | Keeps the dashboard available without manual restarts. |

### 7.3 Information Security, Privacy and Legal

| # | Request | Why it is needed |
|---|---|---|
| SEC1 | **Review of sending case text to TypeSafe** (`api.typesafe.ai`), an outside AI service. See section 8.2 for exactly what is sent. | Case text contains customer communications and may include names, email addresses and system details. |
| SEC2 | **Vendor review of TypeSafe**: data processing agreement, data retention, whether data is used for model training, hosting region. | Needed before customer data goes to any third-party AI service. |
| SEC3 | **Review of this design** against BMC internal application standards. | Confirms sign-in, secrets and network exposure meet policy. |

### 7.4 Management

| # | Decision | Why it is needed |
|---|---|---|
| M1 | Approve hosting and the access model (Option A, section 5.3). | Sets who sees what. |
| M2 | Approve the running cost (section 9), and move the TypeSafe API key to a BMC-owned account. | The current key is not tied to a BMC business account. |
| M3 | Agree how root cause rankings may be used (section 10). | The rankings come from AI judgment and need guidance on fair use. |
| M4 | Name a business owner and a technical owner. | Someone has to own access requests, issues and updates. |

---

## 8. Data handling

### 8.1 Data read from Salesforce

Read-only. Limited to cases where the R&D Product Family is CONTROL-M. The full field list is in Appendix A.

| Data | Used for |
|---|---|
| Case details (number, subject, status, priority, owner, dates, routed to engineering) | All tabs |
| Account name and Tier Global | Sentiment and workload filters |
| Contact name | Sentiment display |
| Inbound customer emails (last 14 days, open cases) | Sentiment analysis |
| Case feed posts: portal comments and engineer notes | Sentiment and root cause analysis |
| Problem description, last 8 emails and last 6 notes (closed cases, last 30 days) | Root cause analysis |
| Root Cause 1, Root Cause 2, disposition, product, defect/RFE attached, closed in triage | Root cause accuracy |
| User manager and user type | Grouping by manager, and telling customer posts from BMC posts |

### 8.2 Data sent to TypeSafe Jev (AI analysis)

| Sent | Not sent |
|---|---|
| Case subject and product | Customer contact email addresses or phone fields from the Case or Contact |
| Problem description (trimmed to 2,500 characters) | Attachments or files |
| Recent email and note text, trimmed and cleaned: quoted reply chains, BMC footers, legal disclaimers and auto-replies are removed. At most 6–8 emails and 4–6 notes per case, each trimmed to 800–1,500 characters. | Recorded Root Cause values (kept back on purpose, so the AI judges independently) |
| Dates, disposition, and defect/RFE flags | Account financial or contract data |

Email and note text can still contain names, signatures and system details written by customers or engineers. That is why the vendor review (SEC1, SEC2) is required.

Jev returns **only probabilities and choices**, for example "84% likely the customer is asking to escalate". It doesn't return generated text, so the quotes shown on the dashboard are always the customer's real words, taken from Salesforce.

### 8.3 Data stored on the server

| Stored | Retention |
|---|---|
| Cached case details, message excerpts and AI answers (`data/store.json`) | Rolling: open cases plus 14 days of activity. Closed cases drop out automatically. |
| Root cause results (`data/rootcause.json`) | Rolling 30-day window of closed cases |
| Sign-in sessions | In memory, expire after 8 hours |
| Logs | Per BMC log retention policy, with no case text |

All stored data can be deleted at any time and rebuilt from Salesforce.

---

## 9. Cost

| Item | Estimate | Basis |
|---|---|---|
| TypeSafe Jev usage | **Under $5 per month** | $0.042 per million input tokens (TypeSafe list price). Measured: a full re-analysis of every case is about 19M tokens (about $0.80). Normal refreshes analyze only cases with new activity: about 95 closed cases per day for root cause and a few changed open cases per refresh for sentiment, roughly 1–2M tokens per day. |
| Server | Per IT standard internal rate | 2 vCPU, 4 GB RAM, 20 GB disk |
| Salesforce | No additional cost expected | Uses an existing integration license if one is available. Otherwise one Salesforce Integration license. |
| Development | About 1–1.5 weeks of one engineer | Section 11 |

---

## 10. Responsible use of AI results

- **Sentiment flags** are an early-warning aid. They tell a manager which cases to look at first, and they don't replace reading the case.
- **Root cause accuracy** compares what was recorded with what the AI thinks the guide would choose. It has assessed about 2,600 recently closed cases so far. It is a **second opinion, not ground truth**. Review of individual cases showed it can be misled by thin case notes, by key analysis cut off by the text trimming, or by a case that turns into a different problem partway through.
- **Recommendation:** use the root cause tab for coaching and quality review. Before any ranking is used in a formal performance discussion, a manager should open and check the flagged cases. The dashboard already shows, for each case, what was recorded, what the AI suggests and why, so this check is quick.
- Thresholds and AI questions are visible in the code and can be tuned with the support leadership team.

---

## 11. Development work (once approved)

| Work item | Effort |
|---|---|
| Replace the Salesforce MCP tool with a direct Salesforce REST API client (same queries) | 1 day |
| Integration user sign-in (JWT bearer flow with certificate) | 0.5 day |
| User sign-in with Salesforce (OAuth web server flow with PKCE), sessions, sign-out, and protecting every page | 1.5 days |
| Health check, structured logging (no case text), configuration through the secrets store, single-instance guard | 1 day |
| Container image and deployment instructions for IT | 0.5 day |
| Testing, plus a pilot with 5–10 users | 1–2 days |
| **Total** | **About 5.5–6.5 working days** |

---

## 12. Rollout plan

| Phase | What happens | Depends on |
|---|---|---|
| 1. Approval | Management approves; Security and Privacy review starts | This document |
| 2. Salesforce setup | Connected App, permission set, integration user (SF1–SF6) | Phase 1 |
| 3. Build | App changes (section 11), tested locally against Salesforce | Phase 2 (consumer key, integration user) |
| 4. Infrastructure | VM or container, DNS, TLS, network rules, secrets (IT1–IT7) | Phase 1; can run alongside phase 3 |
| 5. Pilot | 5–10 engineers and managers use it for 2 weeks | Phases 3 and 4, plus Security sign-off |
| 6. Rollout | Permission set given to all Control-M support staff | Pilot feedback |

The longest step is likely to be the Security and vendor review (SEC1–SEC2), so it should start as soon as this document is approved.

---

## 13. Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Customer text sent to an outside AI service | Privacy or contractual exposure | Vendor review before go-live. Text is trimmed and cleaned. Only the minimum needed is sent. |
| Every approved user sees all Control-M case data (Option A) | Wider visibility than an individual's own Salesforce permissions might allow | Access limited by Salesforce permission set to Control-M support staff, who already work these cases. |
| AI judgment is wrong for some cases | Unfair conclusions about an engineer | Section 10 guidance. Every result shows its reasons and links to the case. |
| Integration certificate expires or is revoked | Refreshes stop; dashboard shows stale data | Health-check alert (IT6). The "Updated" time is shown on every tab. |
| TypeSafe service unavailable | Refresh fails | Dashboard keeps showing the last results and retries at the next refresh. |
| Salesforce field or picklist changes, for example new root cause values | Some cases scored wrongly | Unknown root cause values are reported as "not in guide", not scored silently. Owner reviews after Salesforce releases. |
| Single server | Outage until restart | Automatic restart. Data can be rebuilt in minutes. Business-hours tool. |

---

## 14. Open questions

1. Confirm Option A (integration user) as the access model.
2. Which Salesforce profiles or permission sets should have access? Support only, or also Engineering and Customer Success?
3. Is a Salesforce Integration user license available, or does one need to be bought?
4. Preferred hosting platform: VM, internal Kubernetes, or another standard?
5. Who owns the TypeSafe business account and contract?
6. May engineers see their own root cause results, or only managers?

---

## 15. Approvals

| Role | Name | Decision | Date |
|---|---|---|---|
| Support management (business owner) | | | |
| IT Infrastructure | | | |
| Salesforce Platform | | | |
| Information Security | | | |
| Privacy / Legal | | | |

---

## Appendix A: Salesforce objects and fields read

All access is read-only (SOQL queries). Case queries are filtered on `sc_Service_Product_Family__c = 'CONTROL-M'`.

| Object | Fields |
|---|---|
| **Case** | Id, CaseNumber, Subject, Description, Status, Priority, CreatedDate, ClosedDate, IsClosed, OwnerId, Owner.Name, sc_Service_Product_Family__c, sc_Case_Routed_To_Eng_Y_N__c, sc_Case_DateTime_Last_Customer_Contact__c, sc_Case_Disposition__c, sc_Root_Cause_1__c, sc_Root_Cause_2__c, sc_Case_Defect_Attached_Y_N__c, sc_Case_RFE_Attached_Y_N__c, sc_Closed_in_Triage__c |
| **DR Root Cause** (object behind `sc_Root_Cause_1__c` / `sc_Root_Cause_2__c`) | Name, DR__r.Name (product) |
| **Account** | Name, Operational_Segmentation__c ("Tier Global") |
| **Contact** | Name |
| **User** | Id, UserType, Manager.Name |
| **EmailMessage** | Id, ParentId, Incoming, FromName, FromAddress, Subject, CreatedDate, TextBody |
| **CaseFeed / FeedItem** | Id, ParentId, Type, Visibility, Body, CreatedDate, CreatedById, CreatedBy.Name |

## Appendix B: Server configuration

| Setting | Purpose | Source |
|---|---|---|
| `TYPESAFE_API_KEY` | AI service key | Secrets store |
| `SF_LOGIN_URL` | `https://bmcapps.my.salesforce.com` | Config |
| `SF_CLIENT_ID` / `SF_CLIENT_SECRET` | Connected App credentials for user sign-in | Secrets store |
| `SF_INTEGRATION_USERNAME` | Integration user for the 30-minute refresh | Config |
| `SF_JWT_PRIVATE_KEY` | Certificate private key for the integration user | Secrets store |
| `SESSION_SECRET` | Signs session cookies | Secrets store |
| `PUBLIC_URL` | e.g. `https://controlm-dashboard.bmc.com` (used for the sign-in callback) | Config |
| `CHECK_INTERVAL_MINUTES` | Refresh interval (default 30) | Config |
| `LOOKBACK_DAYS` | Sentiment look-back window (default 14) | Config |
| `RC_WINDOW_DAYS` | Root cause window (default 30) | Config |

## Appendix C: Network endpoints

| Direction | Endpoint | Port | Purpose |
|---|---|---|---|
| Inbound | Dashboard host (BMC network and VPN only) | 443 | Users |
| Outbound | `bmcapps.my.salesforce.com` | 443 | Sign-in and Salesforce REST API |
| Outbound | `api.typesafe.ai` | 443 | AI analysis |
