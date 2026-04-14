// HTTP client for the Fierce Philanthropy coordination API

const BASE_URL = process.env.FIERCE_API_URL || 'https://fierce-philanthropy-directory.laravel.cloud/api';

export class ApiClient {
  constructor(apiKey) {
    this.apiKey = apiKey;
    if (!apiKey) {
      throw new Error('TFG_API_KEY environment variable is required. Get your key at https://fierce-philanthropy-directory.laravel.cloud/contribute');
    }
  }

  async request(method, path, body = null) {
    const url = `${BASE_URL}${path}`;
    const options = {
      method,
      headers: {
        'X-TFG-Api-Key': this.apiKey,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      signal: AbortSignal.timeout(30000),
    };

    if (body) {
      options.body = JSON.stringify(body);
    }

    const response = await fetch(url, options);
    const data = await response.json();

    if (!response.ok) {
      const error = new Error(data.error || data.message || `API error ${response.status}`);
      error.status = response.status;
      error.data = data;
      throw error;
    }

    return data;
  }

  async claimOrg(platform = null) {
    return this.request('POST', '/research/claim', { platform });
  }

  async submitReport(claimId, reportMarkdown, tokenUsage = null, metrics = null, modelUsed = null, promptVersion = null) {
    return this.request('POST', '/research/submit', {
      claim_id: claimId,
      report_markdown: reportMarkdown,
      token_usage: tokenUsage,
      metrics: metrics,
      model_used: modelUsed,
      prompt_version: promptVersion,
    });
  }

  async releaseClaim(claimId) {
    return this.request('POST', '/research/release', { claim_id: claimId });
  }

  async getNextPeerReview() {
    return this.request('GET', '/research/review/next');
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
      headers: { 'Accept': 'application/json' },
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
