import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

import fs from 'fs';

// Carregar variáveis de ambiente
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const ROOT_DIR = path.resolve(__dirname, '..');

// Diretório centralizado de dados persistentes para Easypanel / Docker Volumes
export const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(ROOT_DIR, 'data');

/**
 * Garante que o diretório DATA_DIR existe e migra arquivos existentes da raiz caso necessário
 */
export function ensureDataDirAndMigrate() {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }

    // Lista de arquivos e diretórios que devem persistir no volume
    const filesToMigrate = [
      'campaigns.json',
      'antihacker_config.json',
      'antihacker_campaigns.json',
      'blacklist_aegis.json',
      'estatisticas_aegis.json',
      '.sendflow_cache_store.json',
      '.sendflow_groups_cache.json',
      '.sendflow_action_timestamps.json',
    ];

    for (const filename of filesToMigrate) {
      const src = path.join(ROOT_DIR, filename);
      const dest = path.join(DATA_DIR, filename);
      if (fs.existsSync(src) && !fs.existsSync(dest)) {
        try {
          fs.copyFileSync(src, dest);
          console.log(`[Persistence] Migrado ${filename} para ${DATA_DIR}`);
        } catch {}
      }
    }

    // Migração de pastas de sessão do Baileys
    try {
      const entries = fs.readdirSync(ROOT_DIR);
      for (const entry of entries) {
        if (entry.startsWith('auth_') && entry !== 'node_modules') {
          const srcDir = path.join(ROOT_DIR, entry);
          const destDir = path.join(DATA_DIR, entry);
          if (fs.existsSync(srcDir) && fs.statSync(srcDir).isDirectory() && !fs.existsSync(destDir)) {
            try {
              fs.cpSync(srcDir, destDir, { recursive: true });
              console.log(`[Persistence] Sessão migrada: ${entry} -> ${DATA_DIR}`);
            } catch {}
          }
        }
      }
    } catch {}
  } catch (err) {
    console.error('[Persistence] Erro ao preparar DATA_DIR:', err.message);
  }
}

// Inicializa no carregamento do config
ensureDataDirAndMigrate();

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
    // Intervalo padrão entre ciclos de verificação
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
    errors.push('SENDFLOW_API_KEY não está configurada no arquivo .env');
  }

  if (config.scheduler.intervalMinutes < 10) {
    warnings.push(
      `CHECK_INTERVAL_MINUTES está definido como ${config.scheduler.intervalMinutes} min. A API do SendFlow recomenda intervalo seguro de 10 min por campanha.`
    );
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
  };
}
