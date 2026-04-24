import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import {
  applyPolicyChangeTool,
  createPolicyRuleToolRegistration,
  evaluatePolicyTool,
  getPolicyManifestTool,
  installRulepackToolRegistration,
  updateRulepacksTool,
} from './tools.js';
import { startHttpBridge } from './http-bridge.js';
import type { HttpBridge } from './http-bridge.js';

// ─── Non-core tools (available in tools.ts, re-enable here when needed) ──────
// import {
//   createRuleFileTool,
//   explainPolicyDecisionTool,
//   formatPolicyYamlTool,
//   listApprovalsTool,
//   listGovernableToolsTool,
//   listPolicyAssetsTool,
//   listPolicyTemplatesTool,
//   proposePolicyRuleTool,
//   searchPoliciesTool,
//   validatePolicyPackTool,
// } from './tools.js';

type ToolResult = {
  isError?: boolean;
  content: Array<{ type: 'text'; text: string }>;
};

function toCallToolResult(result: ToolResult): CallToolResult {
  return {
    isError: result.isError,
    content: result.content.map((item) => ({
      type: 'text' as const,
      text: item.text,
    })),
  };
}

async function main(): Promise<void> {
  const server = new McpServer({
    name: 'policy-mcp',
    version: '0.1.0',
  });

  let bridge: HttpBridge | undefined;

  // ─── Core tools (4) ──────────────────────────────────────────────────────────

  server.registerTool(
    getPolicyManifestTool.name,
    {
      description: getPolicyManifestTool.description,
      inputSchema: getPolicyManifestTool.inputSchema,
    },
    async (args: Parameters<typeof getPolicyManifestTool.execute>[0]) =>
      toCallToolResult(await getPolicyManifestTool.execute(args)),
  );

  server.registerTool(
    evaluatePolicyTool.name,
    {
      description: evaluatePolicyTool.description,
      inputSchema: evaluatePolicyTool.inputSchema,
    },
    async (args: Parameters<typeof evaluatePolicyTool.execute>[0]) =>
      toCallToolResult(await evaluatePolicyTool.execute(args)),
  );

  server.registerTool(
    applyPolicyChangeTool.name,
    {
      description: applyPolicyChangeTool.description,
      inputSchema: applyPolicyChangeTool.inputSchema,
    },
    async (args: Parameters<typeof applyPolicyChangeTool.execute>[0]) =>
      toCallToolResult(await applyPolicyChangeTool.execute(args)),
  );

  const createRuleTool = createPolicyRuleToolRegistration(server.server);
  server.registerTool(
    createRuleTool.name,
    createRuleTool.config,
    createRuleTool.handler,
  );

  const installRulepackRegistration = installRulepackToolRegistration(server.server);
  server.registerTool(
    installRulepackRegistration.name,
    installRulepackRegistration.config,
    installRulepackRegistration.handler,
  );

  server.registerTool(
    updateRulepacksTool.name,
    {
      description: updateRulepacksTool.description,
      inputSchema: updateRulepacksTool.inputSchema,
    },
    async (args: Parameters<typeof updateRulepacksTool.execute>[0]) =>
      toCallToolResult(await updateRulepacksTool.execute(args)),
  );

  // ─── Non-core tools (uncomment to re-enable) ────────────────────────────────
  //
  // server.registerTool(validatePolicyPackTool.name, { description: validatePolicyPackTool.description, inputSchema: validatePolicyPackTool.inputSchema }, async (args) => toCallToolResult(await validatePolicyPackTool.execute(args)));
  // server.registerTool(searchPoliciesTool.name, { description: searchPoliciesTool.description, inputSchema: searchPoliciesTool.inputSchema }, async (args) => toCallToolResult(await searchPoliciesTool.execute(args)));
  // server.registerTool(listPolicyAssetsTool.name, { description: listPolicyAssetsTool.description, inputSchema: listPolicyAssetsTool.inputSchema }, async (args) => toCallToolResult(await listPolicyAssetsTool.execute(args)));
  // server.registerTool(explainPolicyDecisionTool.name, { description: explainPolicyDecisionTool.description, inputSchema: explainPolicyDecisionTool.inputSchema }, async (args) => toCallToolResult(await explainPolicyDecisionTool.execute(args)));
  // server.registerTool(listApprovalsTool.name, { description: listApprovalsTool.description, inputSchema: listApprovalsTool.inputSchema }, async (args) => toCallToolResult(await listApprovalsTool.execute(args)));
  // server.registerTool(listGovernableToolsTool.name, { description: listGovernableToolsTool.description, inputSchema: listGovernableToolsTool.inputSchema }, async (args) => toCallToolResult(await listGovernableToolsTool.execute(args)));
  // server.registerTool(listPolicyTemplatesTool.name, { description: listPolicyTemplatesTool.description, inputSchema: listPolicyTemplatesTool.inputSchema }, async (args) => toCallToolResult(await listPolicyTemplatesTool.execute(args)));
  // server.registerTool(proposePolicyRuleTool.name, { description: proposePolicyRuleTool.description, inputSchema: proposePolicyRuleTool.inputSchema }, async (args) => toCallToolResult(await proposePolicyRuleTool.execute(args)));
  // server.registerTool(createRuleFileTool.name, { description: createRuleFileTool.description, inputSchema: createRuleFileTool.inputSchema }, async (args) => toCallToolResult(await createRuleFileTool.execute(args)));
  // server.registerTool(formatPolicyYamlTool.name, { description: formatPolicyYamlTool.description, inputSchema: formatPolicyYamlTool.inputSchema }, async (args) => toCallToolResult(await formatPolicyYamlTool.execute(args)));

  const transport = new StdioServerTransport();
  await server.connect(transport);

  bridge = await startHttpBridge({ workspaceRoot: process.cwd() });
  process.stderr.write(`[policy-mcp] HTTP bridge listening on port ${bridge.port}\n`);

  const shutdown = async (): Promise<void> => {
    if (bridge !== undefined) {
      await bridge.close();
    }
  };

  process.on('beforeExit', () => { void shutdown(); });
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`[policy-mcp] Fatal: ${message}\n`);
  process.exit(1);
});
