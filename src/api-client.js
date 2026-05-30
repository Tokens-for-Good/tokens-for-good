// HTTP client for the Fierce Philanthropy coordination API

const BASE_URL = process.env.FIERCE_API_URL || 'https://tokensforgood.ai/api';

export class ApiClient {
  constructor(apiKey, { version = null, platform = null, installId = null } = {}) {
    this.apiKey = apiKey;
    this.version = version;
    this.platform = platform;
    this.installId = installId;
    if (!apiKey) {
      throw new Error('TFG_API_KEY environment variable is required. Get your key at https://tokensforgood.ai/contribute');
    }
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
    const url = `${BASE_URL}${path}`;
    const options = {
      method,
      headers: this.headers({ 'X-TFG-Api-Key': this.apiKey }),
      signal: AbortSignal.timeout(30000),
    };

    if (body) {
      options.body = JSON.stringify(body);
    }

    const response = await fetch(url, options);
    // Tolerate empty bodies (204 No Content, used by /research/consolidate/next
    // when nothing is assigned to you) — response.json() throws on empty text.
    const text = await response.text();
    const data = text ? JSON.parse(text) : null;

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

  async submitReport(claimId, reportMarkdown, tokenUsage = null, metrics = null, modelUsed = null, promptVersion = null, disagreementRows = null) {
    return this.request('POST', '/research/submit', {
      claim_id: claimId,
      report_markdown: reportMarkdown,
      token_usage: tokenUsage,
      metrics: metrics,
      model_used: modelUsed,
      prompt_version: promptVersion,
      disagreement_rows: disagreementRows,
    });
  }

  async releaseClaim(claimId) {
    return this.request('POST', '/research/release', { claim_id: claimId });
  }

  async getNextPeerReview() {
    return this.request('GET', '/research/review/next');
  }

  async getNextConsolidation() {
    // request() returns null when the server sends 204 ("nothing assigned"),
    // so callers can just check for a falsy result.
    return this.request('GET', '/research/consolidate/next');
  }

  async submitPeerReview(claimId, score, notes = null, updatedReport = null) {
    return this.request('POST', '/research/review/submit', {
      claim_id: claimId,
      score,
      notes,
      updated_report: updatedReport,
    });
  }

  async getStatus() {
    const response = await fetch(`${BASE_URL}/research/status`, {
      headers: this.headers(),
      signal: AbortSignal.timeout(15000),
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
