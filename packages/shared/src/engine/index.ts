// Claude hook schemas and types
export {
  CLAUDE_HOOK_EVENTS,
  ClaudeHookEventSchema,
  ClaudeHookBasePayloadSchema,
  ClaudePreToolUsePayloadSchema,
  ClaudePostToolUsePayloadSchema,
  ClaudeSessionStartPayloadSchema,
  ClaudeHookPayloadSchema,
  ClaudePreToolUseResponseSchema,
  ClaudePostToolUseResponseSchema,
  ClaudeGenericHookResponseSchema,
  ClaudeStopHookResponseSchema,
  type ClaudeHookEvent,
  type ClaudeHookPayload,
  type ClaudePreToolUsePayload,
  type ClaudePostToolUsePayload,
  type ClaudeSessionStartPayload,
  type ClaudePreToolUseResponse,
  type ClaudePostToolUseResponse,
  type ClaudeGenericHookResponse,
  type ClaudeStopHookResponse,
} from './claude-hooks.js';

// Engine schemas and types
export {
  POLICY_HOOK_EVENTS,
  PolicyHookEventSchema,
  POLICY_RULE_LEVELS,
  PolicyRuleLevelSchema,
  POLICY_HOOK_MODES,
  PolicyHookModeSchema,
  POLICY_DECISIONS,
  PolicyDecisionSchema,
  PolicyGovernanceSchema,
  PolicyRulepackSchema,
  EngineRuleSchema,
  PolicyHookWhenSchema,
  PolicyHookRetrieveSchema,
  PolicyHookSchema,
  EngineManifestSchema,
  PartialEngineManifestSchema,
  LAYER_PRECEDENCE,
  type PartialEngineManifest,
  type LayerSource,
  type MergeMode,
  type ConfigLayer,
  type ConfigLayerPath,
  type SuppressedItem,
  type PolicyHookEvent,
  type PolicyRuleLevel,
  type PolicyHookMode,
  type PolicyDecision,
  type PolicyGovernance,
  type EngineRulepack,
  type EngineRule,
  type PolicyHook,
  type EngineManifest,
  type PolicyHookWhen,
} from './engine-schema.js';

// Glob utilities
export { globToRegExp, matchesGlob } from './glob.js';

// Config discovery
export {
  POLICY_CONFIG_SEARCH_PLACES,
  getUserConfigPath,
  discoverConfigLayers,
  discoverPolicyManifestPath,
} from './config-discovery.js';

// Layer merge
export {
  ENTITY_ARRAY_KEYS,
  dedupeById,
  replaceArray,
  filterDisabled,
  policyMergeOptions,
  mergeManifests,
  type EntityArrayKey,
  type FilterResult,
} from './layer-merge.js';

// Layer loader
export {
  loadConfigLayer,
  mergeLayers,
  type MergeResult,
} from './layer-loader.js';

// Loader
export {
  loadPolicyManifestFromPath,
  loadPolicyManifestFromDir,
  loadPolicyManifest,
  validatePolicyManifest,
  getAssetFilesForHook,
  type LoadedPolicyAsset,
  type LoadedPolicyManifest,
  type ResolvedManifest,
  type PolicyValidationWarning,
  type PolicyValidationResult,
} from './loader.js';

// Search
export {
  searchPolicies,
  type PolicySearchInput,
  type PolicySearchResult,
} from './search.js';

// Retrieve
export { retrieveRelevantContent } from './retrieve.js';

// Evaluator
export {
  evaluatePolicy,
  resolveStopDecision,
  type PolicyEvaluationInput,
  type PolicyEvaluationResult,
  type MatchedDecideHook,
} from './evaluator.js';

// Approvals
export {
  approvalStorePath,
  normalizeActionPath,
  createActionHash,
  readApprovals,
  findActiveApproval,
  appendApprovalRecord,
  appendApprovalRecordForHook,
  type ApprovalRecord,
  type ApprovalLookupResult,
} from './approvals.js';

// Authoring
export {
  CLAUDE_NATIVE_TOOL_NAMES,
  POLICY_MCP_TOOL_NAMES,
  GovernableToolSchema,
  PolicyChangeDirectionSchema,
  PolicyChangeClassificationSchema,
  ProposedPolicyRuleSchema,
  listGovernableTools,
  listPolicyTemplates,
  getPolicyManifestState,
  classifyPolicyChange,
  writePolicyFiles,
  formatPolicyManifest,
  createRuleFile,
  formatPolicyYamlFile,
  proposePolicyRule,
  createScratchWorkspaceFromTemplate,
  type GovernableTool,
  type PolicyChangeClassification,
  type ProposedPolicyRule,
} from './authoring.js';
