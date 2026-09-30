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
import { ROOT_DIR } from '../config.js';

// ⏱️ RELÓGIO MESTRE ABSOLUTO (com margem de segurança de 15s para desvios de NTP)
const TEMPO_BOOT = Math.floor(Date.now() / 1000) - 15;

export class AntiHackerService {
  constructor() {
    this.configFile = path.join(ROOT_DIR, 'antihacker_config.json');
    this.blacklistFile = path.join(ROOT_DIR, 'blacklist_aegis.json');
    this.statsFile = path.join(ROOT_DIR, 'estatisticas_aegis.json');

    this.barramentoTatico = new EventEmitter();
    this.barramentoTatico.setMaxListeners(300);

    this.mensagensProcessadas = new Set();
    this.travasDeRedundancia = new Set();
    this.cacheGrupos = new Map(); // chatId -> { dados, tempo }
    this.pendingMetadata = new Map();
    this.mapaLidParaTelefone = new Map(); // lid -> telefone real

    this.frotaSnipers = []; // array de sockets
    this.frotaEspioes = []; // array de sockets

    this.agentsState = new Map(); // key (`SNIPER_1`, `ESPIAO_1`) -> state info
    this.logs = [];

    this.config = {
      enabled: true,
      whitelist: [],
      qtdSnipers: 4,
      qtdEspioes: 9,
      grupoAlertas: '120363413670200654@g.us',
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

  addLog(level, message) {
    const time = new Date().toLocaleTimeString('pt-BR');
    const entry = {
      id: Date.now() + Math.random().toString(36).substring(2, 6),
      time,
      timestamp: new Date().toISOString(),
      level, // 'info' | 'success' | 'warn' | 'error'
      message,
    };
    this.logs.unshift(entry);
    if (this.logs.length > 500) this.logs.pop();
    console.log(`[${time}] [AEGIS 8.2] ${message}`);
  }

  // =================================================================
  // 📂 CARREGAMENTO E PERSISTÊNCIA DE CONFIGURAÇÕES E BANCO DE DADOS
  // =================================================================
  loadConfig() {
    try {
      if (fs.existsSync(this.configFile)) {
        const data = JSON.parse(fs.readFileSync(this.configFile, 'utf-8'));
        this.config = { ...this.config, ...data };
      } else {
        this.saveConfig();
      }
    } catch (err) {
      this.addLog('error', `Erro ao carregar config Anti-Hacker: ${err.message}`);
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
  }

  saveConfig() {
    try {
      fs.writeFileSync(this.configFile, JSON.stringify(this.config, null, 2));
    } catch (err) {
      this.addLog('error', `Erro ao salvar config: ${err.message}`);
    }
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
  // 🔍 NORMALIZAÇÃO E RESOLUÇÃO DE IDENTIDADES (LID -> TELEFONE)
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

    // 1. Extração direta de atributos Phone Number na mensagem original (Baileys rawKey)
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

    // 2. Extração via metadados do grupo
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

    // 3. Consulta ao mapa global de cache LID -> Telefone
    if (!numeroReal) {
      const lidLimpo = this.extrairNumeroLimpo(senderId);
      if (this.mapaLidParaTelefone.has(lidLimpo)) {
        numeroReal = this.mapaLidParaTelefone.get(lidLimpo);
        jidTelefone = `${numeroReal}@s.whatsapp.net`;
      }
    }

    // 4. Se o próprio senderId já for um número de telefone comum
    if (!numeroReal) {
      if (senderId.includes('@s.whatsapp.net')) {
        numeroReal = this.extrairNumeroLimpo(senderId);
        jidTelefone = senderId;
      } else {
        numeroReal = this.extrairNumeroLimpo(senderId) || senderId;
        jidTelefone = senderId;
      }
    }

    return { numero: numeroReal, jid: jidTelefone };
  }

  // =================================================================
  // 🛡️ BLACKLIST & WHITELIST
  // =================================================================
  estaNaBlacklist(jid) {
    if (!jid || this.cacheBlacklist.length === 0) return false;
    const jidStr = String(jid);
    const idNorm = this.normalizarID(jidStr);
    const numPuro = jidStr.split('@')[0].split(':')[0].replace(/\D/g, '');

    return this.cacheBlacklist.some(b => {
      if (!b) return false;
      const bStr = String(b);
      const bPuro = bStr.split('@')[0].split(':')[0].replace(/\D/g, '');
      const bNorm = this.normalizarID(bStr);

      if (bStr === jidStr) return true;
      if (numPuro && bPuro && numPuro === bPuro) return true;
      if (idNorm && bNorm && idNorm === bNorm) return true;
      if (numPuro && bPuro && numPuro.length >= 10 && bPuro.length >= 10) {
        if (bStr.includes(numPuro) || jidStr.includes(bPuro)) return true;
      }
      return false;
    });
  }

  adicionarNaBlacklist(jid) {
    if (!jid) return;
    const jidStr = String(jid);
    const idNorm = this.normalizarID(jidStr);
    const numPuro = jidStr.split('@')[0].split(':')[0].replace(/\D/g, '');
    let atualizou = false;

    if (!this.cacheBlacklist.includes(jidStr)) {
      this.cacheBlacklist.push(jidStr);
      atualizou = true;
    }
    if (numPuro && !this.cacheBlacklist.includes(numPuro)) {
      this.cacheBlacklist.push(numPuro);
      atualizou = true;
    }
    if (idNorm && !this.cacheBlacklist.includes(idNorm)) {
      this.cacheBlacklist.push(idNorm);
      atualizou = true;
    }

    if (atualizou) {
      fs.promises.writeFile(this.blacklistFile, JSON.stringify(this.cacheBlacklist, null, 2)).catch(() => {});
      this.addLog('warn', `🔒 Invasor indexado na Blacklist: ${numPuro || jidStr}`);
    }
  }

  removerDaBlacklist(item) {
    const alvo = String(item).trim();
    const idNorm = this.normalizarID(alvo);
    const numPuro = alvo.replace(/\D/g, '');

    this.cacheBlacklist = this.cacheBlacklist.filter(b => {
      const bStr = String(b);
      const bPuro = bStr.replace(/\D/g, '');
      const bNorm = this.normalizarID(bStr);
      if (bStr === alvo || (numPuro && bPuro === numPuro) || (idNorm && bNorm === idNorm)) {
        return false;
      }
      return true;
    });

    fs.promises.writeFile(this.blacklistFile, JSON.stringify(this.cacheBlacklist, null, 2)).catch(() => {});
    this.addLog('info', `🔓 Número removido da Blacklist: ${alvo}`);
    return true;
  }

  estaNaWhitelist(jid, identidade = null) {
    if (!jid) return false;

    const alvos = new Set();
    alvos.add(String(jid));
    if (identidade?.jid) alvos.add(String(identidade.jid));
    if (identidade?.numero) {
      alvos.add(String(identidade.numero));
      alvos.add(`${identidade.numero}@s.whatsapp.net`);
    }

    const whitelist = this.config.whitelist || [];

    for (const alvo of alvos) {
      const idNorm = this.normalizarID(alvo);
      const numLimpo = this.extrairNumeroLimpo(alvo);

      for (const seguro of whitelist) {
        if (!seguro) continue;
        if (this.normalizarID(seguro) === idNorm || (numLimpo && this.extrairNumeroLimpo(seguro) === numLimpo)) {
          return true;
        }
      }

      // Bots da frota de Snipers e Espiões são sempre imunes
      for (const sniper of this.frotaSnipers) {
        if (sniper?.user?.id && this.compararIdentidades(sniper.user.id, alvo)) return true;
      }
      for (const espiao of this.frotaEspioes) {
        if (espiao?.user?.id && this.compararIdentidades(espiao.user.id, alvo)) return true;
      }
    }

    return false;
  }

  // =================================================================
  // 🛡️ METADADOS SEGUROS COM CACHE E IDENTIFICAÇÃO DE ADMIN
  // =================================================================
  async obterMetadataSegura(chatId, forcarAtualizacao = false) {
    const agora = Date.now();
    const cache = this.cacheGrupos.get(chatId);

    if (!forcarAtualizacao && cache && agora - cache.tempo < 60000) {
      return cache.dados;
    }

    if (this.pendingMetadata.has(chatId)) {
      return await this.pendingMetadata.get(chatId);
    }

    const promessa = (async () => {
      // 1. Tenta consultar através dos Snipers conectados
      for (const sniper of this.frotaSnipers) {
        if (!sniper || !sniper.user) continue;
        try {
          const metadata = await sniper.groupMetadata(chatId);
          if (metadata && Array.isArray(metadata.participants)) {
            for (const p of metadata.participants) {
              if (p.lid && p.jid) this.registrarMapeamentoLid(p.lid, p.jid);
              if (p.lid && p.id && p.id.includes('@s.whatsapp.net')) this.registrarMapeamentoLid(p.lid, p.id);
              if (p.id && p.jid && p.id.includes('@lid')) this.registrarMapeamentoLid(p.id, p.jid);
            }
            this.cacheGrupos.set(chatId, { dados: metadata, tempo: Date.now() });
            return metadata;
          }
        } catch {}
      }

      // 2. Fallback: tenta consultar pelos espiões
      for (const espiao of this.frotaEspioes) {
        if (!espiao || !espiao.user) continue;
        try {
          const metadata = await espiao.groupMetadata(chatId);
          if (metadata && Array.isArray(metadata.participants)) {
            for (const p of metadata.participants) {
              if (p.lid && p.jid) this.registrarMapeamentoLid(p.lid, p.jid);
              if (p.lid && p.id && p.id.includes('@s.whatsapp.net')) this.registrarMapeamentoLid(p.lid, p.id);
              if (p.id && p.jid && p.id.includes('@lid')) this.registrarMapeamentoLid(p.id, p.jid);
            }
            this.cacheGrupos.set(chatId, { dados: metadata, tempo: Date.now() });
            return metadata;
          }
        } catch {}
      }

      return cache ? cache.dados : null;
    })();

    this.pendingMetadata.set(chatId, promessa);
    try {
      return await promessa;
    } finally {
      this.pendingMetadata.delete(chatId);
    }
  }

  verificarSeEhAdmin(metadata, senderJid, identidade = null) {
    if (!metadata || !Array.isArray(metadata.participants)) return false;

    const alvos = new Set();
    if (senderJid) alvos.add(String(senderJid));
    if (identidade?.jid) alvos.add(String(identidade.jid));
    if (identidade?.numero) {
      alvos.add(String(identidade.numero));
      alvos.add(`${identidade.numero}@s.whatsapp.net`);
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

    return Boolean(participante && (participante.admin === 'admin' || participante.admin === 'superadmin'));
  }

  obterSniperAdminDoGrupo(chatId, metadata = null) {
    for (const sniper of this.frotaSnipers) {
      if (!sniper || !sniper.user) continue;
      const meuJid = this.normalizarJid(sniper.user.id);

      if (metadata && Array.isArray(metadata.participants)) {
        const euNoGrupo = metadata.participants.find(p => this.compararIdentidades(p.id, meuJid));
        if (euNoGrupo && (euNoGrupo.admin === 'admin' || euNoGrupo.admin === 'superadmin')) {
          return sniper;
        }
      }
    }
    return this.frotaSnipers.find(s => s && s.user) || null;
  }

  // =================================================================
  // 🛡️ RECONHECEDOR TÁTICO DE CONTEÚDO (ANTI-FALSO-POSITIVO)
  // =================================================================
  desempacotarMensagem(message) {
    let m = message;
    for (let i = 0; i < 5; i++) {
      if (!m || typeof m !== 'object') break;
      if (m.ephemeralMessage?.message) { m = m.ephemeralMessage.message; continue; }
      if (m.viewOnceMessage?.message) { m = m.viewOnceMessage.message; continue; }
      if (m.viewOnceMessageV2?.message) { m = m.viewOnceMessageV2.message; continue; }
      if (m.viewOnceMessageV2Extension?.message) { m = m.viewOnceMessageV2Extension.message; continue; }
      if (m.documentWithCaptionMessage?.message) { m = m.documentWithCaptionMessage.message; continue; }
      break;
    }
    return m;
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
  // 🎯 CENTRAL TÁTICA E DISPARO DE CONTRAMEDIDAS (SNIPER)
  // =================================================================
  setupTacticalBus() {
    this.barramentoTatico.on('ocorrencia_espiao', async (alerta) => {
      if (!this.config.enabled) return;

      const { chatId, messageId, senderId, rawKey } = alerta;

      // 1. Anti-duplicação
      const hashMensagem = `${chatId}-${messageId}`;
      if (this.mensagensProcessadas.has(hashMensagem)) return;
      this.mensagensProcessadas.add(hashMensagem);
      setTimeout(() => this.mensagensProcessadas.delete(hashMensagem), 30000);

      // 2. Metadados do Grupo
      let metadata = await this.obterMetadataSegura(chatId);
      if (!metadata) {
        await new Promise(r => setTimeout(r, 600));
        metadata = await this.obterMetadataSegura(chatId, true);
      }

      // Proteção anti-falso-positivo
      if (!metadata || !Array.isArray(metadata.participants)) {
        this.addLog('warn', `[⚠️ AUDITORIA] Não foi possível verificar participantes de ${chatId}. Ação abortada para evitar falso positivo.`);
        return;
      }

      // 3. Resolução de Identidade (LID -> Telefone Real)
      const identidade = this.resolverIdentidadeInvasor(senderId, metadata, rawKey);

      // 4. Checagem de Whitelist e Bots da Frota
      if (this.estaNaWhitelist(senderId, identidade)) {
        return; // Imune
      }

      // 5. Checagem de Admin do Grupo
      const remetenteEhAdmin = this.verificarSeEhAdmin(metadata, senderId, identidade);
      if (remetenteEhAdmin) {
        return; // É Admin do grupo: Permitido
      }

      // 🚨 INVASOR CONFIRMADO
      const nomeGrupo = metadata.subject || chatId;
      const numInvasor = identidade.numero || senderId;
      this.addLog('error', `💀 ALERTA MÁXIMO: Invasor detectado no grupo "${nomeGrupo}": ${numInvasor}`);

      const sniperOperador = this.obterSniperAdminDoGrupo(chatId, metadata);
      if (!sniperOperador) {
        this.addLog('error', `❌ Nenhum Sniper conectado para responder à ameaça em "${nomeGrupo}".`);
        return;
      }

      // AÇÃO 1: APAGAR A MENSAGEM (DELETE FOR EVERYONE)
      let msgApagada = false;
      try {
        await sniperOperador.sendMessage(chatId, {
          delete: {
            remoteJid: chatId,
            fromMe: false,
            id: messageId,
            participant: rawKey.participant || senderId,
          },
        });
        msgApagada = true;
        this.registrarEstatistica('MENSAGEM');
        this.addLog('success', `💥 MENSAGEM APAGADA: Mensagem do invasor eliminada em "${nomeGrupo}"`);
      } catch (err) {
        this.addLog('warn', `[!] Falha ao apagar mensagem (Sniper precisa ser admin do grupo): ${err?.message || err}`);
      }

      // AÇÃO 2: EXPULSAR O INVASOR DO GRUPO ATUAL
      let removidoOrigem = false;
      try {
        await sniperOperador.groupParticipantsUpdate(chatId, [senderId], 'remove');
        removidoOrigem = true;
        this.addLog('success', `⛔ EXPULSÃO CONCLUÍDA: Invasor expulso de "${nomeGrupo}"`);
      } catch (err) {
        this.addLog('warn', `[!] Falha ao expulsar do grupo de origem: ${err?.message || err}`);
      }

      // AÇÃO 3: INDEXAR NA BLACKLIST (LID + Telefone)
      this.adicionarNaBlacklist(senderId);
      if (identidade.jid && identidade.jid !== senderId) {
        this.adicionarNaBlacklist(identidade.jid);
      }
      if (identidade.numero) {
        this.adicionarNaBlacklist(identidade.numero);
      }

      // AÇÃO 4: "ORDEM 66" - EXPURGAR DE TODOS OS OUTROS GRUPOS
      let banimentos = 0;
      const gruposVerificados = new Set([chatId]);
      const idAlvoNorm = this.normalizarID(senderId);
      const numInvasorPuro = this.extrairNumeroLimpo(numInvasor);

      for (const sniper of this.frotaSnipers) {
        if (!sniper || !sniper.user) continue;
        try {
          const todosOsGrupos = await sniper.groupFetchAllParticipating();
          for (const idGrupo in todosOsGrupos) {
            if (gruposVerificados.has(idGrupo)) continue;

            const grupoAlvo = todosOsGrupos[idGrupo];
            if (!grupoAlvo || !Array.isArray(grupoAlvo.participants)) continue;

            const alvoEscondido = grupoAlvo.participants.find(p => {
              const pId = p.id ? String(p.id) : '';
              const pLid = p.lid ? String(p.lid) : '';
              const pJid = p.jid ? String(p.jid) : '';

              return (
                pId === senderId ||
                pLid === senderId ||
                (idAlvoNorm && this.normalizarID(pId) === idAlvoNorm) ||
                (numInvasorPuro && numInvasorPuro.length >= 10 && pId.includes(numInvasorPuro)) ||
                (numInvasorPuro && numInvasorPuro.length >= 10 && pJid.includes(numInvasorPuro)) ||
                this.estaNaBlacklist(pId) ||
                (pLid && this.estaNaBlacklist(pLid))
              );
            });

            if (alvoEscondido) {
              try {
                await sniper.groupParticipantsUpdate(idGrupo, [alvoEscondido.id], 'remove');
                banimentos++;
                gruposVerificados.add(idGrupo);
                const nomeGrupoAfetado = grupoAlvo.subject || idGrupo;
                this.registrarEstatistica('BANIMENTO', numInvasor, nomeGrupoAfetado);
                this.addLog('success', `🌍 ORDEM 66: Invasor eliminado também de "${nomeGrupoAfetado}"`);
              } catch {}
            } else {
              gruposVerificados.add(idGrupo);
            }
          }
        } catch {}
      }

      const gruposExpurgados = (removidoOrigem ? 1 : 0) + banimentos;
      if (removidoOrigem) {
        this.registrarEstatistica('BANIMENTO', numInvasor, nomeGrupo);
      }

      // AÇÃO 5: DISPARAR ALERTA NO GRUPO DE ALERTAS
      const grupoAlertas = this.config.grupoAlertas;
      const grupoAlertaValido =
        grupoAlertas && grupoAlertas.includes('@g.us') && grupoAlertas.replace(/\D/g, '').length >= 10;

      if (grupoAlertaValido) {
        const textoAlerta =
          `*🚨 INTERCEPTAÇÃO ANTI-HACKER BRABO*\n\n` +
          `*📍 Grupo Atacado:* ${nomeGrupo}\n` +
          `*👤 Invasor:* ${numInvasor}\n` +
          `*🗑️ Mensagem:* ${msgApagada ? 'Apagada Instantaneamente' : 'Falha na Exclusão'}\n` +
          `*⚙️ Status:* Neutralizado & Expurgado de ${gruposExpurgados} grupo(s).\n` +
          `*🛡️ Blacklist:* Número indexado e bloqueado.\n\n` +
          `_Operação Aegis 8.2 - Defesa Ativa_`;

        for (const sniper of this.frotaSnipers) {
          if (!sniper || !sniper.user) continue;
          try {
            await sniper.sendMessage(grupoAlertas, { text: textoAlerta });
            this.addLog('info', `📡 Alerta de interceptação enviado ao grupo de alertas.`);
            break;
          } catch {}
        }
      }
    });
  }

  // =================================================================
  // 🛑 CATRACA DE FERRO (Expulsão ao entrar no grupo)
  // =================================================================
  async processarCatracaDeFerro(evento) {
    if (!this.config.enabled || evento.action !== 'add') return;

    for (let novato of evento.participants) {
      if (typeof novato === 'object' && novato !== null) novato = novato.id || novato.jid || '';
      if (!novato) continue;
      novato = String(novato);

      const hashEntrada = `${evento.id}-${novato}`;
      if (this.travasDeRedundancia.has(hashEntrada)) continue;

      const ehInimigo = this.estaNaBlacklist(novato);

      if (ehInimigo) {
        this.travasDeRedundancia.add(hashEntrada);
        setTimeout(() => this.travasDeRedundancia.delete(hashEntrada), 30000);

        const numPuro = novato.split('@')[0].split(':')[0].replace(/\D/g, '');
        this.addLog('warn', `🚪 CATRACA DE FERRO: Invasor da Blacklist tentou entrar no grupo: ${numPuro || novato}`);

        let nomeGrupo = evento.id;
        try {
          const metadata = await this.obterMetadataSegura(evento.id);
          if (metadata) nomeGrupo = metadata.subject || evento.id;
        } catch {}

        setTimeout(async () => {
          for (const sniper of this.frotaSnipers) {
            if (!sniper || !sniper.user) continue;
            try {
              await sniper.groupParticipantsUpdate(evento.id, [novato], 'remove');
              this.addLog('success', `✅ CATRACA DE FERRO: Invasor barrado com sucesso pelo Sniper.`);
              this.registrarEstatistica('BANIMENTO', numPuro || novato, nomeGrupo);
              break;
            } catch {}
          }
        }, 1200);
      }
    }
  }

  // =================================================================
  // 🚀 GERENCIAMENTO DE AGENTES (SNIPERS & ESPIÕES)
  // =================================================================
  getAgentKey(type, index) {
    return `${type.toUpperCase()}_${index}`;
  }

  getAgentAuthDir(type, index) {
    const prefix = type.toUpperCase() === 'SNIPER' ? 'auth_sniper' : 'auth_spotter';
    return path.join(ROOT_DIR, `${prefix}_${index}`);
  }

  hasAgentAuth(type, index) {
    try {
      const dir = this.getAgentAuthDir(type, index);
      if (!fs.existsSync(dir)) return false;
      const credsPath = path.join(dir, 'creds.json');
      if (!fs.existsSync(credsPath)) return false;
      const content = JSON.parse(fs.readFileSync(credsPath, 'utf-8'));
      return Boolean(content && content.registered);
    } catch {
      return false;
    }
  }

  async conectarAgente({ type, index, phoneNumber = null, forceFresh = false }) {
    const key = this.getAgentKey(type, index);
    const tag = `[${type} 0${index}]`;
    const pastaAuth = this.getAgentAuthDir(type, index);

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

    // Registra na frota
    if (type.toUpperCase() === 'SNIPER') {
      this.frotaSnipers[index - 1] = sock;
    } else {
      this.frotaEspioes[index - 1] = sock;
    }

    this.agentsState.set(key, {
      type: type.toUpperCase(),
      index,
      status: 'CONNECTING',
      phoneNumber: null,
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
      this.registrarEventosSniper(sock, index);
    } else {
      this.registrarEventosEspiao(sock, index);
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
        const phone = sock.user?.id ? sock.user.id.split(':')[0].split('@')[0] : current.phoneNumber;
        this.agentsState.set(key, {
          ...current,
          status: 'CONNECTED',
          phoneNumber: phone,
          pairingCode: null,
          qrDataUrl: null,
          lastConnectedAt: new Date().toISOString(),
        });
        this.addLog('success', `✅ ${tag} Conectado e Operacional! (+${phone || 'Ativo'})`);
      } else if (connection === 'close') {
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const ehLogout = statusCode === DisconnectReason.loggedOut;
        const errorMsg = lastDisconnect?.error?.message || 'Conexão encerrada';

        if (ehLogout) {
          this.agentsState.set(key, {
            ...current,
            status: 'DISCONNECTED',
            phoneNumber: null,
            pairingCode: null,
            qrDataUrl: null,
          });
          try {
            if (fs.existsSync(pastaAuth)) fs.rmSync(pastaAuth, { recursive: true, force: true });
          } catch {}
          this.addLog('warn', `❌ ${tag} Desconectado (Logged Out).`);
        } else {
          this.agentsState.set(key, {
            ...current,
            status: 'RECONNECTING',
          });
          this.addLog('info', `🔄 ${tag} Reconectando em 4s (${statusCode || errorMsg})...`);
          setTimeout(() => {
            this.conectarAgente({ type, index, forceFresh: false }).catch(() => {});
          }, 4000);
        }
      }
    });

    // Se solicitou Pairing Code para novo número
    if (phoneNumber && !state.creds.registered) {
      await new Promise(r => setTimeout(r, 2500));
      try {
        const code = await sock.requestPairingCode(phoneNumber);
        const formattedCode = code?.match(/.{1,4}/g)?.join('-') || code;
        const current = this.agentsState.get(key) || {};
        this.agentsState.set(key, {
          ...current,
          status: 'PAIRING',
          phoneNumber,
          pairingCode: formattedCode,
        });
        this.addLog('info', `🔑 CÓDIGO DO ${tag}: ${formattedCode} (Para o número +${phoneNumber})`);
        return { success: true, pairingCode: formattedCode, phoneNumber };
      } catch (err) {
        this.addLog('error', `Falha ao solicitar código para ${tag}: ${err.message}`);
        throw err;
      }
    }

    return sock;
  }

  registrarEventosSniper(sockSniper, index) {
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

        if (isMe || this.estaNaWhitelist(senderId)) {
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

    sockSniper.ev.on('group-participants.update', e => this.processarCatracaDeFerro(e));
  }

  registrarEventosEspiao(sockEspiao, index) {
    sockEspiao.ev.on('group-participants.update', e => this.processarCatracaDeFerro(e));

    sockEspiao.ev.on('messages.upsert', async ({ messages, type }) => {
      if (type !== 'notify') return;

      for (const msg of messages) {
        if (!msg.message || !msg.key || msg.key.fromMe) continue;

        const msgTime = Number(msg.messageTimestamp || 0);
        if (msgTime > 0 && msgTime < TEMPO_BOOT) continue;

        const chatId = msg.key.remoteJid;
        if (!isJidGroup(chatId)) continue;

        // 1. Filtro rigoroso: Permite Reações, Aba de Respostas e Votos em Enquete
        if (this.ehInteracaoPermitidaOuSistema(msg)) continue;

        // 2. Garante que é uma mensagem direta real de conteúdo no feed principal
        if (!this.ehMensagemDiretaDeConteudo(msg)) continue;

        const senderBruto = msg.key.participant || msg.participant || msg.key.remoteJid;
        if (!senderBruto || senderBruto === chatId) continue;

        const senderId = this.normalizarJid(senderBruto);
        const messageId = msg.key.id;

        // Despacha ocorrência para o barramento dos Snipers
        this.barramentoTatico.emit('ocorrencia_espiao', {
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

  async desconectarAgente(type, index) {
    const key = this.getAgentKey(type, index);
    const tag = `[${type} 0${index}]`;
    const pastaAuth = this.getAgentAuthDir(type, index);

    let sock = type.toUpperCase() === 'SNIPER' ? this.frotaSnipers[index - 1] : this.frotaEspioes[index - 1];

    try {
      if (sock) {
        await sock.logout().catch(() => {});
        sock.end();
      }
    } catch {}

    if (type.toUpperCase() === 'SNIPER') {
      this.frotaSnipers[index - 1] = null;
    } else {
      this.frotaEspioes[index - 1] = null;
    }

    try {
      if (fs.existsSync(pastaAuth)) {
        fs.rmSync(pastaAuth, { recursive: true, force: true });
      }
    } catch {}

    this.agentsState.set(key, {
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
  // 📊 STATUS CONSOLIDADO DO MÓDULO ANTI-HACKER
  // =================================================================
  getStatus() {
    const snipers = [];
    const espioes = [];

    const qtdSnipers = this.config.qtdSnipers || 4;
    const qtdEspioes = this.config.qtdEspioes || 9;

    for (let i = 1; i <= qtdSnipers; i++) {
      const key = this.getAgentKey('SNIPER', i);
      const state = this.agentsState.get(key) || {
        type: 'SNIPER',
        index: i,
        status: this.hasAgentAuth('SNIPER', i) ? 'SAVED_AUTH' : 'DISCONNECTED',
        phoneNumber: null,
        pairingCode: null,
        qrDataUrl: null,
      };
      snipers.push(state);
    }

    for (let i = 1; i <= qtdEspioes; i++) {
      const key = this.getAgentKey('ESPIAO', i);
      const state = this.agentsState.get(key) || {
        type: 'ESPIAO',
        index: i,
        status: this.hasAgentAuth('ESPIAO', i) ? 'SAVED_AUTH' : 'DISCONNECTED',
        phoneNumber: null,
        pairingCode: null,
        qrDataUrl: null,
      };
      espioes.push(state);
    }

    const connectedSnipers = snipers.filter(s => s.status === 'CONNECTED').length;
    const connectedEspioes = espioes.filter(e => e.status === 'CONNECTED').length;

    return {
      enabled: this.config.enabled,
      config: this.config,
      stats: this.cacheEstatisticas,
      blacklistCount: this.cacheBlacklist.length,
      whitelistCount: (this.config.whitelist || []).length,
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
    this.loadConfig();
    this.setupTacticalBus();

    this.addLog('info', '🛡️ Motor Aegis 8.2 Carregado. Verificando frotas salvas...');

    const qtdSnipers = this.config.qtdSnipers || 4;
    const qtdEspioes = this.config.qtdEspioes || 9;

    // Conecta automaticamente os que já possuem autenticação salva
    for (let i = 1; i <= qtdSnipers; i++) {
      if (this.hasAgentAuth('SNIPER', i)) {
        this.addLog('info', `[Sniper 0${i}] Credenciais salvas encontradas. Inicializando...`);
        this.conectarAgente({ type: 'SNIPER', index: i }).catch(() => {});
      }
    }

    for (let i = 1; i <= qtdEspioes; i++) {
      if (this.hasAgentAuth('ESPIAO', i)) {
        this.addLog('info', `[Espião 0${i}] Credenciais salvas encontradas. Inicializando...`);
        this.conectarAgente({ type: 'ESPIAO', index: i }).catch(() => {});
      }
    }
  }
}

export const antiHackerService = new AntiHackerService();
