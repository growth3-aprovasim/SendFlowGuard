import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { config, ROOT_DIR } from '../config.js';

const CAMPAIGNS_FILE = path.join(ROOT_DIR, 'campaigns.json');

export class CampaignManager {
  constructor() {
    this.campaigns = [];
    this.init();
  }

  init() {
    this.campaigns = this.loadCampaignsFromDisk();

    // Se não houver nenhuma campanha salva no arquivo, mas o .env tiver dados válidos,
    // criamos automaticamente a campanha padrão baseada no .env para não perder a configuração existente
    if (this.campaigns.length === 0) {
      if (config.sendflow.releaseId && config.sendflow.releaseId !== 'id_da_sua_campanha_aqui') {
        const defaultCamp = {
          id: 'camp_' + crypto.randomBytes(4).toString('hex'),
          name: 'Campanha Principal',
          releaseId: config.sendflow.releaseId.trim(),
          masterLinkUrl: (config.masterLink.url || '').trim(),
          accountsFrom: config.sendflow.accountsFrom || 'release',
          accounts: config.sendflow.accounts || [],
          checkIntervalMinutes: config.scheduler.intervalMinutes || 10,
          masterLinkIntervalSeconds: config.masterLink.intervalSeconds || 60,
          enabled: true,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        this.campaigns.push(defaultCamp);
        this.saveCampaignsToDisk();
      }
    }
  }

  loadCampaignsFromDisk() {
    try {
      if (fs.existsSync(CAMPAIGNS_FILE)) {
        const raw = fs.readFileSync(CAMPAIGNS_FILE, 'utf-8');
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          return parsed;
        }
      }
    } catch (err) {
      console.error('[CampaignManager] Erro ao carregar campaigns.json:', err.message);
    }
    return [];
  }

  saveCampaignsToDisk() {
    try {
      fs.writeFileSync(CAMPAIGNS_FILE, JSON.stringify(this.campaigns, null, 2), 'utf-8');
      return true;
    } catch (err) {
      console.error('[CampaignManager] Erro ao salvar campaigns.json:', err.message);
      return false;
    }
  }

  getAll() {
    return this.campaigns;
  }

  getActiveCampaigns() {
    return this.campaigns.filter(c => c.enabled !== false);
  }

  getById(id) {
    if (!id) return null;
    return this.campaigns.find(c => c.id === id || c.releaseId === id) || null;
  }

  create(data) {
    const {
      name,
      releaseId,
      masterLinkUrl,
      accountsFrom = 'release',
      accounts = [],
      checkIntervalMinutes = config.scheduler.intervalMinutes || 10,
      masterLinkIntervalSeconds = config.masterLink.intervalSeconds || 60,
      enabled = true,
    } = data;

    if (!name || !name.trim()) {
      throw new Error('O nome da campanha é obrigatório.');
    }

    if (!releaseId || !releaseId.trim()) {
      throw new Error('O Release ID da campanha no SendFlow é obrigatório.');
    }

    const cleanReleaseId = releaseId.trim();

    // Verifica se já existe uma campanha com este releaseId
    const exists = this.campaigns.find(c => c.releaseId.toLowerCase() === cleanReleaseId.toLowerCase());
    if (exists) {
      throw new Error(`Já existe uma campanha cadastrada com o Release ID "${cleanReleaseId}" (${exists.name}).`);
    }

    let parsedAccounts = accounts;
    if (typeof accounts === 'string') {
      parsedAccounts = accounts
        .split(',')
        .map(a => a.trim())
        .filter(Boolean);
    }

    const newCampaign = {
      id: 'camp_' + crypto.randomBytes(4).toString('hex'),
      name: name.trim(),
      releaseId: cleanReleaseId,
      masterLinkUrl: (masterLinkUrl || '').trim(),
      accountsFrom: accountsFrom === 'accounts' ? 'accounts' : 'release',
      accounts: Array.isArray(parsedAccounts) ? parsedAccounts : [],
      checkIntervalMinutes: Math.max(1, parseInt(checkIntervalMinutes || '10', 10)),
      masterLinkIntervalSeconds: Math.max(10, parseInt(masterLinkIntervalSeconds || '60', 10)),
      enabled: enabled !== false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    this.campaigns.push(newCampaign);
    this.saveCampaignsToDisk();
    return newCampaign;
  }

  update(id, updates) {
    const campaign = this.getById(id);
    if (!campaign) {
      throw new Error(`Campanha com ID "${id}" não encontrada.`);
    }

    if (updates.name !== undefined) {
      if (!updates.name.trim()) throw new Error('O nome da campanha não pode ser vazio.');
      campaign.name = updates.name.trim();
    }

    if (updates.releaseId !== undefined) {
      const cleanReleaseId = updates.releaseId.trim();
      if (!cleanReleaseId) throw new Error('O Release ID não pode ser vazio.');
      const duplicate = this.campaigns.find(
        c => c.id !== campaign.id && c.releaseId.toLowerCase() === cleanReleaseId.toLowerCase()
      );
      if (duplicate) {
        throw new Error(`Já existe outra campanha com o Release ID "${cleanReleaseId}" (${duplicate.name}).`);
      }
      campaign.releaseId = cleanReleaseId;
    }

    if (updates.masterLinkUrl !== undefined) {
      campaign.masterLinkUrl = (updates.masterLinkUrl || '').trim();
    }

    if (updates.accountsFrom !== undefined) {
      campaign.accountsFrom = updates.accountsFrom === 'accounts' ? 'accounts' : 'release';
    }

    if (updates.accounts !== undefined) {
      let parsedAccounts = updates.accounts;
      if (typeof parsedAccounts === 'string') {
        parsedAccounts = parsedAccounts
          .split(',')
          .map(a => a.trim())
          .filter(Boolean);
      }
      campaign.accounts = Array.isArray(parsedAccounts) ? parsedAccounts : [];
    }

    if (updates.checkIntervalMinutes !== undefined) {
      campaign.checkIntervalMinutes = Math.max(1, parseInt(updates.checkIntervalMinutes || '10', 10));
    }

    if (updates.masterLinkIntervalSeconds !== undefined) {
      campaign.masterLinkIntervalSeconds = Math.max(10, parseInt(updates.masterLinkIntervalSeconds || '60', 10));
    }

    if (updates.enabled !== undefined) {
      campaign.enabled = Boolean(updates.enabled);
    }

    campaign.updatedAt = new Date().toISOString();
    this.saveCampaignsToDisk();
    return campaign;
  }

  delete(id) {
    const index = this.campaigns.findIndex(c => c.id === id);
    if (index === -1) {
      throw new Error(`Campanha com ID "${id}" não encontrada.`);
    }
    const removed = this.campaigns.splice(index, 1)[0];
    this.saveCampaignsToDisk();
    return removed;
  }

  toggle(id) {
    const campaign = this.getById(id);
    if (!campaign) {
      throw new Error(`Campanha com ID "${id}" não encontrada.`);
    }
    campaign.enabled = !campaign.enabled;
    campaign.updatedAt = new Date().toISOString();
    this.saveCampaignsToDisk();
    return campaign;
  }
}

export const campaignManager = new CampaignManager();
