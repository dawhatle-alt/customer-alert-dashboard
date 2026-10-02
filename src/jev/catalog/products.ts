/**
 * LP / DR option catalogs for Jev `choice` criteria.
 *
 * IMPORTANT: Keys and descriptions must be replaced with the official
 * Service Cloud LP/DR picklist values before production. Placeholder
 * Integration Factory LP/DR from the Best Practices doc remain TBD (PRD §12).
 *
 * Choice option count limit: 1–255. Prefer the production picklist subset
 * that dispatch actually routes (SME products), not every historical LP.
 */

export type LpCatalog = Record<string, string>;
export type DrByLp = Record<string, Record<string, string>>;

/**
 * Illustrative Control-M Licensed Product lines for schema review.
 * Replace values with exact SF picklist API names / labels as used on Case.LP.
 */
export const LP_CRITERIA: LpCatalog = {
  uncertain:
    "Subject and description do not clearly identify a single Control-M product line; dispatcher must choose.",
  control_m_server:
    "Control-M/Server — scheduling engine, New Day, ordering, CTM Server processes, server configuration.",
  control_m_em:
    "Control-M/Enterprise Manager (EM) — GUI/Web, CCM, perspectives, EM server, client connectivity.",
  control_m_agent:
    "Control-M/Agent — agent install, connectivity to Server, job execution on agent host, agent utilities.",
  control_m_mft:
    "Control-M Managed File Transfer (MFT) — file transfer jobs, MFT Enterprise, transfer status/errors.",
  control_m_databases:
    "Control-M for Databases — database job types, DB connection profiles, SQL/stored-proc jobs.",
  control_m_application_integrator:
    "Control-M Application Integrator (AI) — custom job types built in AI, AI plug-ins authored by customer/support (not published Integration Factory packages).",
  control_m_integrations_factory:
    "Integration Factory — published BMC/partner integration package identified by Integration Name + Version (not generic AI authoring).",
  control_m_workload_archiving:
    "Control-M Workload Archiving / WLA related archiving components.",
  helix_control_m:
    "Helix Control-M (SaaS) — Helix tenant, Helix-specific SaaS issues (not OnPrem-to-Helix migration tooling).",
  control_m_other:
    "Clearly Control-M related but none of the listed product lines fit; needs dispatcher LP selection.",
};

/**
 * Example DR criteria keyed by LP choice id.
 * Pass 2 should only present the map for the selected LP (+ uncertain).
 * Replace with real DR picklist values per LP.
 */
export const DR_BY_LP: DrByLp = {
  control_m_server: {
    uncertain: "Component within Control-M/Server is unclear.",
    new_day: "New Day procedure, ordering, daily scheduling cycle.",
    ctm_sec: "Security, authentication, SSL, user permissions on Server.",
    configuration: "Server configuration, ports, configuration params.",
    performance: "Server performance, timeouts, resource contention.",
    other: "Other Server component.",
  },
  control_m_em: {
    uncertain: "Component within EM is unclear.",
    gui_web: "EM GUI or Web client display, login, perspectives.",
    ccm: "Control-M Configuration Manager (CCM).",
    connectivity: "EM to Server/GUI connectivity.",
    other: "Other EM component.",
  },
  control_m_agent: {
    uncertain: "Component within Agent is unclear.",
    install_upgrade: "Agent install, upgrade, Fix Pack on agent host.",
    connectivity: "Agent-to-Server communication, check_ping, ports.",
    job_execution: "Job fails/hangs on agent; OS-level execution issues.",
    other: "Other Agent component.",
  },
  control_m_mft: {
    uncertain: "Component within MFT is unclear.",
    transfer_job: "File transfer job definition or runtime failure.",
    enterprise: "MFT Enterprise / hub related.",
    other: "Other MFT component.",
  },
  control_m_databases: {
    uncertain: "Component within Databases plug-in is unclear.",
    connection_profile: "DB connection profile / credentials / connectivity.",
    job_type: "Database job type definition or runtime SQL errors.",
    other: "Other Databases component.",
  },
  control_m_application_integrator: {
    uncertain: "AI component unclear.",
    job_type_runtime: "Custom AI job type runtime failure.",
    design_authoring: "Building/editing AI job types in Application Integrator.",
    other: "Other Application Integrator topic.",
  },
  control_m_integrations_factory: {
    uncertain: "Integration Factory package/component unclear.",
    // TODO(PRD §12): replace AAA/BBB with confirmed IF LP/DR names when known.
    package_runtime:
      "Published Integration Factory package runtime (set official DR when known).",
    package_config:
      "Integration package configuration / connection profile (set official DR when known).",
    other: "Other Integration Factory topic.",
  },
  helix_control_m: {
    uncertain: "Helix component unclear.",
    tenant_access: "Helix tenant access, login, SaaS connectivity.",
    jobs_folders: "Helix jobs/folders/workspaces behavior.",
    other: "Other Helix Control-M topic.",
  },
  control_m_workload_archiving: {
    uncertain: "Archiving component unclear.",
    archive_job: "Archive job or retention behavior.",
    other: "Other archiving topic.",
  },
  control_m_other: {
    uncertain: "Need dispatcher to set DR.",
    other: "Catch-all DR when LP is control_m_other.",
  },
  uncertain: {
    uncertain: "LP and DR both uncertain — do not auto-apply.",
  },
};

/** Official IF LP/DR Service Cloud values — fill when §12 open question closes. */
export const INTEGRATION_FACTORY_SF_VALUES = {
  lpApiName: "TODO_IF_LP", // was "AAA" in Best Practices
  drApiName: "TODO_IF_DR", // was "BBB" in Best Practices
} as const;
