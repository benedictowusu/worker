/**
 * Altified Cloudflare Worker - Auto-inject Translation
 * FIXED VERSION: Parallel translation + proper caching + corrected hreflang
 */

const CONFIG = {
	ALTIFIED_API: 'https://api.altified.com',
	PLAN_STATUS_ENDPOINT: '/plan-status/',
	LANGUAGES_ENDPOINT: '/languages/',
	CACHE_TTL: 3600,
};

export default {
	async fetch(request, env, ctx) {
		try {
			const url = new URL(request.url);
			const apiKey = env.ALTIFIED_API_KEY;

			if (!apiKey) {
				return fetch(request);
			}

			const projectConfig = await getProjectConfig(apiKey);

			if (!projectConfig || !projectConfig.target_languages) {
				return fetch(request);
			}

			const languageNames = await getLanguageNames();

			const { default_language, target_languages } = projectConfig;
			const enabledLanguages = Array.isArray(target_languages) ? target_languages : [];

			const parts = url.pathname.split('/').filter(Boolean);
			const firstSegment = parts[0];

			if (enabledLanguages.includes(firstSegment)) {
				const lang = firstSegment;
				const originalPath = '/' + parts.slice(1).join('/');

				return handleTranslatedRequest(request, url, lang, originalPath, env, ctx, projectConfig, languageNames);
			}

			return handleDefaultLanguagePage(request, env, ctx, projectConfig, languageNames);
		} catch (error) {
			return fetch(request);
		}
	},
};

async function getProjectConfig(apiKey) {
	try {
		const cacheKey = new Request(`https://cache.internal/project_config_${apiKey}`);
		const cache = caches.default;

		try {
			const cachedResponse = await cache.match(cacheKey);
			if (cachedResponse) {
				return await cachedResponse.json();
			}
		} catch (e) {}

		const response = await fetch(`${CONFIG.ALTIFIED_API}${CONFIG.PLAN_STATUS_ENDPOINT}?api_key=${apiKey}`, {
			headers: {
				Accept: 'application/json',
			},
		});

		if (!response.ok) {
			return null;
		}

		const data = await response.json();

		try {
			const cacheResponse = new Response(JSON.stringify(data), {
				headers: {
					'Content-Type': 'application/json',
					'Cache-Control': `public, max-age=${CONFIG.CACHE_TTL}`,
				},
			});

			await cache.put(cacheKey, cacheResponse);
		} catch (e) {}

		return data;
	} catch (error) {
		return null;
	}
}

async function getLanguageNames() {
	try {
		const cacheKey = new Request(`https://cache.internal/language_names`);
		const cache = caches.default;

		try {
			const cachedResponse = await cache.match(cacheKey);
			if (cachedResponse) {
				return await cachedResponse.json();
			}
		} catch (e) {}

		const response = await fetch(`${CONFIG.ALTIFIED_API}${CONFIG.LANGUAGES_ENDPOINT}`, {
			headers: {
				Accept: 'application/json',
			},
		});

		if (!response.ok) {
			return {};
		}

		const data = await response.json();

		const languageMap = {};
		if (data.languages && Array.isArray(data.languages)) {
			data.languages.forEach((lang) => {
				if (lang.code && lang.name) {
					languageMap[lang.code] = lang.name;
				}
			});
		}

		try {
			const cacheResponse = new Response(JSON.stringify(languageMap), {
				headers: {
					'Content-Type': 'application/json',
					'Cache-Control': `public, max-age=${CONFIG.CACHE_TTL * 24}`,
				},
			});

			await cache.put(cacheKey, cacheResponse);
		} catch (e) {}

		return languageMap;
	} catch (error) {
		return {};
	}
}

async function handleTranslatedRequest(request, url, lang, originalPath, env, ctx, projectConfig, languageNames) {
	const cache = caches.default;

	// FIX: Include language in cache key to prevent collision
	const cacheKey = new Request(`${url.toString()}?__cache_lang=${lang}`, {
		method: 'GET',
	});

	const cached = await cache.match(cacheKey);
	if (cached) return new Response(cached.body, cached);

	try {
		const originUrl = new URL(request.url);
		originUrl.pathname = originalPath || '/';

		const response = await fetch(originUrl.toString());

		if (!response.ok) return response;

		const contentType = response.headers.get('Content-Type') || '';

		if (!contentType.includes('html')) {
			return response;
		}

		let html = await response.text();

		// FIX: Extract origin from request URL
		const origin = `${url.protocol}//${url.host}`;

		html = injectAutoTranslation(html, lang, env.ALTIFIED_API_KEY);
		html = injectLanguageContext(html, lang);
		html = addHreflangLinks(html, originalPath, projectConfig, origin);
		html = injectLanguageSwitcher(html, projectConfig, languageNames);

		const finalResponse = new Response(html, {
			status: response.status,
			statusText: response.statusText,
			headers: new Headers(response.headers),
		});
		finalResponse.headers.set('Content-Language', lang);
		finalResponse.headers.set('Cache-Control', 'public, max-age=3600');

		ctx.waitUntil(cache.put(cacheKey, finalResponse.clone()));
		return finalResponse;
	} catch (error) {
		return fetch(request);
	}
}

async function handleDefaultLanguagePage(request, env, ctx, projectConfig, languageNames) {
	try {
		const response = await fetch(request);
		const contentType = response.headers.get('Content-Type') || '';

		if (!contentType.includes('html')) {
			return response;
		}

		let html = await response.text();

		html = injectAutoLanguageDetection(html, projectConfig);
		html = injectLanguageSwitcher(html, projectConfig, languageNames);

		return new Response(html, {
			status: response.status,
			statusText: response.statusText,
			headers: response.headers,
		});
	} catch (error) {
		return fetch(request);
	}
}

function injectAutoLanguageDetection(html, projectConfig) {
	if (html.includes('__ALTIFIED_AUTO_LANG_DETECT__')) return html;

	const defaultLang = projectConfig.default_language || 'en';
	const targetLangs = JSON.stringify(projectConfig.target_languages || []);

	const script = `
<script id="__ALTIFIED_AUTO_LANG_DETECT__">
(function() {
  if (sessionStorage.getItem('altified_lang_detected')) {
    return;
  }

  var browserLang = navigator.language || navigator.userLanguage;
  var langCode = browserLang.split('-')[0].toLowerCase();

  var targetLanguages = ${targetLangs};
  var defaultLanguage = '${defaultLang}';

  sessionStorage.setItem('altified_lang_detected', 'true');

  if (targetLanguages.includes(langCode) && langCode !== defaultLanguage) {
    var currentPath = window.location.pathname;
    var newPath = '/' + langCode + currentPath;
    
    window.location.href = newPath + window.location.search + window.location.hash;
  }
})();
</script>
`;

	return html.replace(/<head[^>]*>/, (match) => match + script);
}

/* ----------------------------------------
   FIXED: Parallel translation (everything at once)
   + Timeout fallback to prevent infinite blur
----------------------------------------- */
function injectAutoTranslation(html, lang, apiKey) {
	if (html.includes('__ALTIFIED_AUTO_TRANSLATE__')) return html;

	const script = `
<style id="__ALTIFIED_BLUR__">
  html {
    filter: blur(8px);
    opacity: 0.6;
    transition: filter 0.3s ease-out, opacity 0.3s ease-out;
  }
  
  html.altified-translated {
    filter: none;
    opacity: 1;
  }
</style>

<script id="__ALTIFIED_AUTO_TRANSLATE__">
(function() {
  window.__ALTIFIED_LANG__ = '${lang}';
  window.__ALTIFIED_API_KEY__ = '${apiKey}';
  
  const translationCache = new Map();
  const translatedNodes = new WeakSet();
  let isTranslating = false;
  
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
  
  function init() {
    rewriteInternalLinks();
    translateAllContent();
    startObserver();
  }
  
  function removeBlur() {
    document.documentElement.classList.add('altified-translated');
    setTimeout(function() {
      var blurStyle = document.getElementById('__ALTIFIED_BLUR__');
      if (blurStyle) blurStyle.remove();
    }, 300);
  }
  
  // FIXED: Translate everything in parallel with timeout fallback
  async function translateAllContent() {
    if (isTranslating) return;
    isTranslating = true;
    
    // 5 second timeout to prevent infinite blur
    const timeout = new Promise(resolve => setTimeout(resolve, 5000));
    
    try {
      await Promise.race([
        Promise.all([
          translateContent(document.head),
          translateContent(document.body)
        ]),
        timeout
      ]);
    } catch (error) {
      console.error('Translation error:', error);
    } finally {
      // ALWAYS remove blur, even on error/timeout
      removeBlur();
      isTranslating = false;
    }
  }
  
  function rewriteInternalLinks() {
    var links = document.querySelectorAll('a[href]');
    var langPrefix = '/${lang}';
    
    links.forEach(function(link) {
      var href = link.getAttribute('href');
      
      if (!href) return;
      if (href.startsWith('http://') || href.startsWith('https://')) return;
      if (href.startsWith('#')) return;
      if (href.startsWith('mailto:') || href.startsWith('tel:')) return;
      
      if (!href.startsWith(langPrefix + '/') && href !== langPrefix) {
        var newHref;
        if (href === '/') {
          newHref = langPrefix;
        } else if (href.startsWith('/')) {
          newHref = langPrefix + href;
        } else {
          if (href.startsWith('./')) {
            newHref = langPrefix + '/' + href.substring(2);
          } else {
            newHref = langPrefix + '/' + href;
          }
        }
        link.setAttribute('href', newHref);
      }
    });
  }
  
  async function translateContent(root) {
    const textNodes = collectTextNodes(root);
    const attrNodes = collectAttributeNodes(root);
    const texts = [
      ...textNodes.map(n => n.nodeValue.trim()),
      ...attrNodes.map(a => a.text)
    ];
    
    if (texts.length === 0) {
      return;
    }
    
    await translateTexts(texts);
    
    textNodes.forEach((node, i) => {
      const translated = translationCache.get(texts[i]);
      if (translated && translated !== texts[i]) {
        node.nodeValue = translated;
        translatedNodes.add(node);
      }
    });
    
    attrNodes.forEach((a, i) => {
      const translated = translationCache.get(texts[textNodes.length + i]);
      if (translated && translated !== texts[textNodes.length + i]) {
        a.element.setAttribute(a.attribute, translated);
        translatedNodes.add(a.element);
      }
    });
  }
  
  function collectTextNodes(root) {
    const nodes = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    let node;
    
    while ((node = walker.nextNode())) {
      if (translatedNodes.has(node)) continue;
      
      const text = node.nodeValue.trim();
      const parent = node.parentElement;
      
      if (!text || !parent) continue;
      if (parent.closest('[translate="no"]')) continue;
      
      const tagName = parent.tagName;
      if (['SCRIPT', 'STYLE', 'NOSCRIPT', 'IFRAME', 'CODE', 'PRE'].includes(tagName)) {
        continue;
      }
      
      if (root === document.head) {
        if (['TITLE'].includes(tagName)) {
          nodes.push(node);
        }
      } else {
        nodes.push(node);
      }
    }
    
    return nodes;
  }
  
  function collectAttributeNodes(root) {
    const attrs = [];
    
    const elements = root.querySelectorAll('[alt], [title], [placeholder], [aria-label]');
    
    elements.forEach(el => {
      ['alt', 'title', 'placeholder', 'aria-label'].forEach(attr => {
        const val = el.getAttribute(attr);
        if (val && val.trim() && !translatedNodes.has(el)) {
          attrs.push({ element: el, attribute: attr, text: val.trim() });
        }
      });
    });
    
    if (root === document.head) {
      const metaSelectors = [
        'meta[name="title"]',
        'meta[name="description"]',
        'meta[name="keywords"]',
        'meta[property="og:title"]',
        'meta[property="og:description"]',
        'meta[name="twitter:title"]',
        'meta[name="twitter:description"]'
      ];
      
      metaSelectors.forEach(selector => {
        const meta = root.querySelector(selector);
        if (meta) {
          const content = meta.getAttribute('content');
          if (content && content.trim() && !translatedNodes.has(meta)) {
            attrs.push({ element: meta, attribute: 'content', text: content.trim() });
          }
        }
      });
    }
    
    return attrs;
  }
  
  async function translateTexts(texts) {
    const toTranslate = texts.filter(t => !translationCache.has(t) || translationCache.get(t) === t);
    
    if (toTranslate.length === 0) return;
    
    try {
      const res = await fetch('${CONFIG.ALTIFIED_API}/translate/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_api_key: '${apiKey}',
          language: '${lang}',
          texts: toTranslate
        })
      });
      
      if (!res.ok) throw new Error('HTTP ' + res.status);
      
      const data = await res.json();
      
      if (data?.translations) {
        data.translations.forEach(t => {
          if (t?.original && t?.translated) {
            translationCache.set(t.original, t.translated);
          }
        });
      }
      
      return data;
    } catch (err) {
      console.error('Translation API error:', err);
      return null;
    }
  }
  
  function startObserver() {
    const observer = new MutationObserver((mutations) => {
      const newNodes = [];
      
      mutations.forEach(mutation => {
        mutation.addedNodes.forEach(node => {
          if (node.nodeType === Node.ELEMENT_NODE) {
            if (!translatedNodes.has(node) && !node.closest('[translate="no"]')) {
              newNodes.push(node);
            }
          }
        });
      });
      
      if (newNodes.length > 0) {
        translateNewNodes(newNodes);
      }
    });
    
    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  }
  
  async function translateNewNodes(nodes) {
    for (const node of nodes) {
      const textNodes = collectTextNodes(node);
      const attrNodes = collectAttributeNodes(node);
      
      const texts = [
        ...textNodes.map(n => n.nodeValue.trim()),
        ...attrNodes.map(a => a.text)
      ];
      
      if (texts.length === 0) continue;
      
      await translateTexts(texts);
      
      textNodes.forEach((textNode, i) => {
        const translated = translationCache.get(texts[i]);
        if (translated && translated !== texts[i]) {
          textNode.nodeValue = translated;
          translatedNodes.add(textNode);
        }
      });
      
      attrNodes.forEach((a, i) => {
        const translated = translationCache.get(texts[textNodes.length + i]);
        if (translated && translated !== texts[textNodes.length + i]) {
          a.element.setAttribute(a.attribute, translated);
          translatedNodes.add(a.element);
        }
      });
      
      const links = node.querySelectorAll ? node.querySelectorAll('a[href]') : [];
      links.forEach(function(link) {
        var href = link.getAttribute('href');
        var langPrefix = '/${lang}';
        
        if (!href) return;
        if (href.startsWith('http://') || href.startsWith('https://')) return;
        if (href.startsWith('#')) return;
        if (href.startsWith('mailto:') || href.startsWith('tel:')) return;
        
        if (!href.startsWith(langPrefix + '/') && href !== langPrefix) {
          var newHref;
          if (href === '/') {
            newHref = langPrefix;
          } else if (href.startsWith('/')) {
            newHref = langPrefix + href;
          } else {
            if (href.startsWith('./')) {
              newHref = langPrefix + '/' + href.substring(2);
            } else {
              newHref = langPrefix + '/' + href;
            }
          }
          link.setAttribute('href', newHref);
        }
      });
    }
  }
  
})();
</script>
`;

	return html.replace('</head>', `${script}\n</head>`);
}

function injectLanguageContext(html, lang) {
	if (html.includes('__ALTIFIED_CONTEXT__')) return html;

	const script = `
<script id="__ALTIFIED_CONTEXT__">
  window.__ALTIFIED_LANG__ = '${lang}';
  document.documentElement.lang = '${lang}';
</script>
`;

	return html.replace(/<head[^>]*>/, (match) => match + script);
}

// FIX: Better hreflang check + use origin parameter correctly
function addHreflangLinks(html, pathname, projectConfig, origin) {
	// FIX: More precise check for existing hreflang tags
	if (html.match(/<link[^>]+rel=["']alternate["'][^>]+hreflang=/i)) return html;

	const defaultLang = projectConfig.default_language || 'en';
	const targetLangs = projectConfig.target_languages || [];

	let tags = `<link rel="alternate" hreflang="${defaultLang}" href="${origin}${pathname}" />`;

	targetLangs.forEach((lang) => {
		tags += `<link rel="alternate" hreflang="${lang}" href="${origin}/${lang}${pathname}" />`;
	});

	tags += `<link rel="alternate" hreflang="x-default" href="${origin}${pathname}" />`;

	return html.replace('</head>', `${tags}\n</head>`);
}

function injectLanguageSwitcher(html, projectConfig, languageNames = {}) {
	// FIX: More precise check
	if (html.match(/<[^>]+class=["']altified-lang-switcher["']/)) return html;

	const defaultLang = projectConfig.default_language || 'en';
	const targetLangs = projectConfig.target_languages || [];

	const getLanguageName = (code) => languageNames[code] || code.toUpperCase();

	const languageOptions = [
		`<option value="${defaultLang}">${getLanguageName(defaultLang)}</option>`,
		...targetLangs.map((l) => `<option value="${l}">${getLanguageName(l)}</option>`),
	].join('');

	const switcher = `
<style>
.altified-lang-switcher { 
  position: fixed; 
  bottom: 20px; 
  right: 20px; 
  z-index: 999999; 
  background: #fff; 
  border: 1px solid #e5e7eb; 
  border-radius: 8px; 
  padding: 8px 12px; 
  font-family: system-ui, sans-serif; 
  box-shadow: 0 6px 16px rgba(0,0,0,.12);
}
.altified-lang-switcher select { 
  border: none; 
  outline: none; 
  background: transparent; 
  font-size: 14px; 
  cursor: pointer;
  padding: 4px;
}
</style>

<div class="altified-lang-switcher">
  <select id="altified-lang-select">
    <option value="">Language</option>
    ${languageOptions}
  </select>
</div>

<script>
(function () {
  var select = document.getElementById('altified-lang-select');
  if (!select) return;

  var defaultLang = '${defaultLang}';
  var match = window.location.pathname.match(/^\\/([a-z]{2})(\\/|$)/);
  var currentLang = match ? match[1] : defaultLang;
  select.value = currentLang;

  select.addEventListener('change', function () {
    var newLang = this.value;
    if (!newLang || newLang === currentLang) return;

    var currentPath = window.location.pathname;
    var cleanPath = currentPath.replace(/^\\/[a-z]{2}(\\/|$)/, '/');
    if (!cleanPath.startsWith('/')) cleanPath = '/' + cleanPath;
    
    var newPath = newLang === defaultLang ? cleanPath : '/' + newLang + cleanPath;
    
    window.location.href = newPath + window.location.search + window.location.hash;
  });
})();
</script>
`;

	return html.replace('</body>', `${switcher}\n</body>`);
}
