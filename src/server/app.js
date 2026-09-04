import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { config, validateConfig } from '../config.js';
import { verifierService } from '../services/verifier.js';
import { schedulerService } from '../services/scheduler.js';
import { masterLinkMonitor } from '../services/masterLinkMonitor.js';
import { WhatsAppChecker } from '../services/whatsappChecker.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function createServer() {
  const app = express();

  app.use(express.json());
  app.use(express.static(path.join(__dirname, 'public')));

  // Endpoint: Status geral do sistema, métricas, grupos, Link Mãe e logs
  app.get('/api/status', (req, res) => {
    const configCheck = validateConfig();
    const data = verifierService.getStatusData();
    res.json({
      success: true,
      data: {
        ...data,
        scheduler: schedulerService.getStatus(),
        masterLink: masterLinkMonitor.getStatus(),
        configCheck,
      },
    });
  });

  // Endpoint: Forçar verificação completa de todos os grupos agora
  app.post('/api/verify-now', async (req, res) => {
    if (verifierService.isRunning) {
      return res.status(409).json({
        success: false,
        message: 'Uma verificação já está em andamento no momento.',
      });
    }

    // Executa em segundo plano para responder rápido à UI
    const forceRefresh = Boolean(req.body.forceRefresh);
    schedulerService.triggerCheck({ forceRefreshGroups: forceRefresh }).catch(console.error);

    res.json({
      success: true,
      message: 'Verificação iniciada com sucesso.',
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
    try {
      const result = await verifierService.renewGroupManually(id);
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

  // Endpoint: Forçar checagem imediata do Link Mãe
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
