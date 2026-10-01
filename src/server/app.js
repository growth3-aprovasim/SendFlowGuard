import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { config, validateConfig } from '../config.js';
import { verifierService } from '../services/verifier.js';
import { schedulerService } from '../services/scheduler.js';
import { masterLinkMonitor } from '../services/masterLinkMonitor.js';
import { WhatsAppChecker } from '../services/whatsappChecker.js';
import { campaignManager } from '../services/campaignManager.js';
import { sendflowClient } from '../services/sendflow.js';
import { whatsappSocketService } from '../services/whatsappSocket.js';
import { antiHackerService } from '../services/antiHacker.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function createServer() {
  const app = express();

  // Inicia conexão automática com WhatsApp se houver credenciais salvas
  whatsappSocketService.autoStartIfAuthExists();

  // Inicia autoBoot do Motor Aegis Anti-Hacker
  antiHackerService.autoBoot();

  app.use(express.json());
  app.use(express.static(path.join(__dirname, 'public')));

  // Endpoint: Status geral do sistema, campanhas, grupos, Links Mãe e logs
  app.get('/api/status', (req, res) => {
    const campaignId = req.query.campaignId || null;
    const configCheck = validateConfig();
    const data = verifierService.getStatusData(campaignId);
    res.json({
      success: true,
      data: {
        ...data,
        whatsapp: whatsappSocketService.getStatus(),
        scheduler: schedulerService.getStatus(),
        masterLink: masterLinkMonitor.getStatus(campaignId),
        configCheck,
        cooldown: sendflowClient.getUpdateCooldownStatus(),
      },
    });
  });

  // ==========================================
  // ROTAS DO ANTI-HACKER BRABO (AEGIS 8.2) - MULTI-CAMPANHAS
  // ==========================================
  app.get('/api/antihacker/status', (req, res) => {
    const campaignId = req.query.campaignId || 'all';
    res.json({ success: true, data: antiHackerService.getStatus(campaignId) });
  });

  // Listar todas as campanhas de segurança
  app.get('/api/antihacker/campaigns', (req, res) => {
    res.json({ success: true, campaigns: antiHackerService.getAllCampaigns() });
  });

  // Criar nova campanha de segurança
  app.post('/api/antihacker/campaigns', (req, res) => {
    try {
      const newCamp = antiHackerService.createCampaign(req.body);
      res.status(201).json({ success: true, campaign: newCamp });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  // Obter dados de uma campanha específica
  app.get('/api/antihacker/campaigns/:id', (req, res) => {
    const camp = antiHackerService.getCampaignById(req.params.id);
    if (!camp) return res.status(404).json({ success: false, error: 'Campanha não encontrada.' });
    res.json({ success: true, campaign: camp });
  });

  // Atualizar campanha de segurança
  app.put('/api/antihacker/campaigns/:id', (req, res) => {
    try {
      const updated = antiHackerService.updateCampaign(req.params.id, req.body);
      res.json({ success: true, campaign: updated });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  // Excluir campanha de segurança
  app.delete('/api/antihacker/campaigns/:id', async (req, res) => {
    try {
      const removed = await antiHackerService.deleteCampaign(req.params.id);
      res.json({ success: true, campaign: removed });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  // Alternar ativação de uma campanha de segurança
  app.post('/api/antihacker/campaigns/:id/toggle', (req, res) => {
    try {
      const updated = antiHackerService.toggleCampaign(req.params.id);
      res.json({ success: true, campaign: updated });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  // Gerar Pairing Code para agente de uma campanha específica
  app.post('/api/antihacker/campaigns/:campaignId/agents/:type/:index/pairing-code', async (req, res) => {
    const { campaignId, type, index } = req.params;
    const { phoneNumber } = req.body;
    try {
      const result = await antiHackerService.conectarAgente({
        campaignId,
        type,
        index: parseInt(index, 10),
        phoneNumber,
        forceFresh: true,
      });
      res.json({ success: true, ...result });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  // Desconectar agente de uma campanha específica
  app.post('/api/antihacker/campaigns/:campaignId/agents/:type/:index/disconnect', async (req, res) => {
    const { campaignId, type, index } = req.params;
    try {
      const result = await antiHackerService.desconectarAgente(campaignId, type, parseInt(index, 10));
      res.json({ success: true, ...result });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // Rotas legadas (compatibilidade)
  app.post('/api/antihacker/agents/:type/:index/pairing-code', async (req, res) => {
    const { type, index } = req.params;
    const { phoneNumber } = req.body;
    try {
      const result = await antiHackerService.conectarAgente({
        campaignId: 'default',
        type,
        index: parseInt(index, 10),
        phoneNumber,
        forceFresh: true,
      });
      res.json({ success: true, ...result });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  app.post('/api/antihacker/agents/:type/:index/disconnect', async (req, res) => {
    const { type, index } = req.params;
    try {
      const result = await antiHackerService.desconectarAgente('default', type, parseInt(index, 10));
      res.json({ success: true, ...result });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.get('/api/antihacker/blacklist', (req, res) => {
    res.json({ success: true, blacklist: antiHackerService.cacheBlacklist });
  });

  app.post('/api/antihacker/blacklist', (req, res) => {
    const { number } = req.body;
    if (!number) return res.status(400).json({ success: false, error: 'Número obrigatório.' });
    antiHackerService.adicionarNaBlacklist(number);
    res.json({ success: true, blacklist: antiHackerService.cacheBlacklist });
  });

  app.delete('/api/antihacker/blacklist/:number', (req, res) => {
    const { number } = req.params;
    antiHackerService.removerDaBlacklist(number);
    res.json({ success: true, blacklist: antiHackerService.cacheBlacklist });
  });

  app.get('/api/antihacker/stats', (req, res) => {
    res.json({ success: true, stats: antiHackerService.cacheEstatisticas });
  });

  // ==========================================
  // ROTAS DE CONEXÃO WHATSAPP (PAIRING CODE)
  // ==========================================
  app.get('/api/whatsapp/status', (req, res) => {
    res.json({ success: true, ...whatsappSocketService.getStatus() });
  });

  app.post('/api/whatsapp/pairing-code', async (req, res) => {
    try {
      const { phoneNumber } = req.body;
      const result = await whatsappSocketService.requestPairingCode(phoneNumber);
      verifierService.addLog('info', `[WhatsApp Protocol] Solicitado Pairing Code para +${phoneNumber}`);
      res.json({ success: true, ...result });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  app.post('/api/whatsapp/disconnect', async (req, res) => {
    try {
      const result = await whatsappSocketService.disconnect();
      verifierService.addLog('warn', '[WhatsApp Protocol] WhatsApp desconectado manualmente.');
      res.json({ success: true, ...result });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ==========================================
  // ROTAS DE GERENCIAMENTO DE CAMPANHAS
  // ==========================================

  // Listar todas as campanhas
  app.get('/api/campaigns', (req, res) => {
    const campaigns = campaignManager.getAll();
    res.json({ success: true, campaigns });
  });

  // Cadastrar nova campanha
  app.post('/api/campaigns', (req, res) => {
    try {
      const newCamp = campaignManager.create(req.body);
      verifierService.addLog('success', `Nova campanha adicionada: "${newCamp.name}" (Release: ${newCamp.releaseId})`);

      // Se tiver Link Mãe configurado, dispara uma checagem rápida para ele
      if (newCamp.masterLinkUrl) {
        masterLinkMonitor.checkCampaign(newCamp).catch(() => {});
      }

      res.status(201).json({ success: true, campaign: newCamp });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  // Obter detalhes de uma campanha
  app.get('/api/campaigns/:id', (req, res) => {
    const camp = campaignManager.getById(req.params.id);
    if (!camp) {
      return res.status(404).json({ success: false, error: 'Campanha não encontrada.' });
    }
    const masterLinkStatus = masterLinkMonitor.getStatus(camp.id);
    res.json({ success: true, campaign: camp, masterLink: masterLinkStatus });
  });

  // Atualizar campanha
  app.put('/api/campaigns/:id', (req, res) => {
    try {
      const updated = campaignManager.update(req.params.id, req.body);
      verifierService.addLog('info', `Campanha atualizada: "${updated.name}"`);

      if (updated.masterLinkUrl) {
        masterLinkMonitor.checkCampaign(updated).catch(() => {});
      }

      res.json({ success: true, campaign: updated });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  // Excluir campanha
  app.delete('/api/campaigns/:id', (req, res) => {
    try {
      const removed = campaignManager.delete(req.params.id);
      verifierService.addLog('warn', `Campanha removida: "${removed.name}" (Release: ${removed.releaseId})`);
      res.json({ success: true, campaign: removed });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  // Alternar ativação de uma campanha
  app.post('/api/campaigns/:id/toggle', (req, res) => {
    try {
      const updated = campaignManager.toggle(req.params.id);
      verifierService.addLog(
        'info',
        `Campanha "${updated.name}" agora está ${updated.enabled ? 'ATIVADA' : 'PAUSADA'}.`
      );
      res.json({ success: true, campaign: updated });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  // Forçar verificação de grupos de uma campanha específica
  app.post('/api/campaigns/:id/verify-now', async (req, res) => {
    if (verifierService.isRunning) {
      return res.status(409).json({
        success: false,
        message: 'Uma verificação já está em andamento no momento.',
      });
    }

    const forceRefresh = Boolean(req.body.forceRefresh);
    verifierService.runVerification({ campaignId: req.params.id, forceRefreshGroups: forceRefresh }).catch(console.error);

    res.json({
      success: true,
      message: 'Verificação da campanha iniciada.',
    });
  });

  // Forçar checagem do Link Mãe de uma campanha específica
  app.post('/api/campaigns/:id/master-link/check-now', async (req, res) => {
    try {
      const result = await masterLinkMonitor.checkNow(req.params.id);
      res.json({ success: true, result });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ==========================================
  // ROTAS GLOBAIS DE OPERAÇÃO
  // ==========================================

  // Endpoint: Forçar verificação completa de todas as campanhas ativas
  app.post('/api/verify-now', async (req, res) => {
    if (verifierService.isRunning) {
      return res.status(409).json({
        success: false,
        message: 'Uma verificação já está em andamento no momento.',
      });
    }

    const forceRefresh = Boolean(req.body.forceRefresh);
    schedulerService.triggerCheck({ forceRefreshGroups: forceRefresh }).catch(console.error);

    res.json({
      success: true,
      message: 'Verificação global iniciada com sucesso.',
    });
  });

  // Endpoint: Ativar / Pausar o agendador automático
  app.post('/api/scheduler/toggle', (req, res) => {
    if (schedulerService.isActive) {
      schedulerService.stop();
      res.json({ success: true, active: false, message: 'Agendador pausado.' });
    } else {
      schedulerService.start(false);
      res.json({ success: true, active: true, message: 'Agendador ativado.' });
    }
  });

  // Endpoint: Forçar renovação de link de um grupo específico no SendFlow
  app.post('/api/groups/:id/renew', async (req, res) => {
    const { id } = req.params;
    const { releaseId } = req.body || {};
    try {
      const result = await verifierService.renewGroupManually(id, releaseId);
      res.json({ success: true, ...result });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // Endpoint: Testar qualquer link de convite arbitrário
  app.post('/api/check-link', async (req, res) => {
    const { link } = req.body;
    if (!link) {
      return res.status(400).json({ success: false, error: 'Link ou código de convite obrigatório.' });
    }
    try {
      const result = await WhatsAppChecker.checkInvite(link);
      res.json({ success: true, result });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // Endpoint: Forçar checagem de todos os Links Mãe
  app.post('/api/master-link/check-now', async (req, res) => {
    try {
      const result = await masterLinkMonitor.checkNow();
      res.json({ success: true, result });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // Fallback para o index.html
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  });

  return app;
}
