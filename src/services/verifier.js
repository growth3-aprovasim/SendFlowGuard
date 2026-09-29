import { config } from '../config.js';
import { sendflowClient } from './sendflow.js';
import { WhatsAppChecker } from './whatsappChecker.js';
import { Notifier } from './notifier.js';
import { campaignManager } from './campaignManager.js';

export class VerifierService {
  constructor() {
    this.isRunning = false;
    this.lastCheckTime = null;
    this.nextCheckTime = null;
    this.groupsStatus = new Map(); // id -> group details (including campaignId)
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
   * Executa a verificação completa para todas as campanhas ativas (ou apenas uma se especificado)
   * @param {object} options - { campaignId?: string, forceRefreshGroups?: boolean }
   */
  async runVerification(options = {}) {
    if (this.isRunning) {
      this.addLog('warn', 'Verificação já está em execução no momento. Ignorando solicitação duplicada.');
      return { success: false, message: 'Verificação em andamento.' };
    }

    this.isRunning = true;
    this.stats.totalChecks++;

    const targetCampaigns = options.campaignId
      ? [campaignManager.getById(options.campaignId)].filter(Boolean)
      : campaignManager.getActiveCampaigns();

    if (targetCampaigns.length === 0) {
      this.addLog('warn', 'Nenhuma campanha ativa encontrada para verificação.');
      this.isRunning = false;
      return { success: false, message: 'Nenhuma campanha ativa cadastrada.' };
    }

    this.addLog(
      'info',
      `=== Iniciando ciclo #${this.stats.totalChecks} de verificação (${targetCampaigns.length} campanha(s)) ===`
    );

    const summary = {
      cycleId: this.stats.totalChecks,
      startedAt: new Date().toISOString(),
      totalCampaigns: targetCampaigns.length,
      total: 0,
      valid: 0,
      revoked: 0,
      recovered: 0,
      errors: 0,
      campaigns: [],
    };

    try {
      for (const campaign of targetCampaigns) {
        this.addLog('info', `📌 Processando Campanha: "${campaign.name}" (Release: ${campaign.releaseId})...`);
        const campSummary = await this.verifySingleCampaign(campaign, options.forceRefreshGroups);
        
        summary.total += campSummary.total;
        summary.valid += campSummary.valid;
        summary.revoked += campSummary.revoked;
        summary.recovered += campSummary.recovered;
        summary.errors += campSummary.errors;
        summary.campaigns.push(campSummary);

        // Intervalo de segurança entre campanhas para aliviar o tráfego
        if (targetCampaigns.length > 1) {
          await new Promise(r => setTimeout(r, 1500));
        }
      }

      summary.finishedAt = new Date().toISOString();
      this.lastCheckTime = summary.finishedAt;
      this.stats.totalGroups = this.groupsStatus.size;
      this.stats.validCount = Array.from(this.groupsStatus.values()).filter(g => g.isValid).length;

      this.addLog(
        'info',
        `=== Ciclo #${this.stats.totalChecks} concluído: ${summary.total} grupos analisados em ${targetCampaigns.length} campanha(s) | ${summary.valid} válidos | ${summary.revoked} revogados | ${summary.recovered} recuperados ===`
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
   * Executa a verificação dos grupos de uma única campanha
   */
  async verifySingleCampaign(campaign, forceRefresh = false) {
    const campSummary = {
      campaignId: campaign.id,
      campaignName: campaign.name,
      releaseId: campaign.releaseId,
      total: 0,
      valid: 0,
      revoked: 0,
      recovered: 0,
      errors: 0,
    };

    try {
      // 1. Obter grupos no SendFlow
      const { groups, fromCache, message: groupsMsg } = await sendflowClient.getGroups(
        campaign.releaseId,
        forceRefresh
      );

      this.addLog(fromCache ? 'warn' : 'info', `[${campaign.name}] ${groupsMsg}`);
      campSummary.total = groups.length;

      if (groups.length === 0) {
        this.addLog('warn', `[${campaign.name}] Nenhum grupo retornado pelo SendFlow.`);
        return campSummary;
      }

      // 2. Verificar cada grupo
      for (let i = 0; i < groups.length; i++) {
        const group = groups[i];
        const groupIndexLabel = `[${campaign.name} | ${i + 1}/${groups.length}]`;
        const inviteCode = group.inviteCode;

        if (!inviteCode) {
          this.addLog('warn', `${groupIndexLabel} Grupo "${group.name}" (ID: ${group.id}) sem inviteCode configurado.`);
          campSummary.errors++;
          this.stats.errorCount++;
          this.updateGroupMemory(campaign, group, {
            isValid: false,
            status: 'NO_INVITE_CODE',
            message: 'Sem inviteCode no SendFlow',
          });
          continue;
        }

        const linkUrl = `https://chat.whatsapp.com/${inviteCode}`;
        this.addLog('info', `${groupIndexLabel} Verificando "${group.name}" (${linkUrl})...`);

        const checkResult = await WhatsAppChecker.checkInvite(inviteCode);

        if (checkResult.isValid && !checkResult.isTemporaryError) {
          // Link Ativo e Confirmado
          this.addLog(
            'success',
            `${groupIndexLabel} Link Ativo: "${group.name}" (${checkResult.title}) em ${checkResult.durationMs}ms`
          );
          campSummary.valid++;
          this.updateGroupMemory(campaign, group, checkResult);
        } else if (checkResult.isTemporaryError) {
          // Oscilação temporária de rede / rate limit / desafio - Não disparar alarme falso nem revogar
          this.addLog(
            'warn',
            `${groupIndexLabel} ⚠️ Oscilação transitória no WhatsApp para "${group.name}" (${checkResult.status}): ${checkResult.message}. Mantendo estado seguro.`
          );
          campSummary.errors++;
          this.stats.errorCount++;
          this.updateGroupMemory(campaign, group, {
            ...checkResult,
            isValid: true, // Preserva status seguro no dashboard
          });
        } else {
          // Link Quebrado / Revogado Confirmado
          this.addLog(
            'error',
            `${groupIndexLabel} 🚨 LINK QUEBRADO no grupo "${group.name}" (ID: ${group.id})! Status: ${checkResult.status} (${checkResult.message})`
          );
          campSummary.revoked++;
          this.stats.revokedCount++;

          this.updateGroupMemory(campaign, group, {
            ...checkResult,
            status: 'REVOKED',
          });

          // Notificação de alerta
          Notifier.notify({
            type: 'LINK_REVOKED',
            campaign,
            group,
            oldLink: linkUrl,
          }).catch(() => {});

          // Disparar ação de auto-recuperação com proteção de rate-limit
          await this.handleBrokenGroup(campaign, group, linkUrl, campSummary);
        }

        // Intervalo com jitter entre cada grupo para proteger IP de bloqueios no WhatsApp
        const delayBetweenGroups = 1200 + Math.floor(Math.random() * 800);
        await new Promise(r => setTimeout(r, delayBetweenGroups));
      }

      return campSummary;
    } catch (err) {
      this.addLog('error', `Erro ao verificar campanha "${campaign.name}": ${err.message}`);
      campSummary.error = err.message;
      return campSummary;
    }
  }

  /**
   * Processa a recuperação automática de um grupo com link quebrado
   */
  async handleBrokenGroup(campaign, group, oldUrl, summary) {
    try {
      // 🛡️ TRAVA RÍGIDA DE SEGURANÇA GLOBAL: Máximo de 4 atualizações a cada 15 minutos em toda a conta
      const safety = sendflowClient.getUpdateCooldownStatus();
      if (!safety.canUpdate) {
        this.addLog(
          'warn',
          `🛑 [TRAVA DE SEGURANÇA] Limite de 4 alterações nos últimos 15 min atingido! O grupo "${group.name}" (${campaign.name}) aguardará ${safety.cooldownText} para renovação segura.`
        );
        this.updateGroupMemory(campaign, group, {
          isValid: false,
          status: 'QUEUED_RATE_LIMIT',
          message: `Aguardando cooldown de 15 min da API (${safety.cooldownText})`,
        });

        Notifier.notify({
          type: 'RATE_LIMIT_SAFETY',
          campaign,
          group,
          cooldownText: safety.cooldownText,
        }).catch(() => {});
        return;
      }

      this.addLog(
        'warn',
        `[Auto-Recuperação] Solicitando novo link para "${group.name}" (${campaign.name}) no SendFlow (${safety.count + 1}/4 na janela)...`
      );

      const updateResult = await sendflowClient.updateGroupInviteCode(group.id, campaign.releaseId, {
        accountsFrom: campaign.accountsFrom,
        accounts: campaign.accounts,
      });

      this.addLog('success', `[Auto-Recuperação] ${updateResult.message} (Action ID: ${updateResult.actionId || 'ok'})`);

      const delaySec = config.sendflow.recheckDelaySeconds || 60;
      this.addLog('info', `[Auto-Recuperação] Aguardando ${delaySec}s para reteste do link gerado...`);

      // Espera o tempo de propagação do SendFlow
      await new Promise(r => setTimeout(r, delaySec * 1000));

      // Tenta buscar os grupos atualizados no SendFlow
      this.addLog('info', `[Auto-Recuperação] Consultando novo inviteCode no SendFlow para "${group.name}"...`);

      let updatedGroup = null;
      try {
        const fetchRes = await sendflowClient.getGroups(campaign.releaseId, true);
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
          this.addLog('success', `🎉 SUCESSO! Novo link do grupo "${group.name}" (${campaign.name}) está ATIVO e funcionando!`);
          summary.recovered++;
          this.stats.recoveredCount++;

          this.updateGroupMemory(campaign, updatedGroup, {
            ...recheckResult,
            status: 'RECOVERED',
          });

          Notifier.notify({
            type: 'LINK_RECOVERED',
            campaign,
            group: updatedGroup,
            newLink: newUrl,
          }).catch(() => {});
        } else {
          this.addLog('error', `[Auto-Recuperação] O novo link gerado ainda não está respondendo como válido.`);
          this.updateGroupMemory(campaign, updatedGroup, recheckResult);
        }
      } else {
        this.addLog(
          'warn',
          `[Auto-Recuperação] O SendFlow ainda não atualizou o inviteCode do grupo "${group.name}". A ação foi enviada e será checada no próximo ciclo.`
        );
      }
    } catch (err) {
      this.addLog('error', `[Auto-Recuperação] Falha ao recuperar grupo "${group.name}": ${err.message}`);
      Notifier.notify({
        type: 'RECOVERY_FAILED',
        campaign,
        group,
        error: err.message,
      }).catch(() => {});
    }
  }

  /**
   * Força a renovação manual de um grupo específico de uma campanha
   */
  async renewGroupManually(groupId, releaseId = null) {
    let targetReleaseId = releaseId;
    let targetCampaign = null;

    if (releaseId) {
      targetCampaign = campaignManager.getById(releaseId);
    } else {
      // Procura em qual campanha o grupo está
      const existing = this.groupsStatus.get(String(groupId));
      if (existing && existing.campaignId) {
        targetCampaign = campaignManager.getById(existing.campaignId);
        targetReleaseId = targetCampaign?.releaseId;
      }
    }

    if (!targetReleaseId) {
      targetReleaseId = config.sendflow.releaseId;
    }

    this.addLog('info', `[Manual] Renovação de link solicitada manualmente para o grupo ID: ${groupId} (Release: ${targetReleaseId})`);
    const res = await sendflowClient.updateGroupInviteCode(groupId, targetReleaseId, {
      accountsFrom: targetCampaign?.accountsFrom,
      accounts: targetCampaign?.accounts,
    });
    this.addLog('success', `[Manual] Ação enviada com sucesso: ${res.message}`);
    return res;
  }

  updateGroupMemory(campaign, group, checkResult) {
    const key = String(group.id);
    const existing = this.groupsStatus.get(key) || {};
    this.groupsStatus.set(key, {
      ...existing,
      ...group,
      campaignId: campaign.id,
      campaignName: campaign.name,
      campaignReleaseId: campaign.releaseId,
      lastCheckResult: checkResult,
      status: checkResult.status || (checkResult.isValid ? 'VALID' : 'REVOKED'),
      isValid: checkResult.isValid,
      lastCheckedAt: checkResult.checkedAt || new Date().toISOString(),
    });
  }

  getStatusData(filterCampaignId = null) {
    let groups = Array.from(this.groupsStatus.values());
    if (filterCampaignId) {
      groups = groups.filter(g => g.campaignId === filterCampaignId || g.campaignReleaseId === filterCampaignId);
    }

    const campaigns = campaignManager.getAll();

    return {
      isRunning: this.isRunning,
      lastCheckTime: this.lastCheckTime,
      nextCheckTime: this.nextCheckTime,
      stats: {
        ...this.stats,
        totalGroups: groups.length,
        validCount: groups.filter(g => g.isValid).length,
        revokedCount: groups.filter(g => g.status === 'REVOKED').length,
        recoveredCount: this.stats.recoveredCount,
      },
      campaigns,
      groups,
      logs: this.logs.slice(0, 100),
      updateCooldown: sendflowClient.getUpdateCooldownStatus(),
    };
  }
}

export const verifierService = new VerifierService();
