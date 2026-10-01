import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  isJidGroup,
  fetchLatestBaileysVersion,
  Browsers,
  jidNormalizedUser,
} from '@whiskeysockets/baileys';
import { EventEmitter } from 'events';
import pino from 'pino';
import path from 'path';
import fs from 'fs';
import QRCode from 'qrcode';
import crypto from 'crypto';
import { DATA_DIR, ROOT_DIR } from '../config.js';

// ⏱️ RELÓGIO MESTRE ABSOLUTO (com margem de segurança de 15s para desvios de NTP)
const TEMPO_BOOT = Math.floor(Date.now() / 1000) - 15;

export class AntiHackerService {
  constructor() {
    this.campaignsFile = path.join(DATA_DIR, 'antihacker_campaigns.json');
    this.configFile = path.join(DATA_DIR, 'antihacker_config.json');
    this.blacklistFile = path.join(DATA_DIR, 'blacklist_aegis.json');
    this.statsFile = path.join(DATA_DIR, 'estatisticas_aegis.json');

    this.barramentoTatico = new EventEmitter();
    this.barramentoTatico.setMaxListeners(500);

    this.mensagensProcessadas = new Set();
    this.travasDeRedundancia = new Set();
    this.cacheGrupos = new Map(); // chatId -> { dados, tempo }
    this.pendingMetadata = new Map();
    this.mapaLidParaTelefone = new Map(); // lid -> telefone real

    // Mapeamento de Sockets ativos: key (`${campaignId}_${type}_${index}`) -> socket
    this.sockets = new Map();

    // Mapeamento de Estados dos Agentes: key (`${campaignId}_${type}_${index}`) -> state info
    this.agentsState = new Map();

    this.logs = [];
    this.campaigns = [];

    this.config = {
      enabled: true,
      globalWhitelist: [],
    };

    this.cacheBlacklist = [];
    this.cacheEstatisticas = {
      total_mensagens_apagadas: 0,
      total_banimentos: 0,
      hackers_bloqueados: [],
      grupos_protegidos: [],
    };

    this.logger = pino({ level: 'silent' });
  }

  addLog(level, message, campaignName = null) {
    const time = new Date().toLocaleTimeString('pt-BR');
    const prefix = campaignName ? `[${campaignName}] ` : '';
    const entry = {
      id: Date.now() + Math.random().toString(36).substring(2, 6),
      time,
      timestamp: new Date().toISOString(),
      level, // 'info' | 'success' | 'warn' | 'error'
      message: `${prefix}${message}`,
    };
    this.logs.unshift(entry);
    if (this.logs.length > 500) this.logs.pop();
    console.log(`[${time}] [AEGIS 8.2] ${entry.message}`);
  }

  // =================================================================
  // 📂 PERSISTÊNCIA DE CAMPANHAS E BANCO DE DADOS
  // =================================================================
  loadConfigAndCampaigns() {
    try {
      if (fs.existsSync(this.configFile)) {
        const data = JSON.parse(fs.readFileSync(this.configFile, 'utf-8'));
        this.config = { ...this.config, ...data };
      }
    } catch (err) {
      console.error('[AntiHacker] Erro ao carregar config:', err.message);
    }

    try {
      if (!fs.existsSync(this.blacklistFile)) {
        fs.writeFileSync(this.blacklistFile, JSON.stringify([]));
      }
      this.cacheBlacklist = JSON.parse(fs.readFileSync(this.blacklistFile, 'utf-8'));
      if (!Array.isArray(this.cacheBlacklist)) this.cacheBlacklist = [];
    } catch {
      this.cacheBlacklist = [];
    }

    try {
      if (!fs.existsSync(this.statsFile)) {
        fs.writeFileSync(this.statsFile, JSON.stringify(this.cacheEstatisticas, null, 2));
      }
      this.cacheEstatisticas = JSON.parse(fs.readFileSync(this.statsFile, 'utf-8'));
    } catch {
      this.cacheEstatisticas = {
        total_mensagens_apagadas: 0,
        total_banimentos: 0,
        hackers_bloqueados: [],
        grupos_protegidos: [],
      };
    }

    // Carregar campanhas
    try {
      if (fs.existsSync(this.campaignsFile)) {
        const raw = fs.readFileSync(this.campaignsFile, 'utf-8');
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) {
          this.campaigns = parsed;
        }
      }
    } catch (err) {
      console.error('[AntiHacker] Erro ao carregar campanhas:', err.message);
    }

    // Se nenhuma campanha existir, cria a Campanha Padrão
    if (this.campaigns.length === 0) {
      const defaultCamp = {
        id: 'default',
        name: 'Campanha Principal',
        enabled: true,
        whitelist: this.config.whitelist || [],
        grupoAlertas: this.config.grupoAlertas || '120363413670200654@g.us',
        qtdSnipers: 4,
        qtdEspioes: 9,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      this.campaigns.push(defaultCamp);
      this.saveCampaigns();
    }
  }

  saveCampaigns() {
    try {
      fs.writeFileSync(this.campaignsFile, JSON.stringify(this.campaigns, null, 2), 'utf-8');
      return true;
    } catch (err) {
      console.error('[AntiHacker] Erro ao salvar campanhas:', err.message);
      return false;
    }
  }

  saveConfig() {
    try {
      fs.writeFileSync(this.configFile, JSON.stringify(this.config, null, 2), 'utf-8');
    } catch (err) {
      console.error('[AntiHacker] Erro ao salvar config:', err.message);
    }
  }

  // =================================================================
  // 🏢 GERENCIAMENTO DE CAMPANHAS DO ANTI-HACKER
  // =================================================================
  getAllCampaigns() {
    return this.campaigns;
  }

  getCampaignById(id) {
    if (!id) return null;
    return this.campaigns.find(c => c.id === id) || null;
  }

  createCampaign(data) {
    const {
      name,
      grupoAlertas = '',
      qtdSnipers = 2,
      qtdEspioes = 4,
      whitelist = [],
      enabled = true,
    } = data;

    if (!name || !name.trim()) {
      throw new Error('O nome da campanha de segurança é obrigatório.');
    }

    const id = 'ah_' + crypto.randomBytes(4).toString('hex');
    const newCamp = {
      id,
      name: name.trim(),
      grupoAlertas: (grupoAlertas || '').trim(),
      qtdSnipers: Math.max(1, Math.min(10, parseInt(qtdSnipers, 10) || 2)),
      qtdEspioes: Math.max(1, Math.min(20, parseInt(qtdEspioes, 10) || 4)),
      whitelist: Array.isArray(whitelist) ? whitelist.map(n => String(n).replace(/\D/g, '')).filter(Boolean) : [],
      enabled: enabled !== false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    this.campaigns.push(newCamp);
    this.saveCampaigns();
    this.addLog('success', `Nova campanha de segurança criada: "${newCamp.name}"`);
    return newCamp;
  }

  updateCampaign(id, data) {
    const camp = this.getCampaignById(id);
    if (!camp) {
      throw new Error('Campanha não encontrada.');
    }

    if (data.name && data.name.trim()) camp.name = data.name.trim();
    if (typeof data.grupoAlertas === 'string') camp.grupoAlertas = data.grupoAlertas.trim();
    if (typeof data.qtdSnipers === 'number') camp.qtdSnipers = Math.max(1, Math.min(10, data.qtdSnipers));
    if (typeof data.qtdEspioes === 'number') camp.qtdEspioes = Math.max(1, Math.min(20, data.qtdEspioes));
    if (Array.isArray(data.whitelist)) {
      camp.whitelist = data.whitelist.map(n => String(n).replace(/\D/g, '')).filter(Boolean);
    }
    if (typeof data.enabled === 'boolean') camp.enabled = data.enabled;

    camp.updatedAt = new Date().toISOString();
    this.saveCampaigns();
    this.addLog('info', `Campanha "${camp.name}" atualizada.`);
    return camp;
  }

  async deleteCampaign(id) {
    const idx = this.campaigns.findIndex(c => c.id === id);
    if (idx === -1) {
      throw new Error('Campanha não encontrada.');
    }

    const removed = this.campaigns.splice(idx, 1)[0];

    // Desconecta e limpa sockets dos agentes desta campanha
    for (let i = 1; i <= (removed.qtdSnipers || 10); i++) {
      await this.desconectarAgente(id, 'SNIPER', i).catch(() => {});
    }
    for (let i = 1; i <= (removed.qtdEspioes || 20); i++) {
      await this.desconectarAgente(id, 'ESPIAO', i).catch(() => {});
    }

    this.saveCampaigns();
    this.addLog('warn', `Campanha "${removed.name}" excluída.`);
    return removed;
  }

  toggleCampaign(id) {
    const camp = this.getCampaignById(id);
    if (!camp) throw new Error('Campanha não encontrada.');

    camp.enabled = !camp.enabled;
    camp.updatedAt = new Date().toISOString();
    this.saveCampaigns();

    this.addLog('info', `Campanha "${camp.name}" ${camp.enabled ? 'ATIVADA' : 'PAUSADA'}.`);
    return camp;
  }

  // =================================================================
  // 🛡️ BLACKLIST E ESTATÍSTICAS
  // =================================================================
  adicionarNaBlacklist(numero) {
    const limpo = String(numero).replace(/\D/g, '');
    if (!limpo || limpo.length < 8) return;

    if (!this.estaNaBlacklist(limpo)) {
      this.cacheBlacklist.push({
        number: limpo,
        addedAt: new Date().toISOString(),
        reason: 'Invasão de grupo / Ataque detectado',
      });
      fs.promises.writeFile(this.blacklistFile, JSON.stringify(this.cacheBlacklist, null, 2)).catch(() => {});
      this.addLog('warn', `🔒 Invasor +${limpo} indexado na Blacklist permanente.`);
    }
  }

  removerDaBlacklist(numero) {
    const limpo = String(numero).replace(/\D/g, '');
    this.cacheBlacklist = this.cacheBlacklist.filter(item => {
      const num = typeof item === 'string' ? item : item.number;
      return num !== limpo;
    });
    fs.promises.writeFile(this.blacklistFile, JSON.stringify(this.cacheBlacklist, null, 2)).catch(() => {});
    this.addLog('info', `🔓 Número +${limpo} removido da Blacklist.`);
  }

  estaNaBlacklist(jidOuNumero) {
    if (!jidOuNumero) return false;
    const numLimpo = this.extrairNumeroLimpo(jidOuNumero);
    const idLimpo = this.normalizarID(jidOuNumero);

    return this.cacheBlacklist.some(item => {
      const bNum = typeof item === 'string' ? item : item.number;
      if (bNum === numLimpo) return true;
      const bId = this.normalizarID(bNum);
      return Boolean(bId && idLimpo && bId === idLimpo);
    });
  }

  registrarEstatistica(acao, numeroInvasor = null, nomeGrupo = null) {
    if (acao === 'MENSAGEM') this.cacheEstatisticas.total_mensagens_apagadas += 1;
    if (acao === 'BANIMENTO' && numeroInvasor && nomeGrupo) {
      this.cacheEstatisticas.total_banimentos += 1;
      if (!this.cacheEstatisticas.hackers_bloqueados.includes(numeroInvasor)) {
        this.cacheEstatisticas.hackers_bloqueados.push(numeroInvasor);
      }
      if (!this.cacheEstatisticas.grupos_protegidos.includes(nomeGrupo)) {
        this.cacheEstatisticas.grupos_protegidos.push(nomeGrupo);
      }
    }
    fs.promises.writeFile(this.statsFile, JSON.stringify(this.cacheEstatisticas, null, 2)).catch(() => {});
  }

  // =================================================================
  // 🔍 IDENTIDADE E WHITELIST
  // =================================================================
  normalizarJid(jid) {
    if (!jid) return '';
    try {
      return jidNormalizedUser(String(jid));
    } catch {
      return String(jid).split(':')[0].split('@')[0] + '@s.whatsapp.net';
    }
  }

  extrairNumeroLimpo(jid) {
    if (!jid) return '';
    return String(jid).split('@')[0].split(':')[0].replace(/\D/g, '');
  }

  normalizarID(jid) {
    if (!jid) return '';
    let num = this.extrairNumeroLimpo(jid);
    if (num.startsWith('55') && (num.length === 12 || num.length === 13)) {
      num = num.substring(2);
    }
    if (num.length === 11 && num[2] === '9') {
      num = num.substring(0, 2) + num.substring(3);
    }
    return num;
  }

  compararIdentidades(jidA, jidB) {
    if (!jidA || !jidB) return false;
    const normA = this.normalizarJid(jidA);
    const normB = this.normalizarJid(jidB);
    if (normA === normB) return true;

    const numLimpoA = this.extrairNumeroLimpo(jidA);
    const numLimpoB = this.extrairNumeroLimpo(jidB);
    if (numLimpoA && numLimpoB && numLimpoA === numLimpoB) return true;

    const idA = this.normalizarID(jidA);
    const idB = this.normalizarID(jidB);
    return Boolean(idA && idB && idA === idB);
  }

  registrarMapeamentoLid(lid, jidOuTelefone) {
    if (!lid || !jidOuTelefone) return;
    const lidLimpo = this.extrairNumeroLimpo(lid);
    const telLimpo = this.extrairNumeroLimpo(jidOuTelefone);
    if (lidLimpo && telLimpo && lidLimpo !== telLimpo && telLimpo.length >= 10 && telLimpo.length <= 14) {
      this.mapaLidParaTelefone.set(lidLimpo, telLimpo);
      this.mapaLidParaTelefone.set(this.normalizarJid(lid), `${telLimpo}@s.whatsapp.net`);
    }
  }

  resolverIdentidadeInvasor(senderId, metadata, rawKey = null) {
    let jidTelefone = '';
    let numeroReal = '';

    if (rawKey) {
      const candidatos = [rawKey.participantPn, rawKey.senderPn, rawKey.participant_pn, rawKey.sender_pn];
      for (const cand of candidatos) {
        if (cand) {
          const limpo = this.extrairNumeroLimpo(cand);
          if (limpo && limpo.length >= 10 && limpo.length <= 14 && limpo !== this.extrairNumeroLimpo(senderId)) {
            numeroReal = limpo;
            jidTelefone = `${limpo}@s.whatsapp.net`;
            this.registrarMapeamentoLid(senderId, jidTelefone);
            break;
          }
        }
      }
    }

    if (!numeroReal && metadata && Array.isArray(metadata.participants)) {
      const p = metadata.participants.find(part => {
        if (part.lid && this.compararIdentidades(part.lid, senderId)) return true;
        if (part.id && this.compararIdentidades(part.id, senderId)) return true;
        return false;
      });

      if (p) {
        const candidatos = [p.jid, p.id, p.phoneNumber, p.phone_number];
        for (const cand of candidatos) {
          if (!cand) continue;
          const limpo = this.extrairNumeroLimpo(cand);
          if (limpo && limpo.length >= 10 && limpo.length <= 14 && limpo !== this.extrairNumeroLimpo(senderId)) {
            numeroReal = limpo;
            jidTelefone = `${limpo}@s.whatsapp.net`;
            this.registrarMapeamentoLid(senderId, jidTelefone);
            break;
          }
        }
      }
    }

    if (!numeroReal) {
      const lidLimpo = this.extrairNumeroLimpo(senderId);
      if (this.mapaLidParaTelefone.has(lidLimpo)) {
        numeroReal = this.mapaLidParaTelefone.get(lidLimpo);
        jidTelefone = `${numeroReal}@s.whatsapp.net`;
      }
    }

    if (!numeroReal) {
      numeroReal = this.extrairNumeroLimpo(senderId) || senderId;
      jidTelefone = senderId;
    }

    return { jidOriginal: senderId, jidTelefone, numeroReal };
  }

  estaNaWhitelist(senderId, identidade = null, campaignId = null) {
    if (!senderId) return false;

    // 1. Verifica se é um dos nossos próprios bots conectados
    for (const [key, sock] of this.sockets.entries()) {
      if (sock && sock.user && this.compararIdentidades(sock.user.id, senderId)) {
        return true;
      }
    }

    // 2. Coleta listas de Whitelist (Campanha + Global)
    const whitelists = [];
    if (Array.isArray(this.config.globalWhitelist)) whitelists.push(...this.config.globalWhitelist);

    if (campaignId) {
      const camp = this.getCampaignById(campaignId);
      if (camp && Array.isArray(camp.whitelist)) whitelists.push(...camp.whitelist);
    } else {
      // Se não especificou campanha, combina as whitelists de todas as campanhas
      for (const camp of this.campaigns) {
        if (Array.isArray(camp.whitelist)) whitelists.push(...camp.whitelist);
      }
    }

    const numOriginal = this.extrairNumeroLimpo(senderId);
    const idOriginal = this.normalizarID(senderId);
    const numIdentidade = identidade?.numeroReal ? this.extrairNumeroLimpo(identidade.numeroReal) : null;
    const idIdentidade = identidade?.numeroReal ? this.normalizarID(identidade.numeroReal) : null;

    for (const adminNum of whitelists) {
      const adminLimpo = String(adminNum).replace(/\D/g, '');
      const adminId = this.normalizarID(adminLimpo);

      if (adminLimpo === numOriginal) return true;
      if (adminId && idOriginal && adminId === idOriginal) return true;

      if (numIdentidade && adminLimpo === numIdentidade) return true;
      if (adminId && idIdentidade && adminId === idIdentidade) return true;
    }

    return false;
  }

  // =================================================================
  // ⚙️ PARSER DE MENSAGENS E FILTROS DE INTERAÇÃO
  // =================================================================
  desempacotarMensagem(msg) {
    if (!msg) return null;
    let atual = msg;
    while (atual) {
      if (atual.ephemeralMessage?.message) atual = atual.ephemeralMessage.message;
      else if (atual.viewOnceMessage?.message) atual = atual.viewOnceMessage.message;
      else if (atual.viewOnceMessageV2?.message) atual = atual.viewOnceMessageV2.message;
      else if (atual.viewOnceMessageV2Extension?.message) atual = atual.viewOnceMessageV2Extension.message;
      else if (atual.documentWithCaptionMessage?.message) atual = atual.documentWithCaptionMessage.message;
      else break;
    }
    return atual;
  }

  ehInteracaoPermitidaOuSistema(msg) {
    if (!msg || !msg.message) return true;

    // 1. Aba de Respostas / Comentários em Avisos (Threads do WhatsApp)
    if (msg.commentMetadata) return true;
    if (msg.messageContextInfo?.commentMetadata) return true;
    if (msg.message?.commentMessage || msg.message?.encCommentMessage) return true;

    const rawMsg = msg.message;
    const innerMsg = this.desempacotarMensagem(rawMsg) || rawMsg;

    if (innerMsg.commentMessage || innerMsg.encCommentMessage) return true;

    // 2. Reações com Emojis (👍, ❤️, 😂, etc.)
    if (rawMsg.reactionMessage || rawMsg.encReactionMessage) return true;
    if (innerMsg.reactionMessage || innerMsg.encReactionMessage) return true;

    // 3. Votos em Enquetes existentes (Membro interagindo com enquete de ADM)
    if (rawMsg.pollUpdateMessage || innerMsg.pollUpdateMessage) return true;
    if (rawMsg.encPollUpdateMessage || innerMsg.encPollUpdateMessage) return true;

    // 4. Stubs e Mensagens de Controle/Protocolo Interno do WhatsApp
    const tiposIgnorados = new Set([
      'protocolMessage',
      'senderKeyDistributionMessage',
      'messageContextInfo',
      'keepInChatMessage',
      'pinInChatMessage',
      'chatEventMessage',
      'callLogRecordMessage',
      'newsletterAdminInviteMessage',
      'requestPaymentMessage',
      'declinePaymentRequestMessage',
    ]);

    const chavesRaw = Object.keys(rawMsg);
    if (chavesRaw.length > 0 && chavesRaw.every(k => tiposIgnorados.has(k))) return true;

    const chavesInner = Object.keys(innerMsg);
    if (chavesInner.length > 0 && chavesInner.every(k => tiposIgnorados.has(k))) return true;

    // 5. ContextInfo indicando comentário/thread de aviso
    const contextInfo =
      innerMsg.extendedTextMessage?.contextInfo ||
      innerMsg.imageMessage?.contextInfo ||
      innerMsg.videoMessage?.contextInfo ||
      innerMsg.audioMessage?.contextInfo ||
      innerMsg.documentMessage?.contextInfo;
    if (contextInfo?.commentParentKey || contextInfo?.isComment) return true;

    return false;
  }

  ehMensagemDiretaDeConteudo(msg) {
    if (!msg || !msg.message) return false;
    const innerMsg = this.desempacotarMensagem(msg.message) || msg.message;

    const tiposConteudoReal = [
      'conversation',
      'extendedTextMessage',
      'imageMessage',
      'videoMessage',
      'audioMessage',
      'documentMessage',
      'stickerMessage',
      'contactMessage',
      'contactsArrayMessage',
      'locationMessage',
      'liveLocationMessage',
      'pollCreationMessage',
      'pollCreationMessageV2',
      'pollCreationMessageV3',
      'listMessage',
      'listResponseMessage',
      'buttonsMessage',
      'buttonsResponseMessage',
      'templateMessage',
      'templateButtonReplyMessage',
      'interactiveMessage',
      'interactiveResponseMessage',
      'ptvMessage',
      'orderMessage',
    ];

    return tiposConteudoReal.some(tipo => Boolean(innerMsg[tipo]));
  }

  // =================================================================
  // 🔍 VERIFICAÇÃO DE ADMINISTRADOR E WHITELIST
  // =================================================================
  ehAdminDoGrupo(senderId, metadata, identidade = null, campaignId = null) {
    if (!senderId) return false;

    // 1. Bots conectados da própria frota
    for (const [key, sock] of this.sockets.entries()) {
      if (sock && sock.user && this.compararIdentidades(sock.user.id, senderId)) {
        return true;
      }
    }

    // 2. Whitelist explícita da campanha ou global
    if (this.estaNaWhitelist(senderId, identidade, campaignId)) {
      return true;
    }

    // 3. Verificação dinâmica nos metadados do grupo: o participante é ADMIN no WhatsApp?
    if (metadata && Array.isArray(metadata.participants)) {
      const alvos = new Set();
      alvos.add(String(senderId));
      if (identidade?.jidTelefone) alvos.add(String(identidade.jidTelefone));
      if (identidade?.jidOriginal) alvos.add(String(identidade.jidOriginal));
      if (identidade?.numeroReal) {
        alvos.add(String(identidade.numeroReal));
        alvos.add(`${identidade.numeroReal}@s.whatsapp.net`);
      }

      const participante = metadata.participants.find(p => {
        for (const alvo of alvos) {
          if (this.compararIdentidades(p.id, alvo)) return true;
          if (p.lid && this.compararIdentidades(p.lid, alvo)) return true;
          if (p.jid && this.compararIdentidades(p.jid, alvo)) return true;
          if (p.phoneNumber && this.compararIdentidades(p.phoneNumber, alvo)) return true;
        }
        return false;
      });

      if (participante && (participante.admin === 'admin' || participante.admin === 'superadmin')) {
        return true;
      }
    }

    return false;
  }

  // =================================================================
  // 🎯 CENTRAL TÁTICA E DISPARO DE CONTRAMEDIDAS (SNIPER)
  // =================================================================
  async obterMetadataSegura(chatId, forcar = false) {
    if (!chatId) return null;
    const agora = Date.now();

    if (!forcar && this.cacheGrupos.has(chatId)) {
      const item = this.cacheGrupos.get(chatId);
      if (agora - item.tempo < 60000) return item.dados;
    }

    if (this.pendingMetadata.has(chatId)) {
      return await this.pendingMetadata.get(chatId);
    }

    const promessa = (async () => {
      // Tenta obter metadados com qualquer sniper ou espião conectado
      for (const [k, sock] of this.sockets.entries()) {
        if (sock && sock.user) {
          try {
            const data = await sock.groupMetadata(chatId);
            if (data && Array.isArray(data.participants)) {
              for (const p of data.participants) {
                if (p.lid && p.jid) this.registrarMapeamentoLid(p.lid, p.jid);
                if (p.lid && p.id && p.id.includes('@s.whatsapp.net')) this.registrarMapeamentoLid(p.lid, p.id);
                if (p.id && p.jid && p.id.includes('@lid')) this.registrarMapeamentoLid(p.id, p.jid);
              }
              this.cacheGrupos.set(chatId, { dados: data, tempo: Date.now() });
              return data;
            }
          } catch {}
        }
      }
      return null;
    })();

    this.pendingMetadata.set(chatId, promessa);
    try {
      return await promessa;
    } finally {
      this.pendingMetadata.delete(chatId);
    }
  }

  getSnipersForCampaign(campaignId) {
    const list = [];
    const camp = this.getCampaignById(campaignId);
    const qtd = camp?.qtdSnipers || 4;

    for (let i = 1; i <= qtd; i++) {
      const key = `${campaignId}_SNIPER_${i}`;
      const sock = this.sockets.get(key);
      if (sock && sock.user) list.push({ index: i, sock });
    }
    return list;
  }

  obterSniperAdminDoGrupo(chatId, metadata = null, campaignId = 'default') {
    const snipers = this.getSnipersForCampaign(campaignId);
    for (const { index, sock } of snipers) {
      if (!sock || !sock.user) continue;
      const meuJid = this.normalizarJid(sock.user.id);

      if (metadata && Array.isArray(metadata.participants)) {
        const euNoGrupo = metadata.participants.find(p => this.compararIdentidades(p.id, meuJid));
        if (euNoGrupo && (euNoGrupo.admin === 'admin' || euNoGrupo.admin === 'superadmin')) {
          return { index, sock };
        }
      }
    }
    // Fallback: retorna o primeiro sniper conectado da campanha
    return snipers[0] || null;
  }

  setupTacticalBus() {
    this.barramentoTatico.on('ocorrencia_espiao', async (alerta) => {
      const { campaignId = 'default', espiaoIndice, chatId, messageId, senderId, rawKey } = alerta;
      const camp = this.getCampaignById(campaignId);

      if (camp && camp.enabled === false) return;

      const hashMensagem = `${chatId}-${messageId}`;
      if (this.mensagensProcessadas.has(hashMensagem)) return;
      this.mensagensProcessadas.add(hashMensagem);
      setTimeout(() => this.mensagensProcessadas.delete(hashMensagem), 30000);

      let metadata = await this.obterMetadataSegura(chatId);
      if (!metadata) {
        await new Promise(r => setTimeout(r, 600));
        metadata = await this.obterMetadataSegura(chatId, true);
      }

      if (!metadata || !Array.isArray(metadata.participants)) {
        this.addLog('warn', `[⚠️ AUDITORIA] Metadados de ${chatId} inacessíveis no momento. Ignorando para evitar falso positivo.`, camp?.name);
        return;
      }

      const identidade = this.resolverIdentidadeInvasor(senderId, metadata, rawKey);

      // REGRA FUNDAMENTAL: Se o número for ADMINISTRADOR do grupo (ou Whitelist), NADA ACONTECE!
      if (this.ehAdminDoGrupo(senderId, metadata, identidade, campaignId)) {
        return; // Imune (Administrador oficial do grupo ou Whitelist)
      }

      // SE NÃO FOR ADMINISTRADOR: Dispara contramedidas imediatas
      const numInvasor = identidade.numeroReal || this.extrairNumeroLimpo(senderId);
      const nomeGrupo = metadata.subject || chatId;

      this.addLog(
        'error',
        `💥 MENSAGEM NÃO AUTORIZADA no grupo "${nomeGrupo}"! Membro não-admin: +${numInvasor} (LID: ${senderId})`,
        camp?.name
      );

      this.adicionarNaBlacklist(senderId);
      if (identidade?.jidTelefone && identidade.jidTelefone !== senderId) {
        this.adicionarNaBlacklist(identidade.jidTelefone);
      }
      if (identidade?.numeroReal) {
        this.adicionarNaBlacklist(identidade.numeroReal);
      }

      const sniperOperador = this.obterSniperAdminDoGrupo(chatId, metadata, campaignId);
      if (!sniperOperador || !sniperOperador.sock) {
        this.addLog('error', `❌ Nenhum Sniper conectado para responder à ameaça em "${nomeGrupo}".`, camp?.name);
        return;
      }

      const { index, sock } = sniperOperador;
      let msgApagada = false;
      let removidoOrigem = false;

      // Lista de alvos para comparação universal
      const alvos = new Set();
      alvos.add(String(senderId));
      if (identidade?.jidTelefone) alvos.add(String(identidade.jidTelefone));
      if (identidade?.jidOriginal) alvos.add(String(identidade.jidOriginal));
      if (identidade?.numeroReal) {
        alvos.add(String(identidade.numeroReal));
        alvos.add(`${identidade.numeroReal}@s.whatsapp.net`);
      }

      // AÇÃO 1: APAGAR A MENSAGEM DO GRUPO (DELETE FOR EVERYONE)
      try {
        const deleteKey = {
          remoteJid: chatId,
          fromMe: false,
          id: messageId,
          participant: rawKey?.participant || senderId,
        };
        await sock.sendMessage(chatId, { delete: deleteKey });
        msgApagada = true;
        this.addLog('success', `🗑️ Mensagem apagada instantaneamente pelo Sniper 0${index}!`, camp?.name);
        this.registrarEstatistica('MENSAGEM');
      } catch (err) {
        this.addLog('warn', `⚠️ Falha ao apagar mensagem em "${nomeGrupo}": ${err.message}`, camp?.name);
      }

      // AÇÃO 2: EXPULSAR O MEMBRO DO GRUPO DE ORIGEM
      try {
        await sock.groupParticipantsUpdate(chatId, [senderId], 'remove');
        removidoOrigem = true;
        this.addLog('success', `⚡ Membro não-admin +${numInvasor} expulso de "${nomeGrupo}" pelo Sniper 0${index}!`, camp?.name);
      } catch (err) {
        this.addLog('warn', `⚠️ Falha ao expulsar do grupo de origem: ${err.message}`, camp?.name);
      }

      // AÇÃO 3: ORDEM 66 - VARREDURA E EXPURGO EM MASSA EM TODOS OS OUTROS GRUPOS
      let banimentosOutrosGrupos = 0;
      const gruposVerificados = new Set();
      const todosSnipers = this.getSnipersForCampaign(campaignId);

      for (const sniperAgente of todosSnipers) {
        if (!sniperAgente?.sock?.user) continue;
        try {
          const todosGrupos = await sniperAgente.sock.groupFetchAllParticipating();
          for (const [idGrupo, grupoAlvo] of Object.entries(todosGrupos)) {
            if (idGrupo === chatId || gruposVerificados.has(idGrupo)) continue;

            const euSouAdmin = (grupoAlvo.participants || []).find(p => {
              return this.compararIdentidades(p.id, sniperAgente.sock.user.id) && (p.admin === 'admin' || p.admin === 'superadmin');
            });

            if (!euSouAdmin) continue;

            const alvoEscondido = (grupoAlvo.participants || []).find(p => {
              for (const alvo of alvos) {
                if (this.compararIdentidades(p.id, alvo)) return true;
                if (p.lid && this.compararIdentidades(p.lid, alvo)) return true;
                if (p.jid && this.compararIdentidades(p.jid, alvo)) return true;
                if (p.phoneNumber && this.compararIdentidades(p.phoneNumber, alvo)) return true;
              }
              return false;
            });

            if (alvoEscondido) {
              try {
                await sniperAgente.sock.groupParticipantsUpdate(idGrupo, [alvoEscondido.id], 'remove');
                banimentosOutrosGrupos++;
                gruposVerificados.add(idGrupo);
                const nomeGrupoAfetado = grupoAlvo.subject || idGrupo;
                this.registrarEstatistica('BANIMENTO', numInvasor, nomeGrupoAfetado);
                this.addLog('success', `🌪️ [ORDEM 66] Invasor +${numInvasor} expurgado também de "${nomeGrupoAfetado}"`, camp?.name);
              } catch {}
            } else {
              gruposVerificados.add(idGrupo);
            }
          }
        } catch {}
      }

      const totalGruposRemovidos = (removidoOrigem ? 1 : 0) + banimentosOutrosGrupos;
      if (removidoOrigem) {
        this.registrarEstatistica('BANIMENTO', numInvasor, nomeGrupo);
      }

      // AÇÃO 4: ALERTA NO GRUPO C2 DA CAMPANHA (SE CONFIGURADO)
      const grupoAlertas = camp?.grupoAlertas;
      const grupoAlertaValido =
        grupoAlertas && grupoAlertas.includes('@g.us') && grupoAlertas.replace(/\D/g, '').length >= 10;

      if (grupoAlertaValido) {
        const textoAlerta =
          `*🚨 INTERCEPTAÇÃO ANTI-HACKER BRABO*\n\n` +
          `*🎯 Campanha:* ${camp?.name || 'Principal'}\n` +
          `*📍 Grupo:* ${nomeGrupo}\n` +
          `*👤 Membro Não-Admin:* +${numInvasor}\n` +
          `*🗑️ Mensagem:* ${msgApagada ? 'Apagada Instantaneamente' : 'Falha na Exclusão'}\n` +
          `*⚙️ Ação:* Removido de ${totalGruposRemovidos} grupo(s).\n` +
          `*🛡️ Blacklist:* Número adicionado à lista negra global.\n\n` +
          `_Operação Aegis 8.2 - Defesa Ativa_`;

        for (const { sock } of snipers) {
          try {
            await sock.sendMessage(grupoAlertas, { text: textoAlerta });
            this.addLog('info', `📡 Alerta de interceptação enviado ao grupo C2.`, camp?.name);
            break;
          } catch {}
        }
      }
    });
  }

  // =================================================================
  // 🚀 GERENCIAMENTO DE AGENTES (SNIPERS & ESPIÕES POR CAMPANHA)
  // =================================================================
  getAgentKey(campaignId, type, index) {
    return `${campaignId}_${type.toUpperCase()}_${index}`;
  }

  getAgentAuthDir(campaignId, type, index) {
    const prefix = type.toUpperCase() === 'SNIPER' ? 'auth_sniper' : 'auth_spotter';
    if (campaignId === 'default') {
      return path.join(DATA_DIR, `${prefix}_${index}`);
    }
    return path.join(DATA_DIR, `${prefix}_${campaignId}_${index}`);
  }

  hasAgentAuth(campaignId, type, index) {
    try {
      const dir = this.getAgentAuthDir(campaignId, type, index);
      if (!fs.existsSync(dir)) return false;
      const credsPath = path.join(dir, 'creds.json');
      if (!fs.existsSync(credsPath)) return false;
      const content = JSON.parse(fs.readFileSync(credsPath, 'utf-8'));
      return Boolean(content && (content.registered || content.me?.id || content.account));
    } catch {
      return false;
    }
  }

  getAgentSavedPhone(campaignId, type, index) {
    try {
      const dir = this.getAgentAuthDir(campaignId, type, index);
      const credsPath = path.join(dir, 'creds.json');
      if (fs.existsSync(credsPath)) {
        const content = JSON.parse(fs.readFileSync(credsPath, 'utf-8'));
        const jid = content.me?.id || content.account?.id || '';
        if (jid) return jid.split(':')[0].split('@')[0].replace(/\D/g, '');
      }
    } catch {}
    return null;
  }

  async conectarAgente({ campaignId = 'default', type, index, phoneNumber = null, forceFresh = false }) {
    const key = this.getAgentKey(campaignId, type, index);
    const camp = this.getCampaignById(campaignId);
    const campName = camp ? camp.name : 'Principal';
    const tag = `[${campName} | ${type} 0${index}]`;
    const pastaAuth = this.getAgentAuthDir(campaignId, type, index);

    // Fecha socket anterior se existente
    const oldSock = this.sockets.get(key);
    if (oldSock) {
      try {
        oldSock.end();
      } catch {}
      this.sockets.delete(key);
    }

    if (forceFresh) {
      try {
        if (fs.existsSync(pastaAuth)) {
          fs.rmSync(pastaAuth, { recursive: true, force: true });
        }
      } catch {}
    }

    if (!fs.existsSync(pastaAuth)) {
      fs.mkdirSync(pastaAuth, { recursive: true });
    }

    const { state, saveCreds } = await useMultiFileAuthState(pastaAuth);
    const { version } = await fetchLatestBaileysVersion().catch(() => ({ version: [2, 3000, 1017531287] }));

    const cleanPhone = phoneNumber ? String(phoneNumber).replace(/\D/g, '') : null;

    const sock = makeWASocket({
      version,
      auth: state,
      printQRInTerminal: false,
      logger: this.logger,
      browser: Browsers.ubuntu('Chrome'),
      markOnlineOnConnect: true,
      generateHighQualityLinkPreview: true,
      syncFullHistory: false,
      connectTimeoutMs: 60000,
      defaultQueryTimeoutMs: 20000,
      keepAliveIntervalMs: 30000,
      emitOwnEvents: false,
      retryRequestDelayMs: 2000,
    });

    this.sockets.set(key, sock);
    const savedPhone = this.getAgentSavedPhone(campaignId, type, index);

    this.agentsState.set(key, {
      campaignId,
      type: type.toUpperCase(),
      index,
      status: state.creds.registered ? 'CONNECTING' : 'DISCONNECTED',
      phoneNumber: cleanPhone || savedPhone || null,
      groupCount: 0,
      pairingCode: null,
      qrDataUrl: null,
      lastConnectedAt: null,
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('chats.phoneNumberShare', ({ lid, jid }) => {
      if (lid && jid) this.registrarMapeamentoLid(lid, jid);
    });

    // Registra listeners de defesa
    if (type.toUpperCase() === 'SNIPER') {
      this.registrarEventosSniper(sock, campaignId, index);
    } else {
      this.registrarEventosEspiao(sock, campaignId, index);
    }

    // Gerenciador de conexão
    sock.ev.on('connection.update', async update => {
      const { connection, lastDisconnect, qr } = update;
      const current = this.agentsState.get(key) || {};

      if (qr) {
        try {
          const qrDataUrl = await QRCode.toDataURL(qr);
          this.agentsState.set(key, { ...current, qrDataUrl });
        } catch {}
      }

      if (connection === 'open') {
        let phone = sock.user?.id ? sock.user.id.split(':')[0].split('@')[0] : (cleanPhone || current.phoneNumber || savedPhone);
        if (phone && phone.includes(':')) phone = phone.split(':')[0];

        let groupCount = 0;
        try {
          const groups = await sock.groupFetchAllParticipating();
          groupCount = Object.keys(groups || {}).length;
        } catch {}

        this.agentsState.set(key, {
          ...current,
          campaignId,
          type: type.toUpperCase(),
          index,
          status: 'CONNECTED',
          phoneNumber: phone,
          groupCount,
          pairingCode: null,
          qrDataUrl: null,
          lastConnectedAt: new Date().toISOString(),
        });
        this.addLog('success', `✅ ${tag} Conectado e Operacional! (+${phone || 'Ativo'}) [${groupCount} grupos]`, campName);
      } else if (connection === 'close') {
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const ehLogout = statusCode === DisconnectReason.loggedOut;
        const errorMsg = lastDisconnect?.error?.message || 'Conexão encerrada';

        if (ehLogout) {
          this.agentsState.set(key, {
            ...current,
            campaignId,
            type: type.toUpperCase(),
            index,
            status: 'DISCONNECTED',
            phoneNumber: null,
            pairingCode: null,
            qrDataUrl: null,
          });
          try {
            if (fs.existsSync(pastaAuth)) fs.rmSync(pastaAuth, { recursive: true, force: true });
          } catch {}
          this.addLog('warn', `❌ ${tag} Desconectado (Logged Out).`, campName);
        } else {
          this.agentsState.set(key, {
            ...current,
            status: 'RECONNECTING',
          });
          this.addLog('info', `🔄 ${tag} Reconectando em 4s (${statusCode || errorMsg})...`, campName);
          setTimeout(() => {
            this.conectarAgente({ campaignId, type, index, forceFresh: false }).catch(() => {});
          }, 4000);
        }
      }
    });

    // Solicitar Pairing Code
    if (cleanPhone && !state.creds.registered) {
      await new Promise(r => setTimeout(r, 2000));
      try {
        const code = await sock.requestPairingCode(cleanPhone);
        const formattedCode = code?.match(/.{1,4}/g)?.join('-') || code;
        const current = this.agentsState.get(key) || {};
        this.agentsState.set(key, {
          ...current,
          campaignId,
          type: type.toUpperCase(),
          index,
          status: 'PAIRING',
          phoneNumber: cleanPhone,
          pairingCode: formattedCode,
        });
        this.addLog('info', `🔑 CÓDIGO DO ${tag}: ${formattedCode} (Para o número +${cleanPhone})`, campName);
        return { success: true, pairingCode: formattedCode, phoneNumber: cleanPhone };
      } catch (err) {
        this.addLog('error', `Falha ao solicitar código para ${tag}: ${err.message}`, campName);
        throw err;
      }
    }

    return sock;
  }

  registrarEventosSniper(sockSniper, campaignId, index) {
    sockSniper.ev.on('messages.upsert', async ({ messages, type }) => {
      if (type !== 'notify') return;

      for (const msg of messages) {
        if (!msg.message || !msg.key) continue;

        const msgTime = Number(msg.messageTimestamp || 0);
        if (msgTime > 0 && msgTime < TEMPO_BOOT) continue;

        let texto =
          msg.message.conversation ||
          msg.message.extendedTextMessage?.text ||
          msg.message.imageMessage?.caption ||
          '';

        texto = texto.trim().toLowerCase();
        if (texto !== '!idgrupo' && texto !== '!ping') continue;

        const senderId = this.normalizarJid(msg.key.participant || msg.key.remoteJid);
        const isMe = msg.key.fromMe;

        if (isMe || this.estaNaWhitelist(senderId, null, campaignId)) {
          const hashCmd = `${msg.key.id}-cmd`;
          if (this.travasDeRedundancia.has(hashCmd)) continue;
          this.travasDeRedundancia.add(hashCmd);
          setTimeout(() => this.travasDeRedundancia.delete(hashCmd), 30000);

          const chatId = msg.key.remoteJid;

          if (texto === '!ping') {
            await sockSniper.sendMessage(chatId, {
              text: `🏓 *Pong!* Sniper 0${index} operacional e armado com artilharia pesada.`,
            });
          } else if (texto === '!idgrupo') {
            await sockSniper.sendMessage(chatId, {
              text: `📍 *ID DESTE GRUPO:*\n\n\`${chatId}\``,
            });
            this.addLog('info', `[Comando C2] ID do Grupo solicitado: ${chatId}`);
          }
        }
      }
    });
  }

  registrarEventosEspiao(sockEspiao, campaignId, index) {
    sockEspiao.ev.on('messages.upsert', async ({ messages, type }) => {
      if (type !== 'notify') return;

      for (const msg of messages) {
        if (!msg.message || !msg.key || msg.key.fromMe) continue;

        const msgTime = Number(msg.messageTimestamp || 0);
        if (msgTime > 0 && msgTime < TEMPO_BOOT) continue;

        const chatId = msg.key.remoteJid;
        if (!isJidGroup(chatId)) continue;

        if (this.ehInteracaoPermitidaOuSistema(msg)) continue;
        if (!this.ehMensagemDiretaDeConteudo(msg)) continue;

        const senderBruto = msg.key.participant || msg.participant || msg.key.remoteJid;
        if (!senderBruto || senderBruto === chatId) continue;

        const senderId = this.normalizarJid(senderBruto);
        const messageId = msg.key.id;

        this.barramentoTatico.emit('ocorrencia_espiao', {
          campaignId,
          espiaoIndice: index,
          chatId,
          messageId,
          senderId,
          rawKey: msg.key,
          timestamp: msgTime,
        });
      }
    });
  }

  async desconectarAgente(campaignId = 'default', type, index) {
    const key = this.getAgentKey(campaignId, type, index);
    const camp = this.getCampaignById(campaignId);
    const tag = `[${camp?.name || 'Principal'} | ${type} 0${index}]`;
    const pastaAuth = this.getAgentAuthDir(campaignId, type, index);

    const sock = this.sockets.get(key);
    try {
      if (sock) {
        await sock.logout().catch(() => {});
        sock.end();
      }
    } catch {}

    this.sockets.delete(key);

    try {
      if (fs.existsSync(pastaAuth)) {
        fs.rmSync(pastaAuth, { recursive: true, force: true });
      }
    } catch {}

    this.agentsState.set(key, {
      campaignId,
      type: type.toUpperCase(),
      index,
      status: 'DISCONNECTED',
      phoneNumber: null,
      pairingCode: null,
      qrDataUrl: null,
    });

    this.addLog('warn', `🔌 ${tag} Desconectado manualmente.`);
    return { success: true, message: `${tag} desconectado com sucesso.` };
  }

  // =================================================================
  // 📊 STATUS CONSOLIDADO (POR CAMPANHA OU GLOBAL)
  // =================================================================
  getStatus(selectedCampaignId = 'all') {
    const campaignsList = this.getAllCampaigns();

    // Se filtrou por uma campanha específica
    const targetCampaigns = (selectedCampaignId && selectedCampaignId !== 'all')
      ? campaignsList.filter(c => c.id === selectedCampaignId)
      : campaignsList;

    const activeCamp = (selectedCampaignId && selectedCampaignId !== 'all')
      ? this.getCampaignById(selectedCampaignId) || campaignsList[0]
      : campaignsList[0] || {};

    const snipers = [];
    const espioes = [];

    for (const camp of targetCampaigns) {
      const qtdSnipers = camp.qtdSnipers || 4;
      const qtdEspioes = camp.qtdEspioes || 9;

      for (let i = 1; i <= qtdSnipers; i++) {
        const key = this.getAgentKey(camp.id, 'SNIPER', i);
        let state = this.agentsState.get(key);
        const sock = this.sockets.get(key);
        const hasAuth = this.hasAgentAuth(camp.id, 'SNIPER', i);
        const savedPhone = this.getAgentSavedPhone(camp.id, 'SNIPER', i);

        if (!state) {
          state = {
            campaignId: camp.id,
            type: 'SNIPER',
            index: i,
            status: hasAuth ? 'CONNECTED' : 'DISCONNECTED',
            phoneNumber: savedPhone,
            groupCount: 0,
            pairingCode: null,
            qrDataUrl: null,
          };
        } else {
          if (sock?.user?.id) {
            state.status = 'CONNECTED';
            state.phoneNumber = sock.user.id.split(':')[0].split('@')[0];
          } else if (hasAuth && (state.status === 'SAVED_AUTH' || state.status === 'DISCONNECTED')) {
            state.status = 'CONNECTED';
            if (!state.phoneNumber && savedPhone) state.phoneNumber = savedPhone;
          }
        }
        snipers.push(state);
      }

      for (let i = 1; i <= qtdEspioes; i++) {
        const key = this.getAgentKey(camp.id, 'ESPIAO', i);
        let state = this.agentsState.get(key);
        const sock = this.sockets.get(key);
        const hasAuth = this.hasAgentAuth(camp.id, 'ESPIAO', i);
        const savedPhone = this.getAgentSavedPhone(camp.id, 'ESPIAO', i);

        if (!state) {
          state = {
            campaignId: camp.id,
            type: 'ESPIAO',
            index: i,
            status: hasAuth ? 'CONNECTED' : 'DISCONNECTED',
            phoneNumber: savedPhone,
            groupCount: 0,
            pairingCode: null,
            qrDataUrl: null,
          };
        } else {
          if (sock?.user?.id) {
            state.status = 'CONNECTED';
            state.phoneNumber = sock.user.id.split(':')[0].split('@')[0];
          } else if (hasAuth && (state.status === 'SAVED_AUTH' || state.status === 'DISCONNECTED')) {
            state.status = 'CONNECTED';
            if (!state.phoneNumber && savedPhone) state.phoneNumber = savedPhone;
          }
        }
        espioes.push(state);
      }
    }

    const isConnected = s => s.status === 'CONNECTED' || s.status === 'READY' || s.status === 'open';
    const connectedSnipers = snipers.filter(isConnected).length;
    const connectedEspioes = espioes.filter(isConnected).length;

    return {
      selectedCampaignId: selectedCampaignId || 'all',
      campaigns: campaignsList,
      activeCampaign: activeCamp,
      stats: this.cacheEstatisticas,
      blacklist: this.cacheBlacklist,
      blacklistCount: this.cacheBlacklist.length,
      whitelistCount: (activeCamp.whitelist || []).length,
      snipers,
      espioes,
      connectedSnipers,
      connectedEspioes,
      logs: this.logs,
    };
  }

  // =================================================================
  // ⚡ INICIALIZAÇÃO AUTOMÁTICA AO SUBIR O SERVIDOR
  // =================================================================
  autoBoot() {
    this.loadConfigAndCampaigns();
    this.setupTacticalBus();

    this.addLog('info', `🛡️ Motor Aegis 8.2 Carregado. Inicializando ${this.campaigns.length} campanhas de segurança...`);

    for (const camp of this.campaigns) {
      if (camp.enabled === false) continue;

      const qtdSnipers = camp.qtdSnipers || 4;
      const qtdEspioes = camp.qtdEspioes || 9;

      for (let i = 1; i <= qtdSnipers; i++) {
        if (this.hasAgentAuth(camp.id, 'SNIPER', i)) {
          this.addLog('info', `[${camp.name} | Sniper 0${i}] Credenciais salvas encontradas. Conectando...`);
          this.conectarAgente({ campaignId: camp.id, type: 'SNIPER', index: i }).catch(() => {});
        }
      }

      for (let i = 1; i <= qtdEspioes; i++) {
        if (this.hasAgentAuth(camp.id, 'ESPIAO', i)) {
          this.addLog('info', `[${camp.name} | Espião 0${i}] Credenciais salvas encontradas. Conectando...`);
          this.conectarAgente({ campaignId: camp.id, type: 'ESPIAO', index: i }).catch(() => {});
        }
      }
    }
  }
}

export const antiHackerService = new AntiHackerService();
