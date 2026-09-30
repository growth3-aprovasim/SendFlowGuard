/**
 * Módulo Avançado de Verificação de Integridade de Links de Convite do WhatsApp
 * com proteção máxima contra falsos positivos (Cloudflare/Meta WAF, pop-ups de cookies,
 * variações de ordem em meta-tags HTML, oscilações de rede e rate-limits temporários).
 */

export class WhatsAppChecker {
  // Cache em memória para evitar flood de requisições em links já confirmados ativos
  static _cache = new Map();
  static CACHE_TTL_MS = 3 * 60 * 1000; // 3 minutos para links válidos

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
    if (!html) return null;
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
   * Tier 1: Facebook / Meta Social External Hit (Serve OpenGraph SSR puro)
   */
  static getFacebookCrawlerHeaders() {
    return {
      'User-Agent':
        'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
      'Accept':
        'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
      'Cache-Control': 'no-cache',
      'Pragma': 'no-cache',
      'Connection': 'keep-alive',
    };
  }

  /**
   * Tier 2: WhatsApp App Native Crawler (Header usado pelo próprio app ao pré-visualizar links)
   */
  static getWhatsAppAppHeaders() {
    return {
      'User-Agent': 'WhatsApp/2.24.21.79 A',
      'Accept':
        'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    };
  }

  /**
   * Tier 3: Social Bot Crawler (Twitterbot / Slackbot)
   */
  static getSocialBotHeaders() {
    return {
      'User-Agent': 'Twitterbot/1.0',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    };
  }

  /**
   * Tier 4: Desktop Chrome com Cookies de Consentimento
   */
  static getDesktopHeaders() {
    return {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      'Accept':
        'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
      'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
      'Sec-Ch-Ua': '"Chromium";v="131", "Google Chrome";v="131", "Not_A Brand";v="24"',
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
      'Connection': 'keep-alive',
    };
  }

  /**
   * Analisa o HTML retornado e identifica o estado do grupo de forma detalhada
   */
  static parseInviteHtml(html, statusCode) {
    if (!html || typeof html !== 'string' || html.trim().length === 0) {
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
   * Executa uma requisição HTTP individual com timeout completo (handshake + body stream)
   */
  static async fetchPage(url, headers, timeout = 9000) {
    const controller = new AbortController();
    let timeoutId;
    try {
      timeoutId = setTimeout(() => controller.abort(), timeout);
      const res = await fetch(url, {
        method: 'GET',
        headers,
        signal: controller.signal,
      });
      const text = await res.text();
      clearTimeout(timeoutId);
      return { status: res.status, text, ok: true };
    } catch (err) {
      if (timeoutId) clearTimeout(timeoutId);
      return { status: 0, text: '', ok: false, error: err.message };
    }
  }

  /**
   * Executa uma passada de verificação através dos tiers de cabeçalhos
   */
  static async _executeTiers(url, inviteCode, startTime) {
    const tierProfiles = [
      { name: 'FacebookCrawler', getHeaders: () => this.getFacebookCrawlerHeaders(), delayAfter: 500 },
      { name: 'WhatsAppApp', getHeaders: () => this.getWhatsAppAppHeaders(), delayAfter: 600 },
      { name: 'SocialBot', getHeaders: () => this.getSocialBotHeaders(), delayAfter: 800 },
      { name: 'DesktopChrome', getHeaders: () => this.getDesktopHeaders(), delayAfter: 0 },
    ];

    let lastErrorReason = 'UNKNOWN';
    let successfulPageLoadedWithoutGroup = false;

    for (let i = 0; i < tierProfiles.length; i++) {
      const tier = tierProfiles[i];
      const req = await this.fetchPage(url, tier.getHeaders(), 7500);

      if (req.ok) {
        if (req.status === 404 || req.status === 410) {
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

        const parsed = this.parseInviteHtml(req.text, req.status);

        if (parsed.detectedTitle) {
          return {
            isValid: true,
            isRevoked: false,
            title: parsed.detectedTitle,
            inviteCode,
            url,
            status: 'VALID',
            message: `Link ativo e funcionando: "${parsed.detectedTitle}"`,
            checkedAt: new Date().toISOString(),
            durationMs: Date.now() - startTime,
          };
        }

        if (parsed.hasExplicitRevocation) {
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

        if (parsed.isTemporaryError) {
          lastErrorReason = parsed.reason;
        } else {
          // Página HTML carregou com sucesso (HTTP 200) sem bloqueios, mas sem nenhum nome de grupo associado
          successfulPageLoadedWithoutGroup = true;
        }
      } else {
        lastErrorReason = req.error || 'NETWORK_TIMEOUT';
      }

      if (tier.delayAfter > 0 && i < tierProfiles.length - 1) {
        await new Promise(r => setTimeout(r, tier.delayAfter));
      }
    }

    // Se carregou a página com sucesso e confirmou ausência de grupo: É REVOKED
    if (successfulPageLoadedWithoutGroup) {
      return {
        isValid: false,
        isRevoked: true,
        title: null,
        inviteCode,
        url,
        status: 'REVOKED',
        message: 'Link revogado confirmado (Página de convite carregada sem identificação de grupo ativo).',
        checkedAt: new Date().toISOString(),
        durationMs: Date.now() - startTime,
      };
    }

    // Se todas as tentativas falharam por bloqueio/WAF/rede: Estado seguro INCONCLUSIVE
    return {
      isValid: true, // Mantém seguro para não desativar o link por engano
      isTemporaryError: true,
      title: null,
      inviteCode,
      url,
      status: 'INCONCLUSIVE',
      message: `WhatsApp retornou desafio/bloqueio temporário (${lastErrorReason}). Estado seguro preservado.`,
      checkedAt: new Date().toISOString(),
      durationMs: Date.now() - startTime,
    };
  }

  /**
   * Verifica se o link de convite do WhatsApp está ativo e válido com motor multi-tier anti-falso-positivo,
   * cache em memória com TTL e retry inteligente com backoff adaptativo.
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

    // 1. Verificar Cache de Alta Performance (se válido e recente)
    const forceRefresh = Boolean(options.forceRefresh);
    if (!forceRefresh) {
      const cached = this._cache.get(inviteCode);
      if (cached && Date.now() < cached.expiresAt) {
        return {
          ...cached.data,
          fromCache: true,
          durationMs: Date.now() - startTime,
        };
      }
    }

    // 2. Primeira Passada de Tiers
    let result = await this._executeTiers(url, inviteCode, startTime);

    // 3. Auto-Retry Inteligente: Se caiu em erro temporário (WAF / empty response / rate-limit)
    if (result.isTemporaryError && !options.skipRetry) {
      // Pausa com backoff adaptativo e jitter (2.0s a 3.0s) para o WAF da Meta liberar a janela
      const backoffMs = 2000 + Math.floor(Math.random() * 1000);
      await new Promise(r => setTimeout(r, backoffMs));

      // Segunda tentativa
      const retryResult = await this._executeTiers(url, inviteCode, startTime);
      if (retryResult.isValid && !retryResult.isTemporaryError) {
        result = retryResult;
      }
    }

    // 4. Salvar no Cache se estiver VALID
    if (result.isValid && !result.isTemporaryError && result.title) {
      this._cache.set(inviteCode, {
        data: result,
        expiresAt: Date.now() + this.CACHE_TTL_MS,
      });
    }

    return result;
  }

  /**
   * Limpa o cache interno de links válidos
   */
  static clearCache() {
    this._cache.clear();
  }
}
