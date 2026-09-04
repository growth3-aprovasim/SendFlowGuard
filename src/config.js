import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// Carregar variáveis de ambiente
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const ROOT_DIR = path.resolve(__dirname, '..');

export const config = {
  sendflow: {
    apiKey: process.env.SENDFLOW_API_KEY || '',
    baseUrl: (process.env.SENDFLOW_BASE_URL || 'https://sendapi.sendflow.pro').replace(/\/+$/, ''),
    releaseId: process.env.SENDFLOW_RELEASE_ID || '',
    accountsFrom: process.env.ACCOUNTS_FROM || 'release',
    accounts: (process.env.ACCOUNTS_IDS || '')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean),
    recheckDelaySeconds: Math.max(10, parseInt(process.env.RECHECK_DELAY_SECONDS || '60', 10)),
  },
  scheduler: {
    // Mínimo de segurança: 1 minuto (embora a API do Sendflow recomende 10 min por releaseId)
    intervalMinutes: Math.max(1, parseInt(process.env.CHECK_INTERVAL_MINUTES || '10', 10)),
    autoStart: process.env.AUTO_START_SCHEDULER !== 'false',
  },
  server: {
    port: parseInt(process.env.PORT || '3000', 10),
    enabled: process.env.ENABLE_WEB_DASHBOARD !== 'false',
  },
  notifications: {
    slackWebhookUrl: process.env.SLACK_WEBHOOK_URL || '',
    discordWebhookUrl: process.env.DISCORD_WEBHOOK_URL || '',
    telegramBotToken: process.env.TELEGRAM_BOT_TOKEN || '',
    telegramChatId: process.env.TELEGRAM_CHAT_ID || '',
  },
  masterLink: {
    url: (process.env.MASTER_LINK_URL || '').trim(),
    intervalSeconds: Math.max(10, parseInt(process.env.MASTER_LINK_INTERVAL_SECONDS || '60', 10)),
    enabled: Boolean((process.env.MASTER_LINK_URL || '').trim()),
  }
};

/**
 * Validação básica das credenciais do SendFlow
 */
export function validateConfig() {
  const warnings = [];
  const errors = [];

  if (!config.sendflow.apiKey || config.sendflow.apiKey === 'sua_chave_de_api_aqui') {
    errors.push('SENDFLOW_API_KEY não está configurada no .env');
  }

  if (!config.sendflow.releaseId || config.sendflow.releaseId === 'id_da_sua_campanha_aqui') {
    errors.push('SENDFLOW_RELEASE_ID não está configurada no .env');
  }

  if (config.scheduler.intervalMinutes < 10) {
    warnings.push(
      `CHECK_INTERVAL_MINUTES está definido como ${config.scheduler.intervalMinutes} min. A API do SendFlow possui limite de 10 min por releaseId. Caso haja requisições frequentes, a API responderá 403.`
    );
  }

  if (config.sendflow.accountsFrom === 'accounts' && config.sendflow.accounts.length === 0) {
    errors.push('ACCOUNTS_FROM está definido como "accounts", mas nenhum ID foi informado em ACCOUNTS_IDS.');
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
  };
}
