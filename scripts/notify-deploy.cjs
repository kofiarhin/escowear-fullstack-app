#!/usr/bin/env node
'use strict';

// Telegram alert for the Deploy workflow's automatic production runs. Reads the gate,
// publish and deploy job results and sends one message, or none when nothing was
// attempted (superseded, waiting or blocked by the gate). An alert is best effort: any
// problem is a workflow warning and the script still exits 0, so a failed notification
// never changes the deployment result. The bot token and chat ID are never printed.
const TELEGRAM_TIMEOUT_MS = 10_000;

// Job results are success | failure | cancelled | skipped (or empty when a job never ran).
// superseded: master has moved past this commit, so a cancelled run was most likely a
// queued request replaced by a newer one, which sends its own alert.
function outcome({ gate, publish, deploy, deployed, superseded = false }) {
  if (superseded && [gate, publish, deploy].includes('cancelled')) return null;
  if (gate === 'failure') return { status: 'failure', stage: 'deploy gate' };
  if (gate === 'cancelled') return { status: 'cancelled', stage: 'deploy gate' };
  if (publish === 'failure') return { status: 'failure', stage: 'image publishing' };
  if (publish === 'cancelled') return { status: 'cancelled', stage: 'image publishing' };
  if (deploy === 'failure') return { status: 'failure', stage: 'deployment' };
  if (deploy === 'cancelled') return { status: 'cancelled', stage: 'deployment' };
  if (deploy === 'success' && deployed === 'true') return { status: 'success', stage: 'deployment' };
  return null;
}

const HEADLINES = {
  success: '✅ ESCOWEAR production deployment succeeded',
  failure: '❌ ESCOWEAR production deployment FAILED',
  cancelled: '⚠️ ESCOWEAR production deployment CANCELLED',
};
const IMPACT = {
  'deploy gate': 'Nothing was published or deployed; production is unchanged.',
  'image publishing': 'Nothing was deployed; production is unchanged.',
  // Beast runs deploy.sh detached, so a dropped connection or a cancelled job does not
  // stop it; only Beast's log says how the release ended.
  deployment: {
    failure: 'Beast refused or failed the release (production kept or rolled back to the previous one), or the connection dropped. Check the Beast deploy log before acting.',
    cancelled: 'Beast may still be finishing this release. Check the Beast deploy log and the live site before acting.',
  },
};

function message({ status, stage }, { sha, runUrl, timestamp }) {
  const lines = [
    HEADLINES[status],
    `Status: ${status.toUpperCase()}${status === 'success' ? '' : ` at ${stage}`}`,
    `Commit: ${sha}`,
    `Time: ${timestamp}`,
    `Run: ${runUrl}`,
  ];
  if (status !== 'success') lines.push(typeof IMPACT[stage] === 'string' ? IMPACT[stage] : IMPACT[stage][status]);
  return lines.join('\n');
}

async function send({ token, chatId, text, request = fetch }) {
  const response = await request(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
    signal: AbortSignal.timeout(TELEGRAM_TIMEOUT_MS),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.ok !== true) {
    throw new Error(`Telegram API returned HTTP ${response.status}${body.description ? `: ${body.description}` : ''}`);
  }
}

function redact(text, secrets) {
  return secrets.filter(Boolean).reduce((out, secret) => out.split(secret).join('***'), String(text));
}

async function main(env = process.env, { request = fetch, now = () => new Date(), log = console.log } = {}) {
  const result = outcome({
    gate: env.GATE_RESULT, publish: env.PUBLISH_RESULT, deploy: env.DEPLOY_RESULT, deployed: env.DEPLOYED,
    superseded: env.SUPERSEDED === 'true',
  });
  if (!result) {
    log('::notice::No deployment was attempted, or a newer commit replaced it; no Telegram alert sent');
    return 'none';
  }
  const token = env.TELEGRAM_BOT_TOKEN;
  const chatId = env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    log('::warning::TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID is not configured; no Telegram alert sent');
    return 'unconfigured';
  }
  const text = message(result, {
    sha: /^[0-9a-f]{40}$/.test(env.SHA ?? '') ? env.SHA : 'unknown',
    runUrl: env.RUN_URL || 'unknown',
    timestamp: now().toISOString(),
  });
  try {
    await send({ token, chatId, text, request });
  } catch (error) {
    log(`::warning::Telegram alert not sent (${result.status}): ${redact(error.message, [token, chatId])}`);
    return 'failed';
  }
  log(`::notice::Telegram alert sent: ${result.status}`);
  return 'sent';
}

if (require.main === module) {
  main().catch(error => {
    // Unreachable in practice; still never fail the workflow over an alert.
    console.log(`::warning::Telegram alert crashed: ${redact(error.message, [process.env.TELEGRAM_BOT_TOKEN, process.env.TELEGRAM_CHAT_ID])}`);
  });
}

module.exports = { outcome, message, send, redact, main };
