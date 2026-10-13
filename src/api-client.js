// HTTP client for the Fierce Philanthropy coordination API

export const DEFAULT_BASE_URL = 'https://tokensforgood.ai/api';
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

let overrideAnnounced = false;
function announceOnce(line) {
  if (overrideAnnounced) return;
  overrideAnnounced = true;
  process.stderr.write(line + '\n');
}

/**
 * The API base the client talks to. FIERCE_API_URL is a development override
 * and is checked before any request: it must be https, or plain http to a
 * loopback address, so an `env` block a project injects into the MCP process
 * cannot point the key at an arbitrary host, and never over plaintext. An
 * active override is announced on stderr so it is visible in the harness log.
 */
export function resolveBaseUrl(env = process.env, warn = announceOnce) {
  const raw = (env.FIERCE_API_URL || '').trim();
  if (!raw) return DEFAULT_BASE_URL;

  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`FIERCE_API_URL is not a valid URL: ${raw}`);
  }
  const loopback = LOOPBACK_HOSTS.has(url.hostname);
  if (!(url.protocol === 'https:' || (url.protocol === 'http:' && loopback))) {
    throw new Error(`Refusing FIERCE_API_URL ${raw}: the API key only travels over https (plain http is allowed for 127.0.0.1 and localhost during development).`);
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error(`Refusing FIERCE_API_URL ${raw}: credentials, query strings and fragments are not allowed in the API base.`);
  }

  const base = url.href.replace(/\/+$/, '');
  if (base !== DEFAULT_BASE_URL) {
    warn(`tokens-for-good: FIERCE_API_URL is set; API requests (and your API key) go to ${url.origin} instead of ${new URL(DEFAULT_BASE_URL).origin}`);
  }
  return base;
}

export class ApiClient {
  constructor(apiKey, { version = null, platform = null, installId = null } = {}) {
    this.apiKey = apiKey;
    this.version = version;
    this.platform = platform;
    this.installId = installId;
    if (!apiKey) {
      throw new Error('TFG_API_KEY environment variable is required. Get your key at https://tokensforgood.ai/contribute');
    }
    this.baseUrl = resolveBaseUrl();
    this.origin = new URL(this.baseUrl).origin;
  }

  // Every request URL is rebuilt from the validated base and re-checked
  // against its origin, so no path can steer the key elsewhere.
  url(path) {
    const url = new URL(`${this.baseUrl}${path}`);
    if (url.origin !== this.origin) {
      throw new Error(`Refusing to call ${url.origin}: requests only go to ${this.origin}`);
    }
    return url.href;
  }

  // Version, platform, and install_id ride along on every request so the
  // server can attribute traffic by client build, editor, and per-machine
  // install without inspecting the request body.
  headers(extra = {}) {
    const headers = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      ...extra,
    };
    if (this.version) headers['X-TFG-Version'] = this.version;
    if (this.platform) headers['X-TFG-Platform'] = this.platform;
    if (this.installId) headers['X-TFG-Install-Id'] = this.installId;
    return headers;
  }

  async request(method, path, body = null) {
    const url = this.url(path);
    const options = {
      method,
      headers: this.headers({ 'X-TFG-Api-Key': this.apiKey }),
      signal: AbortSignal.timeout(30000),
      // A followed redirect would carry the key to whatever host the Location
      // names (the Fetch spec strips only Authorization cross-origin), so any
      // redirect is a failure rather than something to follow.
      redirect: 'error',
    };

    if (body) {
      options.body = JSON.stringify(body);
    }

    const response = await fetch(url, options);
    // Tolerate empty bodies (204 No Content, used by /research/consolidate/next
    // when nothing is assigned to you); response.json() throws on empty text.
    const text = await response.text();
    // A proxy or load balancer error page (HTML 502/503) is not JSON; report
    // the status rather than a bare SyntaxError that hides it.
    let data = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        if (response.ok) {
          const error = new Error(`API returned a non-JSON response (HTTP ${response.status})`);
          error.status = response.status;
          throw error;
        }
      }
    }

    if (!response.ok) {
      const error = new Error((data && (data.error || data.message)) || `API error ${response.status}`);
      error.status = response.status;
      error.data = data;
      throw error;
    }

    return data;
  }

  async claimOrg(platform = null) {
    return this.request('POST', '/research/claim', { platform });
  }

  async submitReport(claimId, reportMarkdown, tokenUsage = null, metrics = null, modelUsed = null, promptVersion = null, disagreementRows = null, noEvidence = false) {
    // The MCP tool surface accepts `estimated_tokens` as a plain number, but
    // the API validates `token_usage` as `nullable|array` and reads
    // `token_usage.total_tokens` for leaderboard accounting. Wrap a bare
    // number into the shape the server expects so MCP submits don't 422.
    const normalizedTokenUsage = typeof tokenUsage === 'number'
      ? { total_tokens: tokenUsage }
      : tokenUsage;

    return this.request('POST', '/research/submit', {
      claim_id: claimId,
      report_markdown: reportMarkdown,
      token_usage: normalizedTokenUsage,
      metrics: metrics,
      model_used: modelUsed,
      prompt_version: promptVersion,
      disagreement_rows: disagreementRows,
      no_evidence: noEvidence || undefined,
    });
  }

  async releaseClaim(claimId) {
    return this.request('POST', '/research/release', { claim_id: claimId });
  }

  async getNextConsolidation() {
    // request() returns null when the server sends 204 ("nothing assigned"),
    // so callers can just check for a falsy result.
    return this.request('GET', '/research/consolidate/next');
  }

  async getNextValidation() {
    // 204 -> null when nothing is assigned, same as consolidation.
    return this.request('GET', '/research/validate/next');
  }

  async setRolePreference(preferLowFetchRoles) {
    return this.request('POST', '/research/agent/preferences', {
      prefer_low_fetch_roles: !!preferLowFetchRoles,
    });
  }

  async listAgents() {
    return this.request('GET', '/research/agents');
  }

  async createAgent(label, preferLowFetchRoles = false) {
    return this.request('POST', '/research/agents', {
      label,
      prefer_low_fetch_roles: !!preferLowFetchRoles,
    });
  }

  async rotateAgentKey(agentId) {
    return this.request('POST', '/research/agents/rotate', { agent_id: agentId });
  }

  async revokeAgent(agentId) {
    return this.request('POST', '/research/agents/revoke', { agent_id: agentId });
  }

  async submitValidation(claimId, validatedReports, validationNotes = null, tokenUsage = null) {
    const normalizedTokenUsage = typeof tokenUsage === 'number'
      ? { total_tokens: tokenUsage }
      : tokenUsage;

    return this.request('POST', '/research/validate/submit', {
      claim_id: claimId,
      validated_reports: validatedReports,
      validation_notes: validationNotes,
      token_usage: normalizedTokenUsage,
    });
  }

  async getStatus() {
    const response = await fetch(this.url('/research/status'), {
      headers: this.headers(),
      signal: AbortSignal.timeout(15000),
      redirect: 'error',
    });
    if (!response.ok) {
      throw new Error(`Status API error ${response.status}`);
    }
    return response.json();
  }

  async getImpact() {
    return this.request('GET', '/research/impact');
  }

  async getNextAction() {
    return this.request('GET', '/research/next-action');
  }

  async enableSchedule() {
    return this.request('POST', '/research/enable-schedule');
  }
}
