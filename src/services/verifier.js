import { config } from '../config.js';
import { sendflowClient } from './sendflow.js';
import { WhatsAppChecker } from './whatsappChecker.js';
import { Notifier } from './notifier.js';

export class VerifierService {
  constructor() {
    this.isRunning = false;
    this.lastCheckTime = null;
    this.nextCheckTime = null;
    this.groupsStatus = new Map(); // id -> status details
    this.history = [];
    this.logs = [];
    this.stats = {
      totalChecks: 0,
      totalGroups: 0,
      validCount: 0,
      revokedCount: 0,
      recoveredCount: 0,
      errorCount: 0,
    };
  }

  addLog(level, message, extra = null) {
    const entry = {
      id: Date.now() + Math.random().toString(36).substring(2, 6),
      timestamp: new Date().toISOString(),
      timeFormatted: new Date().toLocaleTimeString('pt-BR'),
      level, // 'info' | 'success' | 'warn' | 'error'
      message,
      extra,
    };

    this.logs.unshift(entry);
    if (this.logs.length > 500) {
      this.logs.pop();
    }

    const prefixes = {
      info: 'ℹ️ [INFO]',
      success: '✅ [SUCCESS]',
      warn: '⚠️ [WARN]',
      error: '❌ [ERROR]',
    };

    console.log(`${entry.timeFormatted} ${prefixes[level] || '[LOG]'} ${message}`);
  }

  /**
   * Executa a verificação completa de todos os grupos da campanha
   * @param {object} options
   */
  async runVerification(options = {}) {
    if (this.isRunning) {
      this.addLog('warn', 'Verificação já está em execução no momento. Ignorando solicitação duplicada.');
      return { success: false, message: 'Verificação em andamento.' };
    }

    this.isRunning = true;
    this.stats.totalChecks++;
    this.addLog('info', `=== Iniciando ciclo #${this.stats.totalChecks} de verificação de grupos ===`);

    const summary = {
      cycleId: this.stats.totalChecks,
      startedAt: new Date().toISOString(),
      total: 0,
      valid: 0,
      revoked: 0,
      recovered: 0,
      errors: 0,
      groups: [],
    };

    try {
      // 1. Obter grupos da campanha no SendFlow
      this.addLog('info', `Buscando grupos da campanha ${config.sendflow.releaseId}...`);
      const { groups, fromCache, message: groupsMsg } = await sendflowClient.getGroups(
        config.sendflow.releaseId,
        options.forceRefreshGroups
      );

      this.addLog(fromCache ? 'warn' : 'info', groupsMsg);
      summary.total = groups.length;
      this.stats.totalGroups = groups.length;

      if (groups.length === 0) {
        this.addLog('warn', 'Nenhum grupo encontrado na campanha informada.');
        this.isRunning = false;
        this.lastCheckTime = new Date().toISOString();
        return summary;
      }

      // 2. Verificar cada grupo
      for (let i = 0; i < groups.length; i++) {
        const group = groups[i];
        const groupIndexLabel = `[${i + 1}/${groups.length}]`;
        const inviteCode = group.inviteCode;

        if (!inviteCode) {
          this.addLog('warn', `${groupIndexLabel} Grupo "${group.name}" (ID: ${group.id}) não possui inviteCode configurado.`);
          summary.errors++;
          this.stats.errorCount++;
          this.updateGroupMemory(group, {
            isValid: false,
            status: 'NO_INVITE_CODE',
            message: 'Sem inviteCode no SendFlow',
          });
          continue;
        }

        const linkUrl = `https://chat.whatsapp.com/${inviteCode}`;
        this.addLog('info', `${groupIndexLabel} Verificando "${group.name}" (${linkUrl})...`);

        const checkResult = await WhatsAppChecker.checkInvite(inviteCode);

        if (checkResult.isValid) {
          // Link saudável
          this.addLog(
            'success',
            `${groupIndexLabel} Link Ativo: "${group.name}" (${checkResult.title}) em ${checkResult.durationMs}ms`
          );
          summary.valid++;
          this.updateGroupMemory(group, checkResult);
        } else {
          // Link quebrado / revogado!
          this.addLog(
            'error',
            `${groupIndexLabel} 🚨 LINK QUEBRADO no grupo "${group.name}" (ID: ${group.id})! Status: ${checkResult.status} (${checkResult.message})`
          );
          summary.revoked++;
          this.stats.revokedCount++;

          this.updateGroupMemory(group, {
            ...checkResult,
            status: 'REVOKED',
          });

          // Notificação de alerta
          Notifier.notify({
            type: 'LINK_REVOKED',
            group,
            oldLink: linkUrl,
          }).catch(() => {});

          // Disparar ação de recuperação no SendFlow
          await this.handleBrokenGroup(group, linkUrl, summary);
        }

        // Intervalo com jitter entre requisições para evitar rate-limit e bloqueio de IP no WhatsApp
        const delayBetweenGroups = 1200 + Math.floor(Math.random() * 800);
        await new Promise(r => setTimeout(r, delayBetweenGroups));
      }

      summary.finishedAt = new Date().toISOString();
      this.lastCheckTime = summary.finishedAt;
      this.stats.validCount = summary.valid;

      this.addLog(
        'info',
        `=== Ciclo concluído: ${summary.total} analisados | ${summary.valid} válidos | ${summary.revoked} revogados | ${summary.recovered} recuperados ===`
      );

      this.history.unshift(summary);
      if (this.history.length > 50) this.history.pop();

      return summary;
    } catch (error) {
      this.addLog('error', `Erro crítico durante verificação: ${error.message}`);
      summary.error = error.message;
      return summary;
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Processa a recuperação automática de um grupo com link quebrado
   */
  async handleBrokenGroup(group, oldUrl, summary) {
    try {
      // 🛡️ TRAVA RÍGIDA DE SEGURANÇA: Limite de 4 atualizações a cada 15 minutos
      // A quinta chamada derruba a chave de API na SendFlow.
      const safety = sendflowClient.getUpdateCooldownStatus();
      if (!safety.canUpdate) {
        this.addLog(
          'warn',
          `🛑 [TRAVA DE SEGURANÇA] Limite de 4 alterações nos últimos 15 min atingido! O grupo "${group.name}" aguardará ${safety.cooldownText} para renovação segura da chave.`
        );
        this.updateGroupMemory(group, {
          isValid: false,
          status: 'QUEUED_RATE_LIMIT',
          message: `Aguardando cooldown de 15 min da API (${safety.cooldownText})`,
        });

        Notifier.notify({
          type: 'RATE_LIMIT_SAFETY',
          group,
          cooldownText: safety.cooldownText,
        }).catch(() => {});
        return;
      }

      this.addLog('warn', `[Auto-Recuperação] Solicitando novo link para o grupo "${group.name}" no SendFlow (${safety.count + 1}/4 na janela)...`);
      
      const updateResult = await sendflowClient.updateGroupInviteCode(group.id);
      this.addLog('success', `[Auto-Recuperação] ${updateResult.message} (Action ID: ${updateResult.actionId || 'ok'})`);

      const delaySec = config.sendflow.recheckDelaySeconds;
      this.addLog('info', `[Auto-Recuperação] Aguardando ${delaySec}s para reteste do link...`);

      // Espera o tempo para propagação
      await new Promise(r => setTimeout(r, delaySec * 1000));

      // Tenta buscar os grupos atualizados no SendFlow
      this.addLog('info', `[Auto-Recuperação] Consultando novo inviteCode no SendFlow para "${group.name}"...`);
      
      let updatedGroup = null;
      try {
        const fetchRes = await sendflowClient.getGroups(config.sendflow.releaseId, true);
        updatedGroup = fetchRes.groups.find(g => String(g.id) === String(group.id));
      } catch (getErr) {
        this.addLog('warn', `[Auto-Recuperação] Não foi possível consultar novo grupo agora (${getErr.message}). Será validado no próximo ciclo.`);
        return;
      }

      if (updatedGroup && updatedGroup.inviteCode && updatedGroup.inviteCode !== group.inviteCode) {
        const newUrl = `https://chat.whatsapp.com/${updatedGroup.inviteCode}`;
        this.addLog('info', `[Auto-Recuperação] Novo código detectado: ${updatedGroup.inviteCode}. Testando no WhatsApp...`);

        const recheckResult = await WhatsAppChecker.checkInvite(updatedGroup.inviteCode);
        if (recheckResult.isValid) {
          this.addLog('success', `🎉 SUCESSO! Novo link do grupo "${group.name}" está ATIVO e funcionando!`);
          summary.recovered++;
          this.stats.recoveredCount++;

          this.updateGroupMemory(updatedGroup, {
            ...recheckResult,
            status: 'RECOVERED',
          });

          Notifier.notify({
            type: 'LINK_RECOVERED',
            group: updatedGroup,
            newLink: newUrl,
          }).catch(() => {});
        } else {
          this.addLog('error', `[Auto-Recuperação] O novo link gerado ainda não está respondendo como válido.`);
          this.updateGroupMemory(updatedGroup, recheckResult);
        }
      } else {
        this.addLog(
          'warn',
          `[Auto-Recuperação] O SendFlow ainda não atualizou o inviteCode do grupo "${group.name}". A ação foi enviada e será checada novamente no próximo ciclo.`
        );
      }
    } catch (err) {
      this.addLog('error', `[Auto-Recuperação] Falha ao recuperar grupo "${group.name}": ${err.message}`);
      Notifier.notify({
        type: 'RECOVERY_FAILED',
        group,
        error: err.message,
      }).catch(() => {});
    }
  }

  /**
   * Força a renovação manual de um grupo específico
   */
  async renewGroupManually(groupId) {
    this.addLog('info', `[Manual] Renovação de link solicitada manualmente para o grupo ID: ${groupId}`);
    const res = await sendflowClient.updateGroupInviteCode(groupId);
    this.addLog('success', `[Manual] Ação enviada com sucesso: ${res.message}`);
    return res;
  }

  updateGroupMemory(group, checkResult) {
    const existing = this.groupsStatus.get(String(group.id)) || {};
    this.groupsStatus.set(String(group.id), {
      ...existing,
      ...group,
      lastCheckResult: checkResult,
      status: checkResult.status || (checkResult.isValid ? 'VALID' : 'REVOKED'),
      isValid: checkResult.isValid,
      lastCheckedAt: checkResult.checkedAt || new Date().toISOString(),
    });
  }

  getStatusData() {
    return {
      isRunning: this.isRunning,
      lastCheckTime: this.lastCheckTime,
      nextCheckTime: this.nextCheckTime,
      stats: this.stats,
      groups: Array.from(this.groupsStatus.values()),
      logs: this.logs.slice(0, 100),
      config: {
        releaseId: config.sendflow.releaseId,
        intervalMinutes: config.scheduler.intervalMinutes,
        accountsFrom: config.sendflow.accountsFrom,
        recheckDelaySeconds: config.sendflow.recheckDelaySeconds,
      },
      updateCooldown: sendflowClient.getUpdateCooldownStatus(),
    };
  }
}

export const verifierService = new VerifierService();
