/**
 * Módulo Avançado de Verificação de Integridade de Links de Convite do WhatsApp
 * com proteção máxima contra falsos positivos (Cloudflare/Meta WAF, pop-ups de cookies,
 * variações de ordem em meta-tags HTML, oscilações de rede e rate-limits temporários).
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
   * Decodifica entidades HTML comuns e numéricas
   * @param {string} str 
   * @returns {string}
   */
  static decodeHtmlEntities(str) {
    if (!str) return '';
    return str
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&#x27;/g, "'")
      .replace(/&#x2F;/g, '/')
      .replace(/&nbsp;/g, ' ')
      .replace(/&#(\d+);/g, (_, dec) => {
        try {
          return String.fromCharCode(dec);
        } catch {
          return '';
        }
      })
      .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => {
        try {
          return String.fromCharCode(parseInt(hex, 16));
        } catch {
          return '';
        }
      })
      .trim();
  }

  /**
   * Extrai valor de meta tag independentemente da ordem dos atributos (property vs content vs name)
   * @param {string} html 
   * @param {string} key 
   * @returns {string|null}
   */
  static extractMetaTag(html, key) {
    const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regexes = [
      new RegExp(`<meta[^>]+(?:property|name)=["']${escapedKey}["'][^>]+content=["']([^"']*)["']`, 'i'),
      new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${escapedKey}["']`, 'i'),
    ];

    for (const regex of regexes) {
      const match = html.match(regex);
      if (match && match[1]) {
        return this.decodeHtmlEntities(match[1].trim());
      }
    }
    return null;
  }

  /**
   * Headers para Crawler/Bot Social (Tier 1 - Meta serve OpenGraph SSR puro sem cookie wall)
   */
  static getCrawlerHeaders() {
    return {
      'User-Agent':
        'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
      'Accept':
        'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8',
      'Cache-Control': 'no-cache',
      'Pragma': 'no-cache',
    };
  }

  /**
   * Headers Desktop Chrome com Cookies de Consentimento (Tier 2)
   */
  static getDesktopHeaders() {
    return {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
      'Accept':
        'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
      'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
      'Sec-Ch-Ua': '"Chromium";v="130", "Google Chrome";v="130", "Not?A_Brand";v="99"',
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

  /**
   * Headers Mobile Safari (Tier 3)
   */
  static getMobileHeaders() {
    return {
      'User-Agent':
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
      'Accept':
        'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Cookie': 'wa_lang_pref=pt_BR; wa_ul=pt_BR',
      'Cache-Control': 'no-cache',
    };
  }

  /**
   * Analisa o HTML retornado e identifica o estado do grupo de forma detalhada
   */
  static parseInviteHtml(html, statusCode) {
    if (!html || typeof html !== 'string') {
      return {
        isTemporaryError: true,
        reason: 'EMPTY_HTML_RESPONSE',
        statusCode,
      };
    }

    // 1. Identificar se é Rate Limit ou Desafio WAF/Captcha
    const isRateLimited = statusCode === 429;
    const isCookieBanner =
      html.includes('consent.whatsapp.com') ||
      (html.includes('cookie') && (html.includes('Antes de continuar') || html.includes('Before you continue')));
    const isSecurityBlock =
      statusCode === 403 ||
      html.includes('cf-browser-verification') ||
      html.includes('id="captcha"') ||
      html.includes('Challenge Validation');
    const isServerError = statusCode >= 500 && statusCode <= 599;

    if (isRateLimited || isCookieBanner || isSecurityBlock || isServerError) {
      return {
        isTemporaryError: true,
        reason: isRateLimited
          ? 'RATE_LIMIT_429'
          : isServerError
          ? `SERVER_ERROR_${statusCode}`
          : isCookieBanner
          ? 'COOKIE_CONSENT_POPUP'
          : 'SECURITY_CHALLENGE',
        statusCode,
      };
    }

    // 2. Identificar frases explícitas de revogação/expiração no corpo do HTML
    const lowerHtml = html.toLowerCase();
    const explicitRevokedPhrases = [
      'este convite foi revogado',
      'este convite foi cancelado',
      'o link de convite do grupo foi redefinido',
      'o link de convite foi redefinido',
      'não foi possível encontrar este grupo',
      'grupo não encontrado',
      'this invite link was revoked',
      'this invitation has been revoked',
      'the invite link has been reset',
      'couldn\'t find this group',
      'this link has expired',
      'este link expirou',
      'convite inválido',
      'invalid invite link',
    ];

    const hasExplicitRevocation = explicitRevokedPhrases.some(phrase => lowerHtml.includes(phrase));

    // 3. Títulos genéricos que NÃO representam o nome real de um grupo
    const genericTitles = [
      'whatsapp group invite',
      'convite para grupo do whatsapp',
      'convite para conversa em grupo',
      'convite para o grupo do whatsapp',
      'whatsapp',
      'parece que você ainda não instalou o whatsapp.',
      'parece que você ainda não instalou o whatsapp',
      'looks like you don\'t have whatsapp installed!',
      'looks like you don\'t have whatsapp installed',
      'entrar na conversa',
      'join chat',
      'baixar o whatsapp',
      'download whatsapp',
      'whatsapp web',
      'conversar no whatsapp',
      'chat on whatsapp',
    ];

    function isGeneric(str) {
      if (!str || !str.trim()) return true;
      const lower = str.toLowerCase().trim();
      return genericTitles.some(g => lower === g || (g.length > 6 && lower.startsWith(g)));
    }

    // 4. Extração de títulos via Meta Tags
    const ogTitle = this.extractMetaTag(html, 'og:title');
    const twitterTitle = this.extractMetaTag(html, 'twitter:title');

    // 5. Extração via tags H1, H2, H3
    const h3Match = html.match(/<h3[^>]*>(.*?)<\/h3>/is);
    const groupH3 = h3Match ? this.decodeHtmlEntities(h3Match[1].replace(/<[^>]*>/g, '').trim()) : '';

    const h2Match = html.match(/<h2[^>]*>(.*?)<\/h2>/is);
    const groupH2 = h2Match ? this.decodeHtmlEntities(h2Match[1].replace(/<[^>]*>/g, '').trim()) : '';

    // 6. Extração via tag <title>
    const titleMatch = html.match(/<title[^>]*>(.*?)<\/title>/is);
    let rawTitle = titleMatch ? this.decodeHtmlEntities(titleMatch[1].replace(/<[^>]*>/g, '').trim()) : '';
    if (rawTitle) {
      rawTitle = rawTitle.replace(/\s*-\s*WhatsApp.*$/i, '').trim();
    }

    // 7. Extração via JSON-LD / Data payload embutido
    let jsonTitle = null;
    const jsonMatch = html.match(/"(?:name|groupTitle|og:title)"\s*:\s*"([^"]+)"/i);
    if (jsonMatch && jsonMatch[1]) {
      jsonTitle = this.decodeHtmlEntities(jsonMatch[1].trim());
    }

    // 8. Seleção do melhor título detectado
    let detectedTitle = null;
    if (ogTitle && !isGeneric(ogTitle)) {
      detectedTitle = ogTitle;
    } else if (groupH3 && !isGeneric(groupH3)) {
      detectedTitle = groupH3;
    } else if (groupH2 && !isGeneric(groupH2)) {
      detectedTitle = groupH2;
    } else if (twitterTitle && !isGeneric(twitterTitle)) {
      detectedTitle = twitterTitle;
    } else if (rawTitle && !isGeneric(rawTitle)) {
      detectedTitle = rawTitle;
    } else if (jsonTitle && !isGeneric(jsonTitle)) {
      detectedTitle = jsonTitle;
    }

    // 9. Identificar indicadores estruturais da página de convite
    const hasInviteLayout =
      html.includes('_9vd5') ||
      html.includes('_9vda') ||
      html.includes('action-icon') ||
      lowerHtml.includes('convite para') ||
      lowerHtml.includes('group invite') ||
      lowerHtml.includes('entrar na conversa') ||
      lowerHtml.includes('join chat');

    // Imagem do grupo (pps.whatsapp.net indica foto personalizada do grupo ativa)
    const hasGroupAvatar = html.includes('pps.whatsapp.net') || html.includes('mms.whatsapp.net');

    return {
      isTemporaryError: false,
      detectedTitle: detectedTitle || null,
      hasExplicitRevocation,
      hasInviteLayout,
      hasGroupAvatar,
      statusCode,
    };
  }

  /**
   * Executa uma requisição HTTP individual com timeout
   */
  static async fetchPage(url, headers, timeout = 9000) {
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
      return { status: res.status, text, ok: true };
    } catch (err) {
      clearTimeout(timeoutId);
      return { status: 0, text: '', ok: false, error: err.message };
    }
  }

  /**
   * Verifica se o link de convite do WhatsApp está ativo e válido com motor multi-tier anti-falso-positivo.
   */
  static async checkInvite(inviteCodeOrUrl, options = {}) {
    const startTime = Date.now();
    const inviteCode = this.sanitizeInviteCode(inviteCodeOrUrl);
    const url = `https://chat.whatsapp.com/${inviteCode}`;

    if (!inviteCode) {
      return {
        isValid: false,
        isRevoked: true,
        title: null,
        inviteCode: '',
        url: '',
        status: 'ERROR',
        message: 'Código de convite inválido ou vazio.',
        checkedAt: new Date().toISOString(),
        durationMs: 0,
      };
    }

    // =========================================================================
    // TIER 1: Crawler Social (Meta/Facebook Bot - Bypassa Cookie Wall e Captcha)
    // =========================================================================
    const req1 = await this.fetchPage(url, this.getCrawlerHeaders(), 8000);

    if (req1.ok) {
      if (req1.status === 404 || req1.status === 410) {
        return {
          isValid: false,
          isRevoked: true,
          title: null,
          inviteCode,
          url,
          status: 'NOT_FOUND',
          message: 'Página de convite retornou 404/410 (Código inexistente ou deletado).',
          checkedAt: new Date().toISOString(),
          durationMs: Date.now() - startTime,
        };
      }

      const parsed1 = this.parseInviteHtml(req1.text, req1.status);

      if (parsed1.detectedTitle) {
        return {
          isValid: true,
          isRevoked: false,
          title: parsed1.detectedTitle,
          inviteCode,
          url,
          status: 'VALID',
          message: `Link ativo e funcionando: "${parsed1.detectedTitle}"`,
          checkedAt: new Date().toISOString(),
          durationMs: Date.now() - startTime,
        };
      }

      if (parsed1.hasExplicitRevocation) {
        return {
          isValid: false,
          isRevoked: true,
          title: null,
          inviteCode,
          url,
          status: 'REVOKED',
          message: 'Link revogado confirmado (Mensagem explícita de revogação detectada).',
          checkedAt: new Date().toISOString(),
          durationMs: Date.now() - startTime,
        };
      }
    }

    // Pequena pausa entre tiers
    await new Promise(r => setTimeout(r, 600));

    // =========================================================================
    // TIER 2: Desktop Chrome com Cookies de Consentimento
    // =========================================================================
    const req2 = await this.fetchPage(url, this.getDesktopHeaders(), 8000);

    if (req2.ok) {
      if (req2.status === 404 || req2.status === 410) {
        return {
          isValid: false,
          isRevoked: true,
          title: null,
          inviteCode,
          url,
          status: 'NOT_FOUND',
          message: 'Página de convite retornou 404 (Não encontrada).',
          checkedAt: new Date().toISOString(),
          durationMs: Date.now() - startTime,
        };
      }

      const parsed2 = this.parseInviteHtml(req2.text, req2.status);

      if (parsed2.detectedTitle) {
        return {
          isValid: true,
          isRevoked: false,
          title: parsed2.detectedTitle,
          inviteCode,
          url,
          status: 'VALID',
          message: `Link ativo e validado via Desktop: "${parsed2.detectedTitle}"`,
          checkedAt: new Date().toISOString(),
          durationMs: Date.now() - startTime,
        };
      }

      if (parsed2.hasExplicitRevocation) {
        return {
          isValid: false,
          isRevoked: true,
          title: null,
          inviteCode,
          url,
          status: 'REVOKED',
          message: 'Link revogado confirmado (Mensagem de revogação na página Desktop).',
          checkedAt: new Date().toISOString(),
          durationMs: Date.now() - startTime,
        };
      }
    }

    // Pequena pausa antes do Tier 3
    await new Promise(r => setTimeout(r, 800));

    // =========================================================================
    // TIER 3: Mobile Safari iOS (Confirmação Final)
    // =========================================================================
    const req3 = await this.fetchPage(url, this.getMobileHeaders(), 8000);

    if (req3.ok) {
      if (req3.status === 404 || req3.status === 410) {
        return {
          isValid: false,
          isRevoked: true,
          title: null,
          inviteCode,
          url,
          status: 'NOT_FOUND',
          message: 'Página de convite retornou 404 (Mobile).',
          checkedAt: new Date().toISOString(),
          durationMs: Date.now() - startTime,
        };
      }

      const parsed3 = this.parseInviteHtml(req3.text, req3.status);

      if (parsed3.detectedTitle) {
        return {
          isValid: true,
          isRevoked: false,
          title: parsed3.detectedTitle,
          inviteCode,
          url,
          status: 'VALID',
          message: `Link ativo e validado via Mobile: "${parsed3.detectedTitle}"`,
          checkedAt: new Date().toISOString(),
          durationMs: Date.now() - startTime,
        };
      }

      // Se foi bloqueado por WAF/RateLimit ou erro 5xx, NÃO classificar como REVOKED para evitar alarme falso
      if (parsed3.isTemporaryError) {
        return {
          isValid: true, // Mantém seguro para não desativar o link por engano
          isTemporaryError: true,
          title: null,
          inviteCode,
          url,
          status: 'INCONCLUSIVE',
          message: `WhatsApp retornou desafio/bloqueio temporário (${parsed3.reason}). Estado seguro preservado.`,
          checkedAt: new Date().toISOString(),
          durationMs: Date.now() - startTime,
        };
      }

      // Se a página de convite carregou sem erros, mas sem nome de grupo nem avatar, é realmente revogado
      return {
        isValid: false,
        isRevoked: true,
        title: null,
        inviteCode,
        url,
        status: 'REVOKED',
        message: 'Link revogado confirmado (Nenhum nome de grupo detectado após 3 análises de camadas).',
        checkedAt: new Date().toISOString(),
        durationMs: Date.now() - startTime,
      };
    }

    // Se todas as 3 requisições falharam por rede/timeout/conexão: NÃO declarar como revogado!
    return {
      isValid: true, // Não dispara desativação nem alarme falso de revogação
      isTemporaryError: true,
      title: null,
      inviteCode,
      url,
      status: 'NETWORK_ERROR',
      message: 'Oscilação temporária de conexão com os servidores do WhatsApp. Grupo mantido sem alterações.',
      checkedAt: new Date().toISOString(),
      durationMs: Date.now() - startTime,
    };
  }
}

