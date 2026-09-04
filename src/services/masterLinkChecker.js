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

      let currentUrl = url;
      let response = null;
      let finalUrl = url;
      let statusCode = 200;
      let redirectCount = 0;
      const MAX_REDIRECTS = 6;

      // Segue a cadeia de redirecionamentos manualmente para inspecionar cada salto
      while (redirectCount < MAX_REDIRECTS) {
        response = await fetch(currentUrl, {
          method: 'GET',
          signal: controller.signal,
          redirect: 'manual',
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8',
          },
        });

        statusCode = response.status;
        finalUrl = currentUrl;

        // Se for redirecionamento (301, 302, 303, 307, 308)
        if ([301, 302, 303, 307, 308].includes(statusCode)) {
          const locationHeader = response.headers.get('location');
          if (locationHeader) {
            currentUrl = new URL(locationHeader, currentUrl).href;
            finalUrl = currentUrl;
            redirectCount++;
            // Se já apontou para o WhatsApp, encontramos o destino!
            if (finalUrl.includes('chat.whatsapp.com')) {
              break;
            }
            continue;
          }
        }
        break;
      }

      clearTimeout(timeoutId);
      const durationMs = Date.now() - startTime;

      let htmlText = '';
      try {
        if (response) htmlText = await response.text();
      } catch {}

      // Se a página for um pre-lander/pixel da SendFlow (ex: sndflw.com/i/...),
      // extrai o link do WhatsApp embutido no HTML/script
      const htmlWaMatch = htmlText.match(/https?:\/\/(?:chat\.)?whatsapp\.com\/([A-Za-z0-9_-]+)/i);
      if (!finalUrl.includes('chat.whatsapp.com') && htmlWaMatch) {
        finalUrl = htmlWaMatch[0];
      }

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
