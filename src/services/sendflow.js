import fs from 'fs';
import path from 'path';
import { config, ROOT_DIR } from '../config.js';

const CACHE_FILE = path.join(ROOT_DIR, '.sendflow_groups_cache.json');
const ACTION_TRACKER_FILE = path.join(ROOT_DIR, '.sendflow_action_timestamps.json');

export class SendFlowClient {
  constructor() {
    this.lastGetTimestamp = 0;
    this.cachedGroups = [];
    this.lastSuccessfulFetchTime = null;
    this.actionTimestamps = this.loadActionTimestamps();
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

  /**
   * Verifica se a API do SendFlow pode receber uma nova ação de atualização.
   * Regra rígida de segurança: máximo de 4 alterações a cada 15 minutos.
   * A quinta chamada derruba a chave de API.
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
   * Busca os grupos da campanha no SendFlow
   * @param {string} releaseId 
   * @param {boolean} force - Se deve forçar chamada mesmo se recente
   * @returns {Promise<{groups: Array, fromCache: boolean, message?: string}>}
   */
  async getGroups(releaseId = config.sendflow.releaseId, force = false) {
    if (!releaseId) {
      throw new Error('SendFlow releaseId não informado.');
    }

    const now = Date.now();
    const elapsedSinceLast = now - this.lastGetTimestamp;
    const TEN_MINUTES_MS = 10 * 60 * 1000;

    // Se temos grupos em cache e a última requisição foi há menos de 10 minutos (e não é forçado),
    // podemos retornar o cache ou avisar para evitar o rate-limit 403
    if (!force && this.cachedGroups.length > 0 && elapsedSinceLast < TEN_MINUTES_MS) {
      const remainingMinutes = Math.ceil((TEN_MINUTES_MS - elapsedSinceLast) / 60000);
      return {
        groups: this.cachedGroups,
        fromCache: true,
        message: `Grupos obtidos do cache local (cooldown de rate-limit da API SendFlow: ~${remainingMinutes} min restantes).`,
      };
    }

    const url = `${config.sendflow.baseUrl}/releases/${releaseId}/groups`;

    try {
      this.lastGetTimestamp = Date.now();
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

        // Tenta carregar do cache em memória ou do disco
        const groups = this.getCachedGroups();
        if (groups.length > 0) {
          return {
            groups,
            fromCache: true,
            message: `SendFlow em cooldown de rate-limit (10min). Próxima consulta liberada em ~${remainingText}. Usando ${groups.length} grupos em cache.`,
          };
        }
        throw new Error(`SendFlow 403 (Rate limit de 10 min por campanha). Aguarde ~${remainingText} para nova consulta: ${text}`);
      }

      if (response.status === 401) {
        throw new Error('SendFlow 401 - Não autenticado ou API Key inválida/sem permissões.');
      }

      if (response.status === 404) {
        throw new Error(`SendFlow 404 - Campanha não encontrada (releaseId: ${releaseId}).`);
      }

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`SendFlow HTTP ${response.status} ao buscar grupos: ${text}`);
      }

      const rawData = await response.json();

      // Normaliza array caso a API retorne aninhado [[{...}]] ou plano [{...}]
      let flatGroups = [];
      if (Array.isArray(rawData)) {
        flatGroups = Array.isArray(rawData[0]) ? rawData.flat() : rawData;
      } else if (rawData && Array.isArray(rawData.groups)) {
        flatGroups = rawData.groups;
      }

      this.cachedGroups = flatGroups;
      this.lastSuccessfulFetchTime = new Date();
      this.saveCacheToDisk(flatGroups);

      return {
        groups: flatGroups,
        fromCache: false,
        message: `${flatGroups.length} grupos obtidos com sucesso do SendFlow.`,
      };
    } catch (error) {
      const groups = this.getCachedGroups();
      if (groups.length > 0) {
        return {
          groups,
          fromCache: true,
          message: `Aviso SendFlow (${error.message}). Utilizando ${groups.length} grupos em cache.`,
        };
      }
      throw error;
    }
  }

  getCachedGroups() {
    if (this.cachedGroups.length > 0) return this.cachedGroups;
    try {
      if (fs.existsSync(CACHE_FILE)) {
        const content = fs.readFileSync(CACHE_FILE, 'utf-8');
        const parsed = JSON.parse(content);
        if (Array.isArray(parsed) && parsed.length > 0) {
          this.cachedGroups = parsed;
          return parsed;
        }
      }
    } catch {}
    return [];
  }

  saveCacheToDisk(groups) {
    try {
      fs.writeFileSync(CACHE_FILE, JSON.stringify(groups, null, 2), 'utf-8');
    } catch {}
  }

  /**
   * Dispara a ação de atualizar link de convite para os grupos selecionados
   * @param {string|string[]} groupIds - ID ou lista de IDs dos grupos
   * @param {string} [releaseId]
   * @returns {Promise<{message: string, id?: string, actionId?: string}>}
   */
  async updateGroupInviteCode(groupIds, releaseId = config.sendflow.releaseId) {
    if (!releaseId) {
      throw new Error('SendFlow releaseId não informado.');
    }

    const ids = Array.isArray(groupIds) ? groupIds : [groupIds];
    if (ids.length === 0) {
      throw new Error('Nenhum grupo informado para atualizar link.');
    }

    // TRAVA DE SEGURANÇA: Máximo de 4 alterações a cada 15 minutos
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

    const payload = {
      releaseId,
      accountsFrom: config.sendflow.accountsFrom,
      to: {
        type: 'groups',
        ids: ids.map(id => String(id)),
      },
    };

    if (config.sendflow.accountsFrom === 'accounts') {
      payload.accounts = config.sendflow.accounts;
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
      // Registra a ação executada com sucesso
      this.actionTimestamps.push(Date.now());
      this.saveActionTimestamps();

      const quotaMsg = `[Uso seguro: ${this.actionTimestamps.length}/4 ações na janela de 15 min]`;
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
