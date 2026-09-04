import { WhatsAppChecker } from './whatsappChecker.js';

export class MasterLinkChecker {
  /**
   * Verifica a saúde do Link Mãe (redirecionador principal da campanha)
   * @param {string} masterUrl 
   * @param {object} options
   */
  static async check(masterUrl, options = {}) {
    const startTime = Date.now();
    const url = (masterUrl || '').trim();

    if (!url) {
      return {
        isOnline: false,
        status: 'OFFLINE',
        url: '',
        finalUrl: '',
        statusCode: 0,
        durationMs: 0,
        checkedAt: new Date().toISOString(),
        destinationGroup: null,
        message: 'Nenhum Link Mãe configurado no .env (MASTER_LINK_URL está vazio).',
      };
    }

    const timeout = options.timeout || 15000;

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      // Faz a requisição seguindo os redirecionamentos para achar o destino final
      const response = await fetch(url, {
        method: 'GET',
        signal: controller.signal,
        redirect: 'follow',
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8',
          'Cache-Control': 'no-cache',
        },
      });

      clearTimeout(timeoutId);

      const durationMs = Date.now() - startTime;
      const finalUrl = response.url || url;
      const statusCode = response.status;

      // Se o link mãe retornou erro HTTP (ex: 404, 500, 502, 503)
      if (statusCode >= 400) {
        return {
          isOnline: false,
          status: 'OFFLINE',
          url,
          finalUrl,
          statusCode,
          durationMs,
          checkedAt: new Date().toISOString(),
          destinationGroup: null,
          message: `Link Mãe retornou erro HTTP ${statusCode} (${response.statusText}).`,
        };
      }

      // Verifica se o destino final é um convite do WhatsApp
      const isWhatsApp = finalUrl.includes('chat.whatsapp.com');
      let destinationGroup = null;

      if (isWhatsApp) {
        const inviteCode = WhatsAppChecker.sanitizeInviteCode(finalUrl);
        const groupCheck = await WhatsAppChecker.checkInvite(inviteCode);

        destinationGroup = {
          isWhatsApp: true,
          inviteCode,
          url: finalUrl,
          title: groupCheck.title,
          isValid: groupCheck.isValid,
          groupStatus: groupCheck.status,
        };

        if (!groupCheck.isValid) {
          return {
            isOnline: false,
            status: 'DESTINATION_REVOKED',
            url,
            finalUrl,
            statusCode,
            durationMs,
            checkedAt: new Date().toISOString(),
            destinationGroup,
            message: `🚨 ALERTA CRÍTICO: O Link Mãe está online, mas está redirecionando para um grupo do WhatsApp com link REVOGADO/INVÁLIDO! (${groupCheck.message})`,
          };
        }

        return {
          isOnline: true,
          status: 'OPERATIONAL',
          url,
          finalUrl,
          statusCode,
          durationMs,
          checkedAt: new Date().toISOString(),
          destinationGroup,
          message: `✅ Link Mãe 100% Saudável: Redireciona com sucesso para "${groupCheck.title}" em ${durationMs}ms.`,
        };
      }

      // Destino não é WhatsApp diretamente (ex: página intermediária ou pre-landing com 200 OK)
      return {
        isOnline: true,
        status: 'OPERATIONAL',
        url,
        finalUrl,
        statusCode,
        durationMs,
        checkedAt: new Date().toISOString(),
        destinationGroup: {
          isWhatsApp: false,
          url: finalUrl,
        },
        message: `Link Mãe online respondendo com status ${statusCode} em ${durationMs}ms.`,
      };
    } catch (err) {
      return {
        isOnline: false,
        status: 'OFFLINE',
        url,
        finalUrl: '',
        statusCode: 0,
        durationMs: Date.now() - startTime,
        checkedAt: new Date().toISOString(),
        destinationGroup: null,
        message: `Falha ao conectar no Link Mãe: ${err.message}`,
      };
    }
  }
}
