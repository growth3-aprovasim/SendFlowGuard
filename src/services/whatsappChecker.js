/**
 * Módulo de Verificação de Integridade de Links de Convite do WhatsApp
 * com proteção avançada contra falsos positivos (pop-ups de cookies,
 * bloqueios temporários de IP em VPS e desafios da Meta).
 */

export class WhatsAppChecker {
  /**
   * Extrai o código do convite caso tenha vindo como URL completa
   * @param {string} inviteCodeOrUrl 
   * @returns {string}
   */
  static sanitizeInviteCode(inviteCodeOrUrl) {
    if (!inviteCodeOrUrl) return '';
    const str = String(inviteCodeOrUrl).trim();
    const match = str.match(/chat\.whatsapp\.com\/([A-Za-z0-9_-]+)/i);
    if (match) return match[1];
    return str.replace(/[^A-Za-z0-9_-]/g, '');
  }

  /**
   * Cabeçalhos simulando navegadores reais com bypass de consentimento de cookies
   */
  static getDesktopHeaders() {
    return {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
      'Accept':
        'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
      'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
      'Sec-Ch-Ua': '"Chromium";v="128", "Not;A=Brand";v="24", "Google Chrome";v="128"',
      'Sec-Ch-Ua-Mobile': '?0',
      'Sec-Ch-Ua-Platform': '"Windows"',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Sec-Fetch-User': '?1',
      'Upgrade-Insecure-Requests': '1',
      'Cookie': 'wa_lang_pref=pt_BR; wa_ul=pt_BR; dpr=1',
      'Cache-Control': 'no-cache',
      'Pragma': 'no-cache',
    };
  }

  static getMobileHeaders() {
    return {
      'User-Agent':
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
      'Accept':
        'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Cookie': 'wa_lang_pref=pt_BR; wa_ul=pt_BR',
      'Cache-Control': 'no-cache',
    };
  }

  /**
   * Analisa o HTML retornado e identifica o estado do grupo
   */
  static parseInviteHtml(html, statusCode) {
    // 1. Detectar se caiu em página de bloqueio ou erro HTTP
    const isRateLimited = statusCode === 429;
    const isCookieBanner =
      html.includes('consent.whatsapp.com') ||
      (html.includes('cookie') && html.includes('Antes de continuar'));
    const isSecurityBlock =
      statusCode === 403 ||
      html.includes('cf-browser-verification') ||
      html.includes('id="captcha"');

    if (isRateLimited || isCookieBanner || isSecurityBlock) {
      return {
        isInterrupted: true,
        reason: isRateLimited
          ? 'RATE_LIMIT_429'
          : isCookieBanner
          ? 'COOKIE_CONSENT_POPUP'
          : 'SECURITY_BLOCK',
      };
    }

    // 2. Extrai título via meta tags OpenGraph
    const ogTitleMatches = [...html.matchAll(/<meta\s+property=["']og:title["']\s+content=["'](.*?)["']/gis)].map(m => m[1].trim());
    const twitterTitleMatches = [...html.matchAll(/<meta\s+name=["']twitter:title["']\s+content=["'](.*?)["']/gis)].map(m => m[1].trim());
    
    // 3. Extrai título via h3 (padrão do WhatsApp Web)
    const h3Matches = [...html.matchAll(/<h3[^>]*>(.*?)<\/h3>/gis)].map(m => m[1].replace(/<[^>]*>/g, '').trim());

    // 4. Extrai título via tag <title>
    const titleTagMatches = [...html.matchAll(/<title[^>]*>(.*?)<\/title>/gis)].map(m => m[1].replace(/<[^>]*>/g, '').trim());

    const groupH3 = h3Matches.length > 0 ? h3Matches[0] : '';
    const ogTitle = ogTitleMatches.length > 0 ? ogTitleMatches[0] : '';
    const twitterTitle = twitterTitleMatches.length > 0 ? twitterTitleMatches[0] : '';
    const rawTitleTag = titleTagMatches.length > 0 ? titleTagMatches[0] : '';

    // Títulos genéricos que NÃO representam o nome real de um grupo
    const genericTitles = [
      'whatsapp group invite',
      'convite para grupo do whatsapp',
      'convite para conversa em grupo',
      'whatsapp',
      'parece que você ainda não instalou o whatsapp.',
      'parece que você ainda não instalou o whatsapp',
      'looks like you don\'t have whatsapp installed!',
      'looks like you don\'t have whatsapp installed',
      'entrar na conversa',
      'join chat',
      'baixar o whatsapp',
      'download whatsapp',
    ];

    function isGeneric(str) {
      if (!str || !str.trim()) return true;
      const lower = str.toLowerCase().trim();
      return genericTitles.some(g => lower === g || (g.length > 6 && lower.startsWith(g)));
    }

    let detectedTitle = null;
    if (groupH3 && !isGeneric(groupH3)) {
      detectedTitle = groupH3;
    } else if (ogTitle && !isGeneric(ogTitle)) {
      detectedTitle = ogTitle;
    } else if (twitterTitle && !isGeneric(twitterTitle)) {
      detectedTitle = twitterTitle;
    } else if (rawTitleTag && !isGeneric(rawTitleTag)) {
      const cleaned = rawTitleTag.replace(/\s*-\s*WhatsApp.*$/i, '').trim();
      if (!isGeneric(cleaned)) {
        detectedTitle = cleaned;
      }
    }

    // Verifica se a página contém a estrutura canônica de convite
    const hasInviteLayout =
      html.includes('_9vd5') ||
      html.includes('Convite para conversa em grupo') ||
      html.includes('Convite para grupo') ||
      html.includes('WhatsApp Group Invite') ||
      html.includes('action-icon');

    const isExplicitlyRevoked = hasInviteLayout && !detectedTitle;

    return {
      isInterrupted: false,
      hasInviteLayout,
      detectedTitle: detectedTitle || null,
      isExplicitlyRevoked,
      statusCode,
    };
  }

  /**
   * Executa uma requisição HTTP individual com timeout
   */
  static async fetchPage(url, headers, timeout = 10000) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    try {
      const res = await fetch(url, {
        method: 'GET',
        headers,
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      const text = await res.text();
      return { status: res.status, text };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Verifica se o link de convite do WhatsApp está ativo e válido.
   */
  static async checkInvite(inviteCodeOrUrl, options = {}) {
    const startTime = Date.now();
    const inviteCode = this.sanitizeInviteCode(inviteCodeOrUrl);
    const url = `https://chat.whatsapp.com/${inviteCode}`;

    if (!inviteCode) {
      return {
        isValid: false,
        title: null,
        inviteCode: '',
        url: '',
        status: 'ERROR',
        message: 'Código de convite inválido ou vazio.',
        checkedAt: new Date().toISOString(),
        durationMs: 0,
      };
    }

    // === TENTATIVA 1: Headers Desktop Chrome com Bypass de Consentimento ===
    try {
      const page1 = await this.fetchPage(url, this.getDesktopHeaders(), 10000);

      if (page1.status === 404) {
        return {
          isValid: false,
          title: null,
          inviteCode,
          url,
          status: 'NOT_FOUND',
          message: 'Página de convite retornou 404 (Não encontrada).',
          checkedAt: new Date().toISOString(),
          durationMs: Date.now() - startTime,
        };
      }

      const parsed1 = this.parseInviteHtml(page1.text, page1.status);

      // Se encontrou o título com sucesso na 1ª tentativa: VÁLIDO!
      if (parsed1.detectedTitle) {
        return {
          isValid: true,
          title: parsed1.detectedTitle,
          inviteCode,
          url,
          status: 'VALID',
          message: `Link ativo e funcionando: "${parsed1.detectedTitle}"`,
          checkedAt: new Date().toISOString(),
          durationMs: Date.now() - startTime,
        };
      }
    } catch (err1) {
      // Continua para a tentativa de confirmação
    }

    // Pausa de 1 segundo antes da confirmação
    await new Promise(r => setTimeout(r, 1000));

    // === TENTATIVA 2: Confirmação via Headers Mobile Safari ===
    try {
      const page2 = await this.fetchPage(url, this.getMobileHeaders(), 10000);
      const parsed2 = this.parseInviteHtml(page2.text, page2.status);

      if (parsed2.detectedTitle) {
        return {
          isValid: true,
          title: parsed2.detectedTitle,
          inviteCode,
          url,
          status: 'VALID',
          message: `Link ativo e validado: "${parsed2.detectedTitle}"`,
          checkedAt: new Date().toISOString(),
          durationMs: Date.now() - startTime,
        };
      }

      if (parsed2.isInterrupted) {
        return {
          isValid: true,
          title: null,
          inviteCode,
          url,
          status: 'INCONCLUSIVE',
          message: `Aviso: WhatsApp apresentou tela de consentimento/desafio (${parsed2.reason}). Link mantido como seguro.`,
          checkedAt: new Date().toISOString(),
          durationMs: Date.now() - startTime,
        };
      }

      // Declarar REVOKED quando não há título de grupo real
      return {
        isValid: false,
        title: null,
        inviteCode,
        url,
        status: 'REVOKED',
        message: 'Link revogado confirmado (Nenhum nome de grupo detectado na tela de convite).',
        checkedAt: new Date().toISOString(),
        durationMs: Date.now() - startTime,
      };
    } catch (err2) {
      // Falha na requisição mobile
    }

    return {
      isValid: false,
      title: null,
      inviteCode,
      url,
      status: 'REVOKED',
      message: 'Não foi possível validar o link de convite do WhatsApp.',
      checkedAt: new Date().toISOString(),
      durationMs: Date.now() - startTime,
    };
  }
}
