// ─── Registry Types (policy authoring + installation) ─────────────────────────

/** A single rule within a policy manifest. */
export interface PolicyRule {
  /** Unique rule identifier within the policy. */
  id: string;
  /** Human-readable description of the rule. */
  description?: string;
  /** Relative path to the rule's markdown file. */
  path: string;
}

/** Per-client adapter configuration (optional overrides). */
export interface PolicyAdapter {
  claude?: Record<string, unknown>;
  cursor?: Record<string, unknown>;
  windsurf?: Record<string, unknown>;
}

/** Policy manifest — the `policy.yaml` (or `policy.config.ts`) root shape. */
export interface PolicyManifest {
  /** Policy name (e.g. "swe-essentials"). */
  name: string;
  /** Semver version string. */
  version: string;
  /** Human-readable description. */
  description?: string;
  /** Categorization tags. */
  tags?: string[];
  /** Rules included in this policy. */
  rules: PolicyRule[];
  /** Optional client-specific adapter configuration. */
  adapters?: PolicyAdapter;
}

/** A rule as recorded in the lockfile after installation. */
export interface InstalledRule {
  id: string;
  path: string;
  installedTo: string;
}

/** A policy as recorded in the lockfile after installation. */
export interface InstalledPolicy {
  name: string;
  version: string;
  source: string;
  installedAt: string;
  client: string;
  rules: InstalledRule[];
}

/** The `policies.lock.json` shape. */
export interface PolicyLockfile {
  version: 1;
  policies: InstalledPolicy[];
}

// ─── Engine Types (enforcement + hooks) ───────────────────────────────────────

/** Supported hook events. */
export type PolicyHookEvent =
  | 'PreToolUse'
  | 'PostToolUse'
  | 'Stop'
  | 'SubagentStop'
  | 'SessionStart'
  | 'SessionEnd'
  | 'UserPromptSubmit'
  | 'PreCompact'
  | 'Notification';

/** Rule severity levels. */
export type PolicyRuleLevel = 'advisory' | 'guardrail' | 'enforcement';

/** Hook execution modes. */
export type PolicyHookMode = 'inject' | 'decide' | 'audit';

/** Enforcement decisions. */
export type PolicyDecision = 'allow' | 'deny' | 'ask' | 'approve' | 'block';

/** Supported AI coding clients. */
export type ClientName = 'claude' | 'cursor' | 'windsurf';

/** Governance configuration for policy enforcement. */
export interface PolicyGovernance {
  allow_llm_updates?: PolicyRuleLevel[];
  require_approval_for?: PolicyRuleLevel[];
  approval_ttl_minutes?: number;
}

/** A rule in the enforcement engine manifest. */
export interface EngineRule {
  id: string;
  level: PolicyRuleLevel;
  file: string;
  tags?: string[];
  priority?: number;
  enabled?: boolean;
}

/** Conditional matching for hooks. */
export interface PolicyHookWhen {
  commands?: string[];
  paths?: string[];
  tools?: string[];
}

/** Hook definition in the engine manifest. */
export interface PolicyHook {
  id: string;
  event: PolicyHookEvent;
  matcher?: string;
  mode: PolicyHookMode;
  decision?: PolicyDecision;
  use?: string[];
  when?: PolicyHookWhen;
}

/** Rulepack bundle definition. */
export interface PolicyRulepack {
  id: string;
  files: string[];
  tags?: string[];
  version?: string;
}

/** Full engine manifest (used by enforcement, not authoring). */
export interface EngineManifest {
  version: number;
  rules?: EngineRule[];
  hooks?: PolicyHook[];
  rulepacks?: PolicyRulepack[];
  governance?: PolicyGovernance;
}
