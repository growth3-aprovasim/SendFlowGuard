import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  Browsers,
} from '@whiskeysockets/baileys';
import pino from 'pino';
import path from 'path';
import fs from 'fs';
import QRCode from 'qrcode';
import { DATA_DIR } from '../config.js';
import { verifierService } from './verifier.js';

class WhatsAppSocketService {
  constructor() {
    this.sock = null;
    this.authDir = path.join(DATA_DIR, 'auth_info_baileys');
    this.status = 'DISCONNECTED'; // 'DISCONNECTED' | 'PAIRING' | 'CONNECTING' | 'CONNECTED'
    this.phoneNumber = null;
    this.lastPairingCode = null;
    this.pairingCodeExpiresAt = null;
    this.lastQrDataUrl = null;
    this.lastConnectedAt = null;
    this.lastError = null;
    this.isInitializing = false;
    this.reconnectTimeout = null;
    this.logger = pino({ level: 'silent' });
  }

  log(level, msg) {
    const time = new Date().toLocaleTimeString('pt-BR');
    console.log(`[${time}] [WhatsApp Protocol] ${msg}`);
    try {
      verifierService.addLog(level, `[WhatsApp Protocol] ${msg}`);
    } catch {}
  }

  /**
   * Verifica se já existem credenciais salvas e autenticadas em disco
   */
  hasSavedAuth() {
    try {
      if (!fs.existsSync(this.authDir)) return false;
      const credsPath = path.join(this.authDir, 'creds.json');
      if (!fs.existsSync(credsPath)) return false;
      const content = JSON.parse(fs.readFileSync(credsPath, 'utf-8'));
      return Boolean(content && content.registered);
    } catch {
      return false;
    }
  }

  /**
   * Inicializa o socket do Baileys
   */
  async initSocket(forceFresh = false) {
    if (this.sock && this.status === 'CONNECTED' && !forceFresh) {
      return this.sock;
    }

    if (this.isInitializing) {
      return null;
    }

    this.isInitializing = true;
    this.status = 'CONNECTING';

    try {
      if (forceFresh) {
        this.log('warn', 'Limpando pasta de autenticação para iniciar pareamento do zero...');
        this.clearAuthFiles();
      }

      if (!fs.existsSync(this.authDir)) {
        fs.mkdirSync(this.authDir, { recursive: true });
      }

      const { state, saveCreds } = await useMultiFileAuthState(this.authDir);
      const { version } = await fetchLatestBaileysVersion().catch(() => ({ version: [2, 3000, 1017531287] }));

      this.log('info', `Inicializando conexão WebSocket com WhatsApp (Versão Baileys: ${version.join('.')})...`);

      this.sock = makeWASocket({
        version,
        logger: this.logger,
        printQRInTerminal: false,
        auth: {
          creds: state.creds,
          keys: makeCacheableSignalKeyStore(state.keys, this.logger),
        },
        // Browsers.ubuntu('Chrome') é a tupla recomendada oficialmente para Pairing Code
        browser: Browsers.ubuntu('Chrome'),
        syncFullHistory: false,
        markOnlineOnConnect: false,
        generateHighQualityLinkPreview: false,
        connectTimeoutMs: 60000,
        defaultQueryTimeoutMs: 20000,
        keepAliveIntervalMs: 30000,
        emitOwnEvents: false,
        retryRequestDelayMs: 2000,
      });

      this.sock.ev.on('creds.update', async () => {
        await saveCreds();
        this.log('info', 'Chaves e credenciais criptográficas salvas no disco.');
      });

      this.sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
          try {
            this.lastQrDataUrl = await QRCode.toDataURL(qr);
            this.log('info', 'QR Code de pareamento gerado e disponível no dashboard.');
          } catch (err) {
            this.log('error', `Falha ao converter QR Code: ${err.message}`);
          }
        }

        if (connection === 'connecting') {
          this.log('info', 'Negociando handshake e chaves de segurança com os servidores da Meta...');
        }

        if (connection === 'open') {
          this.status = 'CONNECTED';
          this.lastConnectedAt = new Date().toISOString();
          this.lastError = null;
          this.lastPairingCode = null;
          this.lastQrDataUrl = null;
          this.phoneNumber = this.sock?.user?.id ? this.sock.user.id.split(':')[0].split('@')[0] : this.phoneNumber;
          this.log('success', `🎉 Conexão estabelecida com sucesso! Aparelho autenticado: +${this.phoneNumber || 'Ativo'}`);
        } else if (connection === 'close') {
          const statusCode = lastDisconnect?.error?.output?.statusCode;
          const errorMsg = lastDisconnect?.error?.message || 'Conexão encerrada';
          const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

          this.log('warn', `Conexão fechada pelo servidor. Código: ${statusCode ?? 'N/A'} (${errorMsg})`);

          if (statusCode === DisconnectReason.loggedOut) {
            this.status = 'DISCONNECTED';
            this.phoneNumber = null;
            this.lastPairingCode = null;
            this.lastQrDataUrl = null;
            this.clearAuthFiles();
            this.log('error', '⚠️ Sessão finalizada (Logged Out). Credenciais limpas.');
          } else if (statusCode === DisconnectReason.restartRequired) {
            this.log('info', 'Reinício de handshake solicitado pelo WhatsApp. Reconectando instantaneamente...');
            this.status = 'CONNECTING';
            this.initSocket(false).catch(() => {});
          } else if (shouldReconnect) {
            this.status = 'CONNECTING';
            this.log('info', 'Tentando reconectar aos servidores do WhatsApp em 4 segundos...');
            if (this.reconnectTimeout) clearTimeout(this.reconnectTimeout);
            this.reconnectTimeout = setTimeout(() => {
              this.initSocket(false).catch(() => {});
            }, 4000);
          } else {
            this.status = 'DISCONNECTED';
          }
        }
      });

      this.isInitializing = false;
      return this.sock;
    } catch (err) {
      this.isInitializing = false;
      this.status = 'DISCONNECTED';
      this.lastError = err.message;
      this.log('error', `Erro crítico ao inicializar socket: ${err.message}`);
      return null;
    }
  }

  /**
   * Solicita um Código de Pareamento de 8 dígitos para o número informado
   * @param {string} rawPhoneNumber Número com DDI e DDD (ex: 5511999999999)
   * @returns {Promise<{ pairingCode: string }>}
   */
  async requestPairingCode(rawPhoneNumber) {
    if (!rawPhoneNumber) {
      throw new Error('Número de telefone obrigatório (com DDI e DDD, ex: 5511999999999).');
    }

    const cleanPhone = String(rawPhoneNumber).replace(/\D/g, '');
    if (cleanPhone.length < 10 || cleanPhone.length > 15) {
      throw new Error(`Número inválido (${cleanPhone}). Formato esperado: DDI + DDD + Número (ex: 5511987654321).`);
    }

    // Se já estiver conectado com sucesso, avisa
    if (this.status === 'CONNECTED' && this.sock?.user) {
      return {
        alreadyConnected: true,
        phoneNumber: this.phoneNumber,
        message: 'WhatsApp já está conectado com sucesso.',
      };
    }

    this.log('info', `Solicitando novo código de pareamento para o número +${cleanPhone}...`);

    // Reset de qualquer conexão aberta anterior para gerar chaves limpas
    try {
      if (this.sock) {
        this.sock.end();
        this.sock = null;
      }
    } catch {}

    // Inicia socket novo com chaves limpas
    await this.initSocket(true);

    if (!this.sock) {
      throw new Error('Falha ao inicializar o cliente do WhatsApp.');
    }

    // Aguarda 3 segundos para o WebSocket conectar e receber os dados iniciais do servidor
    await new Promise(r => setTimeout(r, 3000));

    try {
      this.status = 'PAIRING';
      this.phoneNumber = cleanPhone;

      this.log('info', `Enviando requisição de Pairing Code para +${cleanPhone}...`);
      const code = await this.sock.requestPairingCode(cleanPhone);
      const formattedCode = code?.match(/.{1,4}/g)?.join('-') || code;

      this.lastPairingCode = formattedCode;
      this.pairingCodeExpiresAt = Date.now() + 180000; // 3 minutos

      this.log('success', `🔑 CÓDIGO DE PAREAMENTO GERADO: ${formattedCode} (Digite no celular em até 3 minutos)`);

      return {
        pairingCode: formattedCode,
        rawCode: code,
        phoneNumber: cleanPhone,
        expiresInSeconds: 180,
      };
    } catch (err) {
      this.status = 'DISCONNECTED';
      this.lastError = err.message;
      this.log('error', `Erro ao solicitar código de pareamento: ${err.message}`);
      throw new Error(`Erro ao solicitar código de pareamento: ${err.message}`);
    }
  }

  /**
   * Desconecta o WhatsApp e remove as credenciais salvas
   */
  async disconnect() {
    this.log('warn', 'Desconectando sessão do WhatsApp...');
    try {
      if (this.sock) {
        await this.sock.logout().catch(() => {});
        this.sock.end();
        this.sock = null;
      }
    } catch {}
    this.clearAuthFiles();
    this.status = 'DISCONNECTED';
    this.phoneNumber = null;
    this.lastPairingCode = null;
    this.lastQrDataUrl = null;
    this.log('info', 'WhatsApp desconectado com sucesso.');
    return { success: true, message: 'WhatsApp desconectado com sucesso.' };
  }

  /**
   * Remove arquivos de autenticação do disco
   */
  clearAuthFiles() {
    try {
      if (fs.existsSync(this.authDir)) {
        fs.rmSync(this.authDir, { recursive: true, force: true });
      }
    } catch (err) {
      console.warn('[WhatsApp Protocol] Aviso ao limpar authDir:', err.message);
    }
  }

  /**
   * Retorna o status atual da conexão
   */
  getStatus() {
    const isConnected = this.status === 'CONNECTED' && Boolean(this.sock?.user);
    return {
      isConnected,
      status: isConnected ? 'CONNECTED' : this.status,
      phoneNumber: this.phoneNumber || (this.sock?.user?.id ? this.sock.user.id.split(':')[0].split('@')[0] : null),
      hasSavedAuth: this.hasSavedAuth(),
      lastConnectedAt: this.lastConnectedAt,
      lastPairingCode: this.pairingCodeExpiresAt && Date.now() < this.pairingCodeExpiresAt ? this.lastPairingCode : null,
      qrDataUrl: this.lastQrDataUrl,
      lastError: this.lastError,
    };
  }

  /**
   * Consulta os metadados oficiais de um link de convite diretamente pelo protocolo do WhatsApp
   * @param {string} inviteCode 
   * @returns {Promise<{ isValid: boolean, isRevoked?: boolean, isTemporaryError?: boolean, title?: string, size?: number, id?: string, status: string, message: string, durationMs: number, checkedAt: string }>}
   */
  async checkInvite(inviteCode) {
    const startTime = Date.now();
    const cleanCode = String(inviteCode).trim().replace(/https?:\/\/chat\.whatsapp\.com\//i, '').replace(/[^A-Za-z0-9_-]/g, '');

    if (!cleanCode) {
      return {
        isValid: false,
        isRevoked: true,
        title: null,
        status: 'INVALID_CODE',
        message: 'Código de convite vazio ou inválido.',
        durationMs: 0,
        checkedAt: new Date().toISOString(),
      };
    }

    if (!this.sock || this.status !== 'CONNECTED') {
      return {
        isValid: true,
        isTemporaryError: true,
        status: 'SOCKET_DISCONNECTED',
        message: 'Instância do WhatsApp não conectada.',
        durationMs: Date.now() - startTime,
        checkedAt: new Date().toISOString(),
      };
    }

    try {
      // Consulta oficial direta ao servidor do WhatsApp
      const info = await this.sock.groupGetInviteInfo(cleanCode);

      if (info && info.subject) {
        return {
          isValid: true,
          isRevoked: false,
          title: info.subject,
          id: info.id || null,
          size: typeof info.size === 'number' ? info.size : (info.participants?.length || null),
          inviteCode: cleanCode,
          url: `https://chat.whatsapp.com/${cleanCode}`,
          status: 'VALID',
          engine: 'WHATSAPP_PROTOCOL',
          message: `Link ativo (Protocolo): "${info.subject}" (${info.size ?? 0} membros)`,
          durationMs: Date.now() - startTime,
          checkedAt: new Date().toISOString(),
        };
      }

      // Se retornou objeto sem subject
      return {
        isValid: false,
        isRevoked: true,
        title: null,
        inviteCode: cleanCode,
        url: `https://chat.whatsapp.com/${cleanCode}`,
        status: 'REVOKED',
        engine: 'WHATSAPP_PROTOCOL',
        message: 'Link revogado confirmado diretamente pelo WhatsApp.',
        durationMs: Date.now() - startTime,
        checkedAt: new Date().toISOString(),
      };
    } catch (err) {
      const durationMs = Date.now() - startTime;
      const errMsg = String(err?.message || err).toLowerCase();
      const statusCode = err?.data || err?.output?.statusCode;

      // Códigos clássicos de revogação/inexistência do WhatsApp (404, 401, not-found, gone, invalid)
      const isRevoked =
        statusCode === 404 ||
        statusCode === 401 ||
        statusCode === 410 ||
        errMsg.includes('not-authorized') ||
        errMsg.includes('not-found') ||
        errMsg.includes('invalid') ||
        errMsg.includes('item-not-found') ||
        errMsg.includes('bad-request') ||
        errMsg.includes('resource-limit');

      if (isRevoked) {
        return {
          isValid: false,
          isRevoked: true,
          title: null,
          inviteCode: cleanCode,
          url: `https://chat.whatsapp.com/${cleanCode}`,
          status: 'REVOKED',
          engine: 'WHATSAPP_PROTOCOL',
          message: `Link revogado confirmado pelo WhatsApp (${err.message || 'Código inválido ou cancelado'}).`,
          durationMs,
          checkedAt: new Date().toISOString(),
        };
      }

      // Se foi desconexão/timeout transitório do socket
      return {
        isValid: true,
        isTemporaryError: true,
        title: null,
        inviteCode: cleanCode,
        url: `https://chat.whatsapp.com/${cleanCode}`,
        status: 'SOCKET_ERROR',
        engine: 'WHATSAPP_PROTOCOL',
        message: `Oscilação de conexão no WhatsApp (${err.message}). Estado preservado.`,
        durationMs,
        checkedAt: new Date().toISOString(),
      };
    }
  }

  /**
   * Inicia automaticamente na inicialização do servidor se houver credenciais
   */
  autoStartIfAuthExists() {
    if (this.hasSavedAuth()) {
      this.log('info', 'Credenciais salvas encontradas. Conectando automaticamente...');
      this.initSocket(false).catch(() => {});
    }
  }
}

export const whatsappSocketService = new WhatsAppSocketService();
