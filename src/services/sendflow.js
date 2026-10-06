import fs from 'fs';
import path from 'path';
import { config, ROOT_DIR } from '../config.js';

const CACHE_STORE_FILE = path.join(ROOT_DIR, '.sendflow_cache_store.json');
const ACTION_TRACKER_FILE = path.join(ROOT_DIR, '.sendflow_action_timestamps.json');

export class SendFlowClient {
  constructor() {
    this.releaseFetchTimestamps = new Map(); // releaseId -> timestamp
    this.cachedGroupsByRelease = new Map(); // releaseId -> groups array
    this.actionTimestamps = this.loadActionTimestamps();
    this.loadCacheStoreFromDisk();
  }

  loadActionTimestamps() {
    try {
      if (fs.existsSync(ACTION_TRACKER_FILE)) {
        const data = JSON.parse(fs.readFileSync(ACTION_TRACKER_FILE, 'utf-8'));
        const now = Date.now();
        const WINDOW_MS = 15 * 60 * 1000;
        if (Array.isArray(data)) {
          return data.filter(t => typeof t === 'number' && (now - t) < WINDOW_MS);
        }
      }
    } catch {}
    return [];
  }

  saveActionTimestamps() {
    try {
      fs.writeFileSync(ACTION_TRACKER_FILE, JSON.stringify(this.actionTimestamps, null, 2), 'utf-8');
    } catch {}
  }

  loadCacheStoreFromDisk() {
    try {
      if (fs.existsSync(CACHE_STORE_FILE)) {
        const raw = JSON.parse(fs.readFileSync(CACHE_STORE_FILE, 'utf-8'));
        if (raw && typeof raw === 'object') {
          for (const [releaseId, data] of Object.entries(raw)) {
            if (Array.isArray(data.groups)) {
              this.cachedGroupsByRelease.set(releaseId, data.groups);
              if (data.timestamp) {
                this.releaseFetchTimestamps.set(releaseId, data.timestamp);
              }
            }
          }
        }
      }
    } catch {}
  }

  saveCacheStoreToDisk() {
    try {
      const store = {};
      for (const [releaseId, groups] of this.cachedGroupsByRelease.entries()) {
        store[releaseId] = {
          groups,
          timestamp: this.releaseFetchTimestamps.get(releaseId) || Date.now(),
        };
      }
      fs.writeFileSync(CACHE_STORE_FILE, JSON.stringify(store, null, 2), 'utf-8');
    } catch {}
  }

  /**
   * Status global da trava de segurança da API do SendFlow.
   * Regra rígida: máximo de 4 alterações a cada 15 minutos para toda a conta.
   */
  getUpdateCooldownStatus() {
    const now = Date.now();
    const WINDOW_MS = 15 * 60 * 1000;
    this.actionTimestamps = this.actionTimestamps.filter(t => (now - t) < WINDOW_MS);
    this.saveActionTimestamps();

    const count = this.actionTimestamps.length;
    const canUpdate = count < 4;
    const oldest = this.actionTimestamps[0];
    const waitMs = oldest ? Math.max(0, (oldest + WINDOW_MS) - now) : 0;

    return {
      canUpdate,
      count,
      maxAllowed: 4,
      remainingCount: Math.max(0, 4 - count),
      waitMs,
      remainingMinutes: Math.ceil(waitMs / 60000),
      cooldownText: `${Math.ceil(waitMs / 60000)} min (${Math.round(waitMs / 1000)}s)`,
    };
  }

  getHeaders(isPost = false) {
    const token = (config.sendflow.apiKey || '').trim();
    const headers = {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/json',
    };
    if (isPost) {
      headers['Content-Type'] = 'application/json';
    }
    return headers;
  }

  /**
   * Busca os grupos de uma campanha específica no SendFlow com cache inteligente e proteção de rate-limit (10min por releaseId)
   * @param {string} releaseId 
   * @param {boolean} force 
   * @returns {Promise<{groups: Array, fromCache: boolean, message?: string}>}
   */
  async getGroups(releaseId = config.sendflow.releaseId, force = false) {
    if (!releaseId || !releaseId.trim()) {
      throw new Error('SendFlow releaseId não informado.');
    }

    const cleanReleaseId = releaseId.trim();
    const now = Date.now();
    const lastFetch = this.releaseFetchTimestamps.get(cleanReleaseId) || 0;
    const elapsedSinceLast = now - lastFetch;
    const TEN_MINUTES_MS = 10 * 60 * 1000;

    const cached = this.cachedGroupsByRelease.get(cleanReleaseId) || [];

    // Se temos grupos em cache e a última requisição desta campanha foi há menos de 10 min
    if (!force && cached.length > 0 && elapsedSinceLast < TEN_MINUTES_MS) {
      const remainingMinutes = Math.ceil((TEN_MINUTES_MS - elapsedSinceLast) / 60000);
      return {
        groups: cached,
        fromCache: true,
        message: `Grupos obtidos do cache local para release ${cleanReleaseId} (~${remainingMinutes} min de cooldown da API SendFlow).`,
      };
    }

    const url = `${config.sendflow.baseUrl}/releases/${cleanReleaseId}/groups`;

    try {
      this.releaseFetchTimestamps.set(cleanReleaseId, Date.now());
      const response = await fetch(url, {
        method: 'GET',
        headers: this.getHeaders(),
      });

      if (response.status === 403) {
        const text = await response.text();
        let retryAfterMs = null;
        try {
          const errJson = JSON.parse(text);
          retryAfterMs = errJson.retryAfterMs;
        } catch {}

        const remainingText = retryAfterMs
          ? `${Math.ceil(retryAfterMs / 60000)} min (${Math.round(retryAfterMs / 1000)}s)`
          : 'alguns minutos';

        if (cached.length > 0) {
          return {
            groups: cached,
            fromCache: true,
            message: `SendFlow em cooldown de 10 min. Próxima consulta em ~${remainingText}. Usando ${cached.length} grupos em cache.`,
          };
        }
        throw new Error(`SendFlow 403 (Rate limit de 10 min por campanha). Aguarde ~${remainingText}: ${text}`);
      }

      if (response.status === 401) {
        throw new Error('SendFlow 401 - Não autenticado ou API Key inválida/sem permissões.');
      }

      if (response.status === 404) {
        throw new Error(`SendFlow 404 - Campanha não encontrada (releaseId: ${cleanReleaseId}).`);
      }

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`SendFlow HTTP ${response.status} ao buscar grupos da campanha ${cleanReleaseId}: ${text}`);
      }

      const rawData = await response.json();

      let flatGroups = [];
      if (Array.isArray(rawData)) {
        flatGroups = Array.isArray(rawData[0]) ? rawData.flat() : rawData;
      } else if (rawData && Array.isArray(rawData.groups)) {
        flatGroups = rawData.groups;
      }

      this.cachedGroupsByRelease.set(cleanReleaseId, flatGroups);
      this.saveCacheStoreToDisk();

      return {
        groups: flatGroups,
        fromCache: false,
        message: `${flatGroups.length} grupos obtidos com sucesso do SendFlow (Release: ${cleanReleaseId}).`,
      };
    } catch (error) {
      if (cached.length > 0) {
        return {
          groups: cached,
          fromCache: true,
          message: `Aviso SendFlow (${error.message}). Utilizando ${cached.length} grupos em cache para a campanha.`,
        };
      }
      throw error;
    }
  }

  /**
   * Obtém grupos em cache de uma campanha
   * @param {string} releaseId 
   */
  getCachedGroups(releaseId) {
    if (!releaseId) return [];
    return this.cachedGroupsByRelease.get(releaseId) || [];
  }

  /**
   * Dispara a ação de atualizar link de convite para os grupos selecionados com trava de segurança global
   * @param {string|string[]} groupIds
   * @param {string} releaseId
   * @param {object} [options]
   */
  async updateGroupInviteCode(groupIds, releaseId = config.sendflow.releaseId, options = {}) {
    if (!releaseId) {
      throw new Error('SendFlow releaseId não informado.');
    }

    const ids = Array.isArray(groupIds) ? groupIds : [groupIds];
    if (ids.length === 0) {
      throw new Error('Nenhum grupo informado para atualizar link.');
    }

    // TRAVA DE SEGURANÇA GLOBAL: Máximo de 4 alterações a cada 15 minutos em toda a conta
    const safety = this.getUpdateCooldownStatus();
    if (!safety.canUpdate) {
      const err = new Error(
        `Trava de Segurança: Limite de 4 atualizações a cada 15 min atingido (${safety.count}/4). Aguarde ${safety.cooldownText} para proteger sua chave de API.`
      );
      err.isSafetyLimit = true;
      err.cooldownText = safety.cooldownText;
      err.remainingMinutes = safety.remainingMinutes;
      throw err;
    }

    const accountsFrom = options.accountsFrom || config.sendflow.accountsFrom || 'release';
    const accounts = options.accounts || config.sendflow.accounts || [];

    const cleanReleaseId = releaseId.trim();
    const cachedGroups = this.getCachedGroups(cleanReleaseId);

    // Converte e higieniza para o gID numérico do WhatsApp sem sufixos (@g.us)
    const formattedIds = ids.map(item => {
      let raw = typeof item === 'object' && item !== null ? (item.gid || item.jid || item.id || '') : String(item);
      raw = raw.trim();

      // Se for um ID interno do SendFlow (alfanumérico de documento), tenta resolver para o gID real no cache
      if (raw && !raw.includes('@') && !/^\d+(-\d+)?$/.test(raw)) {
        let found = cachedGroups.find(g => String(g.id) === raw);
        if (!found) {
          for (const groups of this.cachedGroupsByRelease.values()) {
            found = groups.find(g => String(g.id) === raw);
            if (found) break;
          }
        }
        if (found && (found.gid || found.jid)) {
          raw = String(found.gid || found.jid);
        }
      }

      // Remove sufixos como @g.us ou @s.whatsapp.net
      return raw.replace(/@(g\.us|s\.whatsapp\.net)$/i, '').trim();
    }).filter(Boolean);

    if (formattedIds.length === 0) {
      throw new Error('Nenhum gID numérico válido pôde ser extraído para os grupos informados.');
    }

    const payload = {
      releaseId: cleanReleaseId,
      accountsFrom,
      to: {
        type: 'groups',
        ids: formattedIds,
      },
    };

    if (accountsFrom === 'accounts' && accounts.length > 0) {
      payload.accounts = accounts;
    }

    const url = `${config.sendflow.baseUrl}/actions/update-group-invite-code`;

    const response = await fetch(url, {
      method: 'POST',
      headers: this.getHeaders(true),
      body: JSON.stringify(payload),
    });

    const responseText = await response.text();
    let data;
    try {
      data = JSON.parse(responseText);
    } catch {
      data = { raw: responseText };
    }

    if (response.status === 201) {
      this.actionTimestamps.push(Date.now());
      this.saveActionTimestamps();

      const quotaMsg = `[Uso seguro: ${this.actionTimestamps.length}/4 ações nos últimos 15 min]`;
      return {
        success: true,
        message: `${data.message || 'Ação criada com sucesso no SendFlow'} ${quotaMsg}`,
        actionId: data.actionId || data.id,
        quotaUsed: this.actionTimestamps.length,
        quotaRemaining: Math.max(0, 4 - this.actionTimestamps.length),
      };
    }

    if (response.status === 403) {
      throw new Error(`SendFlow 403 Rate Limit ao atualizar convite: ${responseText}`);
    }

    if (response.status === 401) {
      throw new Error('SendFlow 401: Chave de API sem autorização para ações.');
    }

    throw new Error(`SendFlow erro (${response.status}) ao atualizar convite: ${responseText}`);
  }
}

export const sendflowClient = new SendFlowClient();
