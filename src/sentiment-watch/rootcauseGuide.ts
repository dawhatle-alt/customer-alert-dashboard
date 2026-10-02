/**
 * Root cause categories from "Root Cause Best Practices.pdf" (Control-M support).
 * `match` recognises how each category is named in the org's DR Root Cause records,
 * which abbreviate some labels (e.g. "Component (Webserver,GSR,…)", "HA/DR/Cluster").
 */

export type Rc2Category = { id: string; label: string; description: string; match: RegExp };
export type Rc1Category = { id: Rc1Id; label: string; description: string; match: RegExp; rc2: Rc2Category[] };
export type Rc1Id = "install" | "productIssue" | "environment" | "productUsage" | "void";

const customerAbandoned = (cause: string): Rc2Category => ({
  id: "customerAbandoned",
  label: "Customer Abandoned",
  description: `The issue is believed to be related to ${cause}, but the customer stops responding or does not wish to continue. If the cause is understood, the appropriate specific category is used instead.`,
  match: /^customer abandoned/i,
});
const selfResolved = (cause: string): Rc2Category => ({
  id: "selfResolved",
  label: "Problem Self-Resolved",
  description: `The issue, believed to be caused by ${cause}, resolved itself without any obvious intervention.`,
  match: /^problem self.?resolved/i,
});
const jobScheduling: Rc2Category = {
  id: "jobScheduling",
  label: "Job Scheduling/Calendars",
  description: "Job scheduling issues outside of ctmrpln, ctmudly and New Day, including Workload Policies, Events, and calendars.",
  match: /^job scheduling/i,
};
const utilities = (how: string): Rc2Category => ({
  id: "utilities",
  label: "Utilities (FW, HCU, Backup, Restore, udly, rpln etc)",
  description: how,
  match: /^utilities \(fw/i,
});
const reporting = (description: string): Rc2Category => ({ id: "reporting", label: "Reporting", description, match: /^reporting/i });
const unsure: Rc2Category = {
  id: "unsure",
  label: "zUnsure-Follow Up Needed",
  description: "The engineer was unsure which RC2 category to use; flagged for management follow-up.",
  match: /^zunsure/i,
};

export const RC1_CATEGORIES: Rc1Category[] = [
  {
    id: "install",
    label: "Install/Upgrade/Rehost/Migration",
    description:
      "AMIGO activities, or an issue that arose from the customer performing an install, upgrade, rehost, or migration shortly before the issue (as far back as two weeks earlier). Takes priority over Product Issue, Environment, and Product Usage.",
    match: /^install\/upgrade\/rehost\/migration$/i,
    rc2: [
      { id: "amigoReview", label: "AMIGO Review", description: "An AMIGO Review case, not a technical issue reported by the customer.", match: /^amigo review/i },
      { id: "amigoStarter", label: "AMIGO Starter", description: "An AMIGO Starter case, not a technical issue reported by the customer.", match: /^amigo starter/i },
      { id: "compatibility", label: "Compatibility", description: "Compatibility issues such as OS, SSL, database, Java, or .NET versions. Sizing issues belong under System Requirements.", match: /^compatibility/i },
      customerAbandoned("an installation, upgrade, rehost, or migration"),
      jobScheduling,
      selfResolved("an installation, upgrade, rehost, or migration"),
      { id: "productIssue", label: "Product Issue", description: "The product did not work as expected after the install/upgrade and a defect was raised to track it (for example an installer or migration utility bug).", match: /^product issue/i },
      { id: "productUsage", label: "Product Usage", description: "Caused by the customer's usage after the install/upgrade, e.g. not following documented installation steps, lack of knowledge, or poor practices.", match: /^product usage/i },
      reporting("Product-related reporting issues after an install/upgrade."),
      { id: "systemRequirements", label: "System Requirements", description: "System resources (RAM, CPU, disk I/O, OS level) do not meet the software's requirements after the install/upgrade.", match: /^system requirements/i },
      { id: "uninstall", label: "Uninstall", description: "An uninstall failed or is causing the underlying issue.", match: /^uninstall/i },
      utilities("Control-M utilities (FW, HCU, backup, restore, udly, rpln, migration toolkit) involved in the install/upgrade/rehost/migration."),
      unsure,
    ],
  },
  {
    id: "productIssue",
    label: "Product Issue",
    description:
      "Caused by something BMC provided, such as documentation, software, or database, and not caused by a recent install, upgrade, rehost, or migration.",
    match: /^product issue$/i,
    rc2: [
      { id: "connectionProfiles", label: "Connection Profiles", description: "Issues with connection profiles (accessibility, corruption, quantity, validation).", match: /^connection profiles/i },
      { id: "component", label: "Control-M Component (Webserver, GSR, GTW, CE, ATW, Plugin, etc)", description: "A Control-M component such as the Postgres database, Web Server, Gateway, Configuration Agent, Agent Tracker, GUI client, or SSL layer.", match: /^(control-m )?component/i },
      customerAbandoned("a product issue"),
      { id: "dataIntegrity", label: "Data Integrity/Corruption", description: "Corruption of a file, database, or installation is the cause.", match: /^data integrity/i },
      { id: "documentation", label: "Documentation", description: "A problem with BMC documentation.", match: /^documentation/i },
      { id: "graphical", label: "Graphical/Display", description: "GUI or web client appearance issues.", match: /^graphical/i },
      { id: "haDr", label: "High Availability/Disaster Recovery/Cluster", description: "Product issues with High Availability, Disaster Recovery, or clustering.", match: /^(ha\/dr|high availability)/i },
      jobScheduling,
      { id: "microservices", label: "Microservices", description: "A Control-M microservice such as Kafka, Zookeeper, or the Schedule Service.", match: /^microservices/i },
      selfResolved("a product issue"),
      reporting("Product-related reporting issues."),
      utilities("Control-M utilities."),
      { id: "vulnerability", label: "Vulnerability/Security", description: "Vulnerabilities (CVEs, security scan findings) in BMC software or the components it ships such as bundled Tomcat, Java, or Log4j, problems with its security settings, or user authorizations. Applies even when the fix is to upgrade or patch.", match: /^vulnerability/i },
      unsure,
    ],
  },
  {
    id: "environment",
    label: "Environment",
    description:
      "The problem originates in the customer's environment, such as the OS, network, database, or third-party software. If there was a recent install/upgrade/rehost/migration, that is chosen instead.",
    match: /^environment$/i,
    rc2: [
      customerAbandoned("the environment"),
      { id: "dbPerformance", label: "Database Performance", description: "The customer's existing database has performance issues.", match: /^database performance/i },
      { id: "dbProblem", label: "Database Problem", description: "The customer's existing database has an issue, e.g. not running or read-only.", match: /^database problem/i },
      { id: "network", label: "Network (DNS, Firewall, Performance, etc)", description: "Network-related causes such as firewall, DNS, or response time.", match: /^network/i },
      { id: "os", label: "Operating System", description: "The underlying OS (compatibility, patch level). After an install/upgrade, Install/Upgrade > System Requirements is used instead.", match: /^operating system/i },
      selfResolved("the environment"),
      { id: "security", label: "Security (SSL, SSH, AntiVirus, etc.)", description: "Control-M impacted by port scanners, anti-virus, incorrect ciphers, Dynatrace, or similar security tooling.", match: /^security \(ssl, ?ssh/i },
      { id: "systemPerformance", label: "System Performance (CPU, Disk, RAM, etc.)", description: "The environment does not meet minimum requirements or is not configured for the customer's load (not after an upgrade).", match: /^system performance/i },
      { id: "thirdParty", label: "Third Party Product", description: "Third-party software such as Java, .NET, SAP, or PeopleSoft is the root cause.", match: /^third party product \(java/i },
      { id: "userAuth", label: "User Authentication (SAML, LDAP, AD, SSO, etc)", description: "The customer's authentication mechanism (LDAP, Active Directory, SSO, SAML) is misconfigured.", match: /^user authentication/i },
      unsure,
    ],
  },
  {
    id: "productUsage",
    label: "Product Usage",
    description:
      "Caused by how the customer uses the software, such as How-To questions, lack of knowledge, or poor practices.",
    match: /^product usage$/i,
    rc2: [
      { id: "configuration", label: "Control-M Configuration", description: "The customer's configuration of the software caused the issue, due to lack of knowledge or best practices.", match: /^control-m configuration/i },
      { id: "conversion", label: "Conversion", description: "Incorrect use of the Conversion tool.", match: /^conversion/i },
      customerAbandoned("product usage"),
      { id: "haDr", label: "High Availability/Disaster Recovery/Cluster", description: "Caused by the customer's implementation of their HA, DR, or cluster solution.", match: /^(ha\/dr|high availability)/i },
      jobScheduling,
      { id: "newFunctionality", label: "New Functionality/Site Specific Request", description: "Requests for enhancements.", match: /^new functionality/i },
      selfResolved("product usage"),
      reporting("Incorrect use of the Usage Reporting Tool or the reporting feature."),
      { id: "sslSetup", label: "SSL Setup", description: "Incorrect SSL setup that is not in line with BMC's supported methodology.", match: /^ssl setup/i },
      { id: "userSecurity", label: "User Security/Authorization Mgmt", description: "Incorrect definition of security criteria in the product (SSL, certificates, LDAP, SSO, authorizations).", match: /^user security/i },
      utilities("Incorrect use of Control-M utilities (FW, HCU, backup, restore, udly, rpln)."),
      unsure,
    ],
  },
  {
    id: "void",
    label: "Void",
    description:
      "Non-technical or duplicate cases: an existing case already covers the same issue, the customer is referred to GCC, the Account Manager, or Renewals, or the customer solved it before BMC did anything.",
    match: /^void$/i,
    rc2: [],
  },
];

/**
 * Mainframe products still use the older RC tree (e.g. "Installation/Customization/Upgrade/Maintenance/PTF's/Patches",
 * "IOAGATE/EM connectivity"), which the guide does not cover, so their cases are not assessed.
 */
export const OTHER_RC_TREE_PRODUCTS = /z\/OS|^IOA$|^INCONTROL|^Control-D\b|^Control-O$|^Control-M\/Tape$|^Control-M\/Analyzer$/i;

export const RC1_BY_ID = Object.fromEntries(RC1_CATEGORIES.map((c) => [c.id, c])) as Record<Rc1Id, Rc1Category>;

export function matchRc1(name: string | null): Rc1Category | null {
  if (!name) return null;
  return RC1_CATEGORIES.find((c) => c.match.test(name.trim())) ?? null;
}

export function matchRc2(rc1: Rc1Category | null, name: string | null): Rc2Category | null {
  if (!rc1 || !name) return null;
  return rc1.rc2.find((c) => c.match.test(name.trim())) ?? null;
}

export const RC1_ORDER_NOTE =
  "A root cause is the underlying reason for the problem, not the symptom and not the solution. " +
  "Consider the categories in this order and choose the first one that applies: " +
  "Install/Upgrade/Rehost/Migration (the problem started after an install, upgrade, rehost, or migration up to about two weeks earlier, or it is an AMIGO activity), " +
  "then Product Issue, then Environment, then Product Usage, and only then Void. " +
  "An install or upgrade counts only if the customer performed it before the problem started and the problem arose from it; " +
  "an upgrade, patch, or fix pack recommended or applied as the solution does not count.";

export const ORIGINAL_PROBLEM_NOTE =
  "Judge the problem the customer originally reported in `case.subject` and `problem_description`; " +
  "side topics raised later in the same case do not change its root cause.";
