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
      // Cookies simulados para sinalizar preferência de idioma e consentimento
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

    // Ignora títulos genéricos da página
    const genericTitles = [
      'WhatsApp Group Invite',
      'Convite para grupo do WhatsApp',
      'Convite para conversa em grupo',
      'WhatsApp',
      '',
    ];

    let detectedTitle = groupH3 || ogTitle || twitterTitle;
    if (!detectedTitle && rawTitleTag && !genericTitles.includes(rawTitleTag)) {
      detectedTitle = rawTitleTag.replace(/\s*-\s*WhatsApp.*$/i, '').trim();
    }

    // Verifica se a página contém a estrutura canônica de convite
    const hasInviteLayout =
      html.includes('_9vd5') ||
      html.includes('Convite para conversa em grupo') ||
      html.includes('Convite para grupo') ||
      html.includes('WhatsApp Group Invite') ||
      html.includes('action-icon');

    // Assinatura específica de link comprovadamente revogado:
    // O layout de convite existe, mas o título está explicitamente vazio
    const isExplicitlyRevoked =
      hasInviteLayout &&
      (!detectedTitle || detectedTitle.length === 0) &&
      (html.includes('class="_9vd5 _9scr"') || html.includes('property="og:title" content=""'));

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
   * Executa múltiplas camadas de confirmação (Desktop + Mobile) antes de
   * considerar um link revogado, eliminando falsos positivos.
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

      // Se foi interrompido por pop-up de cookies ou bloqueio temporário na VPS:
      // Não marca como quebrado! Tenta a via Mobile
    } catch (err1) {
      // Erro de rede temporário, continua para a tentativa de confirmação
    }

    // Pausa de 1 segundo antes da confirmação
    await new Promise(r => setTimeout(r, 1200));

    // === TENTATIVA 2: Confirmação via Headers Mobile Safari ===
    try {
      const page2 = await this.fetchPage(url, this.getMobileHeaders(), 10000);
      const parsed2 = this.parseInviteHtml(page2.text, page2.status);

      // Se a versão mobile identificou o título do grupo: VÁLIDO!
      // (O erro anterior era apenas o pop-up de cookies do desktop)
      if (parsed2.detectedTitle) {
        return {
          isValid: true,
          title: parsed2.detectedTitle,
          inviteCode,
          url,
          status: 'VALID',
          message: `Link ativo e validado via mobile: "${parsed2.detectedTitle}"`,
          checkedAt: new Date().toISOString(),
          durationMs: Date.now() - startTime,
        };
      }

      // Se foi detectado pop-up de cookies ou captcha também no mobile:
      // O link NÃO está quebrado, é apenas um bloqueio temporário de IP/consentimento.
      if (parsed2.isInterrupted) {
        return {
          isValid: true, // Mantém como válido para NÃO revogar indevidamente
          title: null,
          inviteCode,
          url,
          status: 'INCONCLUSIVE',
          message: `Aviso: WhatsApp apresentou tela de consentimento/desafio (${parsed2.reason}). Link mantido como seguro.`,
          checkedAt: new Date().toISOString(),
          durationMs: Date.now() - startTime,
        };
      }

      // Somente declara REVOKED se houver confirmação explícita de layout de convite com nome vazio
      if (parsed2.isExplicitlyRevoked) {
        return {
          isValid: false,
          title: null,
          inviteCode,
          url,
          status: 'REVOKED',
          message: 'Link revogado confirmado (Nome do grupo vazio na tela de convite).',
          checkedAt: new Date().toISOString(),
          durationMs: Date.now() - startTime,
        };
      }
    } catch (err2) {
      // Falha na requisição mobile
    }

    // Caso a página não tenha respondido com o formato esperado nem confirmado revogação:
    // PREVENÇÃO DE FALSO POSITIVO: Em caso de dúvida, NÃO considera revogado!
    return {
      isValid: true, // Seguro: não dispara alteração de link
      title: null,
      inviteCode,
      url,
      status: 'INCONCLUSIVE',
      message: 'Resposta inconclusiva do WhatsApp (provável instabilidade ou bloqueio temporário). Nenhuma ação tomada.',
      checkedAt: new Date().toISOString(),
      durationMs: Date.now() - startTime,
    };
  }
}
