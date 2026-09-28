import { config } from '../config.js';
import { MasterLinkChecker } from './masterLinkChecker.js';
import { verifierService } from './verifier.js';
import { Notifier } from './notifier.js';
import { campaignManager } from './campaignManager.js';

export class MasterLinkMonitor {
  constructor() {
    this.timerId = null;
    this.isActive = false;
    this.isChecking = false;
    // Map campaignId -> status data
    this.campaignStatus = new Map();
  }

  start() {
    if (this.isActive) return;
    this.isActive = true;

    verifierService.addLog('info', `👑 Monitor de Links Mãe ATIVADO para todas as campanhas cadastradas.`);

    // Primeira checagem após 2s
    setTimeout(() => {
      if (this.isActive) this.checkAll();
    }, 2000);

    // Loop global de checagem a cada 60s (ou o menor intervalo configurado)
    const intervalSeconds = Math.max(10, config.masterLink.intervalSeconds || 60);
    this.timerId = setInterval(() => {
      this.checkAll();
    }, intervalSeconds * 1000);
  }

  stop() {
    if (this.timerId) {
      clearInterval(this.timerId);
      this.timerId = null;
    }
    this.isActive = false;
  }

  getCampaignState(campaignId) {
    if (!this.campaignStatus.has(campaignId)) {
      this.campaignStatus.set(campaignId, {
        campaignId,
        lastResult: null,
        nextCheckTime: null,
        history: [],
        consecutiveFailures: 0,
      });
    }
    return this.campaignStatus.get(campaignId);
  }

  /**
   * Checa os links mãe de todas as campanhas ativas
   */
  async checkAll() {
    if (this.isChecking) return;
    this.isChecking = true;

    try {
      const activeCampaigns = campaignManager.getActiveCampaigns().filter(c => Boolean((c.masterLinkUrl || '').trim()));

      if (activeCampaigns.length === 0) {
        return;
      }

      for (const campaign of activeCampaigns) {
        await this.checkCampaign(campaign);
        // Pequena pausa entre checagens de campanhas diferentes
        await new Promise(r => setTimeout(r, 600));
      }
    } catch (err) {
      verifierService.addLog('error', `Erro no ciclo de monitoramento de Links Mãe: ${err.message}`);
    } finally {
      this.isChecking = false;
    }
  }

  /**
   * Checa o Link Mãe de uma campanha específica
   * @param {object} campaign 
   */
  async checkCampaign(campaign) {
    if (!campaign || !campaign.masterLinkUrl) {
      return { isOnline: false, message: 'Nenhum Link Mãe configurado nesta campanha.' };
    }

    const state = this.getCampaignState(campaign.id);
    const intervalSec = campaign.masterLinkIntervalSeconds || config.masterLink.intervalSeconds || 60;
    state.nextCheckTime = new Date(Date.now() + intervalSec * 1000).toISOString();

    try {
      const result = await MasterLinkChecker.check(campaign.masterLinkUrl);
      result.campaignId = campaign.id;
      result.campaignName = campaign.name;

      state.lastResult = result;
      state.history.unshift(result);
      if (state.history.length > 30) state.history.pop();

      // Log e Alertas com identificação da campanha
      if (result.status === 'OPERATIONAL') {
        if (state.consecutiveFailures > 0) {
          verifierService.addLog('success', `🟢 [LINK MÃE RECUPERADO - ${campaign.name}] ${result.message}`);
          Notifier.notify({
            type: 'MASTER_LINK_RECOVERED',
            campaign,
            url: campaign.masterLinkUrl,
            finalUrl: result.finalUrl,
          }).catch(() => {});
        }
        state.consecutiveFailures = 0;
      } else if (result.status === 'DESTINATION_REVOKED') {
        state.consecutiveFailures++;
        verifierService.addLog('error', `🚨 [LINK MÃE COM PROBLEMA - ${campaign.name}] ${result.message}`);
        Notifier.notify({
          type: 'MASTER_LINK_DESTINATION_REVOKED',
          campaign,
          url: campaign.masterLinkUrl,
          finalUrl: result.finalUrl,
        }).catch(() => {});
      } else {
        // OFFLINE
        state.consecutiveFailures++;
        verifierService.addLog('error', `💥 [LINK MÃE FORA DO AR - ${campaign.name}] ${result.message}`);
        if (state.consecutiveFailures === 1 || state.consecutiveFailures % 5 === 0) {
          Notifier.notify({
            type: 'MASTER_LINK_DOWN',
            campaign,
            url: campaign.masterLinkUrl,
            error: result.message,
          }).catch(() => {});
        }
      }

      return result;
    } catch (err) {
      verifierService.addLog('error', `Erro ao checar Link Mãe de "${campaign.name}": ${err.message}`);
    }
  }

  /**
   * Força a checagem imediata para uma campanha ou a primeira disponível
   */
  async checkNow(campaignId = null) {
    if (campaignId) {
      const campaign = campaignManager.getById(campaignId);
      if (!campaign) throw new Error(`Campanha ${campaignId} não encontrada.`);
      return await this.checkCampaign(campaign);
    }

    await this.checkAll();
    // Retorna status consolidado
    return this.getStatus();
  }

  getStatus(campaignId = null) {
    if (campaignId) {
      const camp = campaignManager.getById(campaignId);
      const state = this.getCampaignState(campaignId);
      return {
        campaignId,
        campaignName: camp?.name || 'Campanha',
        isEnabled: Boolean(camp?.masterLinkUrl),
        url: camp?.masterLinkUrl || '',
        intervalSeconds: camp?.masterLinkIntervalSeconds || 60,
        nextCheckTime: state.nextCheckTime,
        lastResult: state.lastResult,
        history: state.history.slice(0, 10),
      };
    }

    // Retorna todos
    const allCampaigns = campaignManager.getAll();
    const resultByCampaign = {};
    for (const c of allCampaigns) {
      const st = this.getCampaignState(c.id);
      resultByCampaign[c.id] = {
        campaignId: c.id,
        campaignName: c.name,
        isEnabled: Boolean(c.masterLinkUrl),
        url: c.masterLinkUrl || '',
        intervalSeconds: c.masterLinkIntervalSeconds || 60,
        nextCheckTime: st.nextCheckTime,
        lastResult: st.lastResult,
        history: st.history.slice(0, 10),
      };
    }

    return {
      isActive: this.isActive,
      campaigns: resultByCampaign,
    };
  }
}

export const masterLinkMonitor = new MasterLinkMonitor();
