import { config } from '../config.js';
import { verifierService } from './verifier.js';

export class SchedulerService {
  constructor() {
    this.timerId = null;
    this.isActive = false;
    this.intervalMinutes = config.scheduler.intervalMinutes;
  }

  /**
   * Inicia o agendador de verificações
   * @param {boolean} runImmediately - Se deve disparar a primeira verificação de imediato
   */
  start(runImmediately = true) {
    if (this.isActive) {
      verifierService.addLog('warn', 'Agendador já está ativo.');
      return;
    }

    this.isActive = true;
    const intervalMs = this.intervalMinutes * 60 * 1000;

    verifierService.addLog(
      'info',
      `Agendador ATIVADO. Intervalo: a cada ${this.intervalMinutes} minutos (${Math.round(intervalMs / 1000)}s).`
    );

    this.updateNextRunTime();

    if (runImmediately) {
      // Dispara 3 segundos após a inicialização para permitir que o servidor web suba
      setTimeout(() => {
        if (this.isActive) {
          this.triggerCheck();
        }
      }, 3000);
    }

    this.timerId = setInterval(() => {
      this.triggerCheck();
    }, intervalMs);
  }

  stop() {
    if (this.timerId) {
      clearInterval(this.timerId);
      this.timerId = null;
    }
    this.isActive = false;
    verifierService.nextCheckTime = null;
    verifierService.addLog('warn', 'Agendador foi PAUSADO.');
  }

  updateNextRunTime() {
    const nextDate = new Date(Date.now() + this.intervalMinutes * 60 * 1000);
    verifierService.nextCheckTime = nextDate.toISOString();
  }

  async triggerCheck(options = {}) {
    this.updateNextRunTime();
    try {
      return await verifierService.runVerification(options);
    } catch (err) {
      verifierService.addLog('error', `Erro ao executar verificação agendada: ${err.message}`);
    }
  }

  getStatus() {
    return {
      isActive: this.isActive,
      intervalMinutes: this.intervalMinutes,
      nextCheckTime: verifierService.nextCheckTime,
      lastCheckTime: verifierService.lastCheckTime,
    };
  }
}

export const schedulerService = new SchedulerService();
