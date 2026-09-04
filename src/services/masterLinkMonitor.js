import { config } from '../config.js';
import { MasterLinkChecker } from './masterLinkChecker.js';
import { verifierService } from './verifier.js';
import { Notifier } from './notifier.js';

export class MasterLinkMonitor {
  constructor() {
    this.timerId = null;
    this.isActive = false;
    this.isChecking = false;
    this.lastResult = null;
    this.nextCheckTime = null;
    this.history = [];
    this.consecutiveFailures = 0;
  }

  get url() {
    return config.masterLink.url;
  }

  get intervalSeconds() {
    return config.masterLink.intervalSeconds;
  }

  get isEnabled() {
    return Boolean(this.url);
  }

  start() {
    if (!this.isEnabled) {
      verifierService.addLog('info', 'Link Mãe não configurado no .env (MASTER_LINK_URL em branco). Monitoramento do Link Mãe inativo.');
      return;
    }

    if (this.isActive) return;

    this.isActive = true;
    verifierService.addLog(
      'info',
      `👑 Monitor do Link Mãe ATIVADO. Verificando a cada ${this.intervalSeconds}s (${this.url})`
    );

    // Executa a primeira checagem após 2s
    setTimeout(() => {
      if (this.isActive) this.checkNow();
    }, 2000);

    this.timerId = setInterval(() => {
      this.checkNow();
    }, this.intervalSeconds * 1000);
  }

  stop() {
    if (this.timerId) {
      clearInterval(this.timerId);
      this.timerId = null;
    }
    this.isActive = false;
    this.nextCheckTime = null;
  }

  async checkNow() {
    if (!this.isEnabled) {
      return { isOnline: false, message: 'MASTER_LINK_URL não definido.' };
    }

    if (this.isChecking) return this.lastResult;
    this.isChecking = true;

    this.nextCheckTime = new Date(Date.now() + this.intervalSeconds * 1000).toISOString();

    try {
      const result = await MasterLinkChecker.check(this.url);
      const previousResult = this.lastResult;
      this.lastResult = result;

      // Adiciona ao histórico (máx 30)
      this.history.unshift(result);
      if (this.history.length > 30) this.history.pop();

      // Log e Alertas
      if (result.status === 'OPERATIONAL') {
        if (this.consecutiveFailures > 0) {
          // Recuperou de uma queda!
          verifierService.addLog('success', `🟢 [LINK MÃE RECUPERADO] ${result.message}`);
          Notifier.notify({
            type: 'MASTER_LINK_RECOVERED',
            url: this.url,
            finalUrl: result.finalUrl,
          }).catch(() => {});
        }
        this.consecutiveFailures = 0;
      } else if (result.status === 'DESTINATION_REVOKED') {
        this.consecutiveFailures++;
        verifierService.addLog('error', `🚨 [LINK MÃE COM PROBLEMA] ${result.message}`);
        Notifier.notify({
          type: 'MASTER_LINK_DESTINATION_REVOKED',
          url: this.url,
          finalUrl: result.finalUrl,
        }).catch(() => {});
      } else {
        // OFFLINE
        this.consecutiveFailures++;
        verifierService.addLog('error', `💥 [LINK MÃE FORA DO AR] ${result.message}`);
        if (this.consecutiveFailures === 1 || this.consecutiveFailures % 5 === 0) {
          Notifier.notify({
            type: 'MASTER_LINK_DOWN',
            url: this.url,
            error: result.message,
          }).catch(() => {});
        }
      }

      return result;
    } catch (err) {
      verifierService.addLog('error', `Erro na verificação do Link Mãe: ${err.message}`);
    } finally {
      this.isChecking = false;
    }
  }

  getStatus() {
    return {
      isEnabled: this.isEnabled,
      isActive: this.isActive,
      url: this.url,
      intervalSeconds: this.intervalSeconds,
      nextCheckTime: this.nextCheckTime,
      lastResult: this.lastResult,
      history: this.history.slice(0, 10),
    };
  }
}

export const masterLinkMonitor = new MasterLinkMonitor();
