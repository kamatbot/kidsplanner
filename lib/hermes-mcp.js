"use strict";

/**
 * Stateless MCP transport for the FamETC Hermes Family Operator.
 *
 * The endpoint supports the modern 2026-07-28 MCP lifecycle (server/discover,
 * per-request protocol metadata / routing headers) and the legacy initialize
 * lifecycle used by existing Hermes installations. Application state is never
 * stored in the MCP transport; durable state lives in operator-store.
 */
const operator = require("./operator");
const operatorStore = require("./operator-store");
const operatorExecution = require("./operator-execution");
const actorCapabilities = require("./operator-capabilities");

const MODERN_VERSION = "2026-07-28";
const LEGACY_VERSIONS = new Set(["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"]);
const DEFAULT_LEGACY_VERSION = "2025-11-25";
const SERVER_INFO = Object.freeze({ name: "fametc-family-operator", version: "0.2.0" });
const SERVER_INSTRUCTIONS = "Use FamETC tools only for the authenticated family. Create a durable case for multi-step work. Every tool requires the actorToken attached to the initiating FamETC family-room message; never invent an actor, reuse authority from another message, or use Operator tools from Trip rooms. Before an irreversible action, request approval for the exact payload. Only after a parent explicitly approves that actionHash may you decide the approval, claim a short-lived execution token, and run the stored approved action. Never alter an approved action, quote capability tokens, or save tokens to memory.";
const MAX_TOOL_JSON_BYTES = 64 * 1024;

function objectSchema(properties, required = []) {
  return {
    type: "object",
    properties,
    required,
    additionalProperties: false,
  };
}

const ACTOR_TOKEN = { type: "string", minLength: 20, maxLength: 5000, description: "Signed actor token attached by FamETC to the initiating @Hermes family-room message." };
const CASE_ID = { type: "string", pattern: "^case_[0-9a-f]+$" };
const APPROVAL_ID = { type: "string", pattern: "^approval_[0-9a-f]+$" };
const ACTION_HASH = { type: "string", pattern: "^[0-9a-fA-F]{64}$" };
const EXECUTION_TOKEN = { type: "string", minLength: 40, maxLength: 512, description: "Short-lived single-use execution token returned by fametc_execution_claim. Treat as a secret." };

const TOOL_DEFINITIONS = Object.freeze([
  {
    name: "fametc_context_get",
    title: "Get purpose-scoped family context",
    description: "Return the minimum FamETC family context authorized by the initiating human actor. Requires the actorToken from that FamETC message; never substitute a user or kid id.",
    inputSchema: objectSchema({
      actorToken: ACTOR_TOKEN,
      purpose: { type: "string", maxLength: 160 },
      sections: { type: "array", items: { type: "string", enum: ["members", "room"] }, uniqueItems: true, maxItems: 2 },
    }, ["actorToken"]),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "fametc_cases_create",
    title: "Create family operator case",
    description: "Create a durable case for multi-step family work. The case is bound to the human actor represented by actorToken and starts in draft state.",
    inputSchema: objectSchema({
      actorToken: ACTOR_TOKEN,
      title: { type: "string", minLength: 1, maxLength: 180 },
      goal: { type: "string", minLength: 1, maxLength: 8000 },
      purpose: { type: "string", maxLength: 160 },
      riskLevel: { type: "string", enum: ["low", "medium", "high", "critical"] },
      budgetCents: { type: "integer", minimum: 0, maximum: 1000000000 },
      contextSections: { type: "array", items: { type: "string", enum: ["members", "room"] }, uniqueItems: true, maxItems: 2 },
    }, ["actorToken", "title", "goal"]),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  {
    name: "fametc_cases_get",
    title: "Get operator case",
    description: "Read one durable Operator case visible to the initiating actor.",
    inputSchema: objectSchema({
      actorToken: ACTOR_TOKEN,
      caseId: CASE_ID,
      includeChildren: { type: "boolean" },
    }, ["actorToken", "caseId"]),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "fametc_cases_list",
    title: "List operator cases",
    description: "List recent durable Operator cases visible to the initiating actor.",
    inputSchema: objectSchema({
      actorToken: ACTOR_TOKEN,
      state: { type: "string", enum: operatorStore.CASE_STATES },
      limit: { type: "integer", minimum: 1, maximum: 200 },
    }, ["actorToken"]),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "fametc_cases_transition",
    title: "Transition operator case",
    description: "Move a visible case through the allowed state machine. Invalid jumps are rejected by FamETC policy.",
    inputSchema: objectSchema({
      actorToken: ACTOR_TOKEN,
      caseId: CASE_ID,
      state: { type: "string", enum: operatorStore.CASE_STATES },
      detail: { type: "string", maxLength: 1000 },
    }, ["actorToken", "caseId", "state"]),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "fametc_cases_add_step",
    title: "Add operator case step",
    description: "Append a typed, auditable step to a visible durable case. Use an idempotencyKey for external work that may be retried.",
    inputSchema: objectSchema({
      actorToken: ACTOR_TOKEN,
      caseId: CASE_ID,
      kind: { type: "string", minLength: 1, maxLength: 80 },
      state: { type: "string", enum: operatorStore.STEP_STATES },
      position: { type: "integer", minimum: 0, maximum: 100000 },
      input: {},
      output: {},
      idempotencyKey: { type: "string", maxLength: 200 },
    }, ["actorToken", "caseId", "kind"]),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  {
    name: "fametc_approvals_request",
    title: "Request parent approval",
    description: "Persist an exact proposed action for parent approval and move the case to waiting_for_approval. This never executes the action. The returned actionHash identifies the exact payload a parent must approve or reject.",
    inputSchema: objectSchema({
      actorToken: ACTOR_TOKEN,
      caseId: CASE_ID,
      approverUserId: { type: "string", maxLength: 128 },
      actionType: { type: "string", minLength: 1, maxLength: 120 },
      action: { type: "object" },
      expiresAt: { type: "string", maxLength: 40 },
    }, ["actorToken", "caseId", "actionType", "action"]),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  {
    name: "fametc_approvals_decide",
    title: "Approve or reject exact Operator action",
    description: "Record a parent's explicit decision for one pending approval. Only call this after the parent has clearly approved or rejected the exact actionHash in the current FamETC message. Approval creates execution authority but does not itself run the action.",
    inputSchema: objectSchema({
      actorToken: ACTOR_TOKEN,
      approvalId: APPROVAL_ID,
      decision: { type: "string", enum: ["approve", "reject"] },
      actionHash: ACTION_HASH,
    }, ["actorToken", "approvalId", "decision", "actionHash"]),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "fametc_execution_claim",
    title: "Claim approved execution",
    description: "After the approving parent has explicitly approved an action, claim a short-lived single-use execution token for that stored action. The approving parent's actorToken is required.",
    inputSchema: objectSchema({
      actorToken: ACTOR_TOKEN,
      approvalId: APPROVAL_ID,
    }, ["actorToken", "approvalId"]),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  {
    name: "fametc_execution_run",
    title: "Run approved action",
    description: "Execute only the server-stored action previously approved and claimed. The caller supplies the executionToken and actionHash, never a replacement action payload. Currently only calendar.create is enabled.",
    inputSchema: objectSchema({
      actorToken: ACTOR_TOKEN,
      executionToken: EXECUTION_TOKEN,
      actionHash: ACTION_HASH,
    }, ["actorToken", "executionToken", "actionHash"]),
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  },
]);

const TOOL_NAMES = new Set(TOOL_DEFINITIONS.map((tool) => tool.name));

class McpRequestError extends Error {
  constructor(message, code = -32602, httpStatus = 200) {
    super(message);
    this.name = "McpRequestError";
    this.rpcCode = code;
    this.httpStatus = httpStatus;
  }
}

function header(req, name) {
  if (req && typeof req.get === "function") return req.get(name) || "";
  const headers = (req && req.headers) || {};
  return headers[String(name).toLowerCase()] || "";
}

function requestProtocol(req, body) {
  const fromHeader = String(header(req, "MCP-Protocol-Version") || "").trim();
  if (fromHeader) return fromHeader;
  const meta = body && body.params && body.params._meta;
  return meta && String(meta["io.modelcontextprotocol/protocolVersion"] || "").trim() || null;
}

function isModern(req, body) {
  return requestProtocol(req, body) === MODERN_VERSION || (body && body.method === "server/discover");
}

function resultMeta() {
  return { "io.modelcontextprotocol/serverInfo": SERVER_INFO };
}

function withModernMeta(result, modern) {
  if (!modern) return result;
  return Object.assign({}, result, { _meta: Object.assign({}, result && result._meta, resultMeta()) });
}

function rpcResult(id, result) {
  return { jsonrpc: "2.0", id, result };
}

function rpcError(id, code, message, data) {
  const error = { code, message };
  if (data !== undefined) error.data = data;
  return { jsonrpc: "2.0", id: id == null ? null : id, error };
}

function validateEnvelope(req, body) {
  if (!body || Array.isArray(body) || body.jsonrpc !== "2.0" || typeof body.method !== "string") {
    throw new McpRequestError("Invalid JSON-RPC request.", -32600, 400);
  }
  const protocol = requestProtocol(req, body);
  if (protocol && protocol !== MODERN_VERSION && !LEGACY_VERSIONS.has(protocol)) {
    throw new McpRequestError(`Unsupported MCP protocol version: ${protocol}.`, -32602, 400);
  }
  if (protocol === MODERN_VERSION) {
    const routedMethod = String(header(req, "Mcp-Method") || "");
    if (!routedMethod || routedMethod !== body.method) {
      throw new McpRequestError("Mcp-Method header does not match the JSON-RPC method.", -32020, 400);
    }
    if (body.method === "tools/call") {
      const routedName = String(header(req, "Mcp-Name") || "");
      const bodyName = body.params && body.params.name;
      if (!routedName || routedName !== bodyName) {
        throw new McpRequestError("Mcp-Name header does not match the requested tool.", -32020, 400);
      }
    }
  }
}

function requireString(args, key) {
  const value = args && args[key];
  if (typeof value !== "string" || !value.trim()) throw new McpRequestError(`${key} is required.`);
  return value;
}

function assertJsonSize(value, key) {
  let serialized;
  try {
    serialized = JSON.stringify(value);
  } catch (error) {
    throw new McpRequestError(`${key} must be valid JSON.`);
  }
  if (Buffer.byteLength(serialized || "null", "utf8") > MAX_TOOL_JSON_BYTES) {
    throw new McpRequestError(`${key} is too large.`);
  }
}

function capabilityActor(auth, args) {
  return actorCapabilities.verify({
    family: auth.family,
    connection: auth.connection,
    token: requireString(args, "actorToken"),
  });
}

function visibleCase(auth, cap, caseId) {
  return operator.getCase(auth.family.id, caseId, {
    actor: cap.actor,
    roomId: cap.roomId,
  });
}

function moveToWaitingForApproval(auth, cap, caseId) {
  const current = visibleCase(auth, cap, caseId);
  if (!current) throw new McpRequestError("Case not found.", -32602);
  if (current.state === "waiting_for_approval") return current;
  const allowed = operator.ALLOWED_TRANSITIONS[current.state];
  if (!allowed || !allowed.has("waiting_for_approval")) {
    const error = new Error(`Case cannot request approval from ${current.state}.`);
    error.code = "OPERATOR_INVALID_TRANSITION";
    throw error;
  }
  return operator.transitionCase(auth.family.id, caseId, "waiting_for_approval", {
    actor: cap.actor,
    roomId: cap.roomId,
    detail: "Exact external action proposed for parent approval.",
  });
}

function toolData(auth, name, args = {}) {
  const familyId = auth.family.id;
  switch (name) {
    case "fametc_context_get": {
      const cap = capabilityActor(auth, args);
      return operator.contextForFamily(familyId, {
        actor: cap.actor,
        purpose: args.purpose || "family-assistance",
        sections: args.sections,
        roomId: cap.roomId,
      });
    }
    case "fametc_cases_create": {
      const cap = capabilityActor(auth, args);
      return operator.createCase(familyId, {
        actor: cap.actor,
        roomId: cap.roomId,
        title: requireString(args, "title"),
        goal: requireString(args, "goal"),
        purpose: args.purpose || "operator-case",
        riskLevel: args.riskLevel || "low",
        budgetCents: args.budgetCents,
        contextSections: args.contextSections,
      });
    }
    case "fametc_cases_get": {
      const cap = capabilityActor(auth, args);
      const caseId = requireString(args, "caseId");
      const found = operator.getCase(familyId, caseId, {
        actor: cap.actor,
        roomId: cap.roomId,
        includeChildren: args.includeChildren === true,
      });
      if (!found) throw new McpRequestError("Case not found.", -32602);
      return found;
    }
    case "fametc_cases_list": {
      const cap = capabilityActor(auth, args);
      return { cases: operator.listCases(familyId, {
        actor: cap.actor,
        roomId: cap.roomId,
        state: args.state,
        limit: args.limit,
      }) };
    }
    case "fametc_cases_transition": {
      const cap = capabilityActor(auth, args);
      const updated = operator.transitionCase(familyId, requireString(args, "caseId"), requireString(args, "state"), {
        actor: cap.actor,
        roomId: cap.roomId,
        detail: args.detail || null,
      });
      if (!updated) throw new McpRequestError("Case not found.", -32602);
      return updated;
    }
    case "fametc_cases_add_step": {
      const cap = capabilityActor(auth, args);
      if (args.input !== undefined) assertJsonSize(args.input, "input");
      if (args.output !== undefined) assertJsonSize(args.output, "output");
      const step = operator.addStep(familyId, requireString(args, "caseId"), {
        actor: cap.actor,
        roomId: cap.roomId,
        kind: requireString(args, "kind"),
        state: args.state,
        position: args.position,
        input: args.input,
        output: args.output,
        idempotencyKey: args.idempotencyKey,
      });
      if (!step) throw new McpRequestError("Case not found.", -32602);
      return step;
    }
    case "fametc_approvals_request": {
      const cap = capabilityActor(auth, args);
      if (!args.action || typeof args.action !== "object" || Array.isArray(args.action)) {
        throw new McpRequestError("action must be an object.");
      }
      assertJsonSize(args.action, "action");
      const caseId = requireString(args, "caseId");
      const actionType = requireString(args, "actionType");
      // Validate the allowlisted driver payload before changing durable case
      // state, so an unsupported or malformed proposal cannot strand a case.
      operatorExecution.validateAction(familyId, actionType, args.action);
      moveToWaitingForApproval(auth, cap, caseId);
      const approval = operator.requestApproval(familyId, caseId, {
        actor: cap.actor,
        roomId: cap.roomId,
        approverUserId: args.approverUserId,
        actionType,
        action: args.action,
        expiresAt: args.expiresAt,
      });
      if (!approval) throw new McpRequestError("Case not found.", -32602);
      return approval;
    }
    case "fametc_approvals_decide": {
      const cap = capabilityActor(auth, args);
      const result = operatorExecution.decideApproval(
        familyId,
        requireString(args, "approvalId"),
        {
          actor: cap.actor,
          decision: requireString(args, "decision"),
          actionHash: requireString(args, "actionHash"),
        },
      );
      if (!result) throw new McpRequestError("Approval not found.", -32602);
      return result;
    }
    case "fametc_execution_claim": {
      const cap = capabilityActor(auth, args);
      return operatorExecution.claimExecution(
        familyId,
        requireString(args, "approvalId"),
        { actor: cap.actor, executorType: "hermes" },
      );
    }
    case "fametc_execution_run": {
      const cap = capabilityActor(auth, args);
      return operatorExecution.runExecution(
        familyId,
        requireString(args, "executionToken"),
        requireString(args, "actionHash"),
        { actor: cap.actor },
      );
    }
    default:
      throw new McpRequestError(`Unknown tool: ${name}.`, -32602);
  }
}

function toolResult(data, modern) {
  const result = {
    content: [{ type: "text", text: JSON.stringify(data) }],
    structuredContent: data,
    isError: false,
  };
  return withModernMeta(result, modern);
}

function toolError(error, modern) {
  const code = error && error.code ? error.code : "OPERATOR_TOOL_ERROR";
  const message = error && error.message ? error.message : "Operator tool failed.";
  return withModernMeta({
    content: [{ type: "text", text: `${code}: ${message}` }],
    structuredContent: { error: { code, message } },
    isError: true,
  }, modern);
}

function handle(req, res, auth) {
  const body = req.body;
  const id = body && Object.prototype.hasOwnProperty.call(body, "id") ? body.id : null;
  let modern = false;
  try {
    validateEnvelope(req, body);
    modern = isModern(req, body);

    if (body.method === "notifications/initialized") {
      return res.status(202).end();
    }

    if (body.method === "server/discover") {
      return res.json(rpcResult(id, withModernMeta({
        supportedVersions: [MODERN_VERSION],
        capabilities: { tools: {} },
        instructions: SERVER_INSTRUCTIONS,
        ttlMs: 60000,
        cacheScope: "private",
      }, true)));
    }

    if (body.method === "initialize") {
      const requested = body.params && body.params.protocolVersion;
      const protocolVersion = LEGACY_VERSIONS.has(requested) ? requested : DEFAULT_LEGACY_VERSION;
      return res.json(rpcResult(id, {
        protocolVersion,
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
        instructions: SERVER_INSTRUCTIONS,
      }));
    }

    if (body.method === "ping") {
      return res.json(rpcResult(id, modern ? withModernMeta({}, true) : {}));
    }

    if (body.method === "tools/list") {
      const listed = { tools: TOOL_DEFINITIONS };
      if (modern) {
        listed.ttlMs = 60000;
        listed.cacheScope = "private";
      }
      return res.json(rpcResult(id, withModernMeta(listed, modern)));
    }

    if (body.method === "tools/call") {
      const params = body.params || {};
      if (!TOOL_NAMES.has(params.name)) throw new McpRequestError(`Unknown tool: ${params.name || "(missing)"}.`, -32602);
      try {
        const data = toolData(auth, params.name, params.arguments || {});
        return res.json(rpcResult(id, toolResult(data, modern)));
      } catch (error) {
        if (error instanceof McpRequestError && error.rpcCode === -32602 && /^Unknown tool:/.test(error.message)) throw error;
        return res.json(rpcResult(id, toolError(error, modern)));
      }
    }

    throw new McpRequestError(`Method not found: ${body.method}.`, -32601);
  } catch (error) {
    const rpcCode = error instanceof McpRequestError ? error.rpcCode : -32603;
    const httpStatus = error instanceof McpRequestError ? error.httpStatus : 500;
    const message = error && error.message ? error.message : "Internal MCP error.";
    return res.status(httpStatus).json(rpcError(id, rpcCode, message));
  }
}

module.exports = {
  MODERN_VERSION,
  DEFAULT_LEGACY_VERSION,
  SERVER_INFO,
  TOOL_DEFINITIONS,
  handle,
};
