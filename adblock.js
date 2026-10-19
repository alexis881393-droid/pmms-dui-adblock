/*
 * [LXO] Bloqueur de pubs YouTube pour pmms
 *
 * La page DUI de FiveM a acces au contenu de l'iframe YouTube (pmms s'en sert deja
 * pour les filtres audio).
 *
 * 1) SUPPRESSION : des que le lecteur YouTube se charge, on intercepte les donnees
 *    qu'il recoit (fetch, XHR, JSON.parse) et on retire la liste des pubs
 *    (adPlacements, playerAds, adSlots...). Le lecteur ne sait donc pas qu'il y a
 *    des pubs a afficher : aucune pub ne se lance.
 * 2) SECOURS : si une pub passe quand meme (pubs integrees par YouTube dans la
 *    video elle-meme), pendant la pub :
 *   - le son est coupe,
 *   - la pub est avancee jusqu'a sa fin (et acceleree),
 *   - le bouton "Passer" est clique des qu'il apparait.
 * Les banniere / overlays publicitaires et les elements YouTube parasites sur les
 * ecrans (titre, logo, videos suggerees en fin de video) sont masques par CSS.
 */

/* Diagnostic : affiche en jeu ce que voit le bloqueur (mettre false une fois regle) */
var PMMS_ADBLOCK_DEBUG = false;

function pmmsDebug(media, key, text) {
	if (!PMMS_ADBLOCK_DEBUG) {
		return;
	}

	if (media) {
		if (!media.pmms) {
			media.pmms = {};
		}
		if (!media.pmms.debugSent) {
			media.pmms.debugSent = {};
		}
		if (media.pmms.debugSent[key]) {
			return;
		}
		media.pmms.debugSent[key] = true;
	}

	try {
		sendMessage('notify', {title: 'Bloqueur de pubs', text: text, duration: 8000});
	} catch (e) {}
}


/* ------------------------------------------------------------------------- */
/* 1) Suppression des pubs a la source                                       */
/* ------------------------------------------------------------------------- */

var PMMS_AD_KEYS = ['adPlacements', 'playerAds', 'adSlots', 'adBreakHeartbeatParams', 'adBreakParams'];
var PMMS_NESTED_KEYS = ['playerResponse', 'raw_player_response', 'embedded_player_response', 'PLAYER_VARS', 'response', 'args'];

function pmmsPrune(obj, depth) {
	if (!obj || typeof obj !== 'object') {
		return obj;
	}

	depth = depth || 0;

	if (depth > 4) {
		return obj;
	}

	if (Array.isArray(obj)) {
		for (var i = 0; i < obj.length; i++) {
			pmmsPrune(obj[i], depth + 1);
		}
		return obj;
	}

	for (var k = 0; k < PMMS_AD_KEYS.length; k++) {
		if (Object.prototype.hasOwnProperty.call(obj, PMMS_AD_KEYS[k])) {
			try {
				delete obj[PMMS_AD_KEYS[k]];
			} catch (e) {}
		}
	}

	for (var n = 0; n < PMMS_NESTED_KEYS.length; n++) {
		var key = PMMS_NESTED_KEYS[n];
		var value = obj[key];

		if (value && typeof value === 'object') {
			pmmsPrune(value, depth + 1);
		} else if (typeof value === 'string' && value.indexOf('adPlacements') !== -1) {
			/* reponse du lecteur stockee sous forme de texte JSON */
			try {
				obj[key] = JSON.stringify(pmmsPrune(JSON.parse(value), depth + 1));
			} catch (e) {}
		}
	}

	return obj;
}

function pmmsIsPlayerUrl(url) {
	return typeof url === 'string' && (url.indexOf('/youtubei/v1/player') !== -1 || url.indexOf('/get_video_info') !== -1);
}

function pmmsPatchYouTubeWindow(win) {
	if (!win || win.__pmmsAdPatched) {
		return;
	}

	win.__pmmsAdPatched = true;

	/* JSON.parse : configuration du lecteur integree a la page */
	try {
		var origParse = win.JSON.parse;

		win.JSON.parse = function() {
			var result = origParse.apply(this, arguments);

			try {
				if (result && typeof result === 'object') {
					pmmsPrune(result, 0);
				}
			} catch (e) {}

			return result;
		};
	} catch (e) {}

	/* fetch : requete /youtubei/v1/player qui renvoie les infos de la video + les pubs */
	try {
		var origFetch = win.fetch;

		if (origFetch) {
			win.fetch = function(input, init) {
				var url = typeof input === 'string' ? input : (input && input.url);
				var promise = origFetch.apply(this, arguments);

				if (!pmmsIsPlayerUrl(url)) {
					return promise;
				}

				return promise.then(function(response) {
					return response.clone().text().then(function(text) {
						try {
							var data = pmmsPrune(JSON.parse(text), 0);
							return new win.Response(JSON.stringify(data), {
								status: response.status,
								statusText: response.statusText,
								headers: response.headers
							});
						} catch (e) {
							return response;
						}
					}, function() {
						return response;
					});
				});
			};
		}
	} catch (e) {}

	/* XMLHttpRequest : meme chose pour les anciennes versions du lecteur */
	try {
		var XHR = win.XMLHttpRequest;
		var origOpen = XHR.prototype.open;

		XHR.prototype.open = function(method, url) {
			this.__pmmsUrl = url;
			return origOpen.apply(this, arguments);
		};

		var desc = Object.getOwnPropertyDescriptor(XHR.prototype, 'responseText');

		if (desc && desc.get) {
			Object.defineProperty(XHR.prototype, 'responseText', {
				configurable: true,
				get: function() {
					var text = desc.get.call(this);

					if (this.readyState === 4 && pmmsIsPlayerUrl(this.__pmmsUrl) && text) {
						try {
							return JSON.stringify(pmmsPrune(JSON.parse(text), 0));
						} catch (e) {}
					}

					return text;
				}
			});
		}
	} catch (e) {}

	/* variables globales eventuelles de la page */
	try {
		['ytInitialPlayerResponse', 'ytplayer'].forEach(function(name) {
			if (win[name]) {
				pmmsPrune(win[name], 0);
			}
		});
	} catch (e) {}
}

/*
 * Surveillance tres rapide (5 ms) de toutes les iframes de la page : des que l'une
 * d'elles a charge YouTube, on la "patche" avant que le lecteur ne demande ses pubs.
 */
function pmmsWatchIframes() {
	var frames = document.getElementsByTagName('iframe');

	for (var i = 0; i < frames.length; i++) {
		try {
			var win = frames[i].contentWindow;

			if (win && !win.__pmmsAdPatched && win.location && win.location.hostname.indexOf('youtube') !== -1) {
				pmmsPatchYouTubeWindow(win);
			}
		} catch (e) {
			/* iframe inaccessible ou en cours de navigation */
		}
	}
}

setInterval(pmmsWatchIframes, 5);

if (window.MutationObserver) {
	new MutationObserver(pmmsWatchIframes).observe(document.documentElement, {childList: true, subtree: true});
}

/* ------------------------------------------------------------------------- */
/* 2) Secours : pub qui passe malgre tout                                    */
/* ------------------------------------------------------------------------- */

var PMMS_ADBLOCK_CSS = [
	'.ytp-ad-module', '.ytp-ad-overlay-container', '.ytp-ad-overlay-slot',
	'.ytp-ad-image-overlay', '.ytp-ad-text-overlay', '.ytp-ad-player-overlay',
	'.ytp-ad-player-overlay-layout', '.ytp-ad-preview-container', '.ytp-ad-message-container',
	'.ytp-paid-content-overlay', '.ytp-featured-product', '.video-ads',
	'.ytp-pause-overlay', '.ytp-endscreen-content', '.ytp-ce-element',
	'.ytp-chrome-top', '.ytp-watermark', '.ytp-show-cards-title',
	'.ytp-cards-teaser', '.ytp-impression-link', '.ytp-youtube-button',
	'.ytp-gradient-top', '.ytp-suggested-action', '.iv-branding'
].join(',') + '{display:none !important;visibility:hidden !important;}';

var PMMS_SKIP_SELECTORS = [
	'.ytp-ad-skip-button',
	'.ytp-ad-skip-button-modern',
	'.ytp-skip-ad-button',
	'.ytp-ad-skip-button-slot button',
	'.videoAdUiSkipButton',
	'button[id^="skip-button"]'
].join(',');

function pmmsGetYouTubeDocument(media) {
	var iframe = null;

	try {
		if (media && media.youTubeApi && media.youTubeApi.getIframe) {
			iframe = media.youTubeApi.getIframe();
		}
	} catch (e) {
		return null;
	}

	if (!iframe) {
		return null;
	}

	try {
		var doc = iframe.contentWindow.document;
		/* acces a une propriete pour declencher l'erreur cross-origin si elle existe */
		var test = doc.body;
		return doc;
	} catch (e) {
		pmmsDebug(media, 'noaccess', 'ECHEC : acces au lecteur YouTube refuse (' + (e && e.name ? e.name : e) + ')');
		return null;
	}
}

function pmmsAdBlockTick(media) {
	var doc = pmmsGetYouTubeDocument(media);

	if (!doc) {
		return;
	}

	try {
		pmmsPatchYouTubeWindow(doc.defaultView);
	} catch (e) {}

	/* CSS anti-overlays, injecte une seule fois par document */
	if (!doc.getElementById('pmms-adblock-style') && doc.head) {
		var style = doc.createElement('style');
		style.id = 'pmms-adblock-style';
		style.textContent = PMMS_ADBLOCK_CSS;
		doc.head.appendChild(style);
	}

	var ytPlayer = doc.querySelector('.html5-video-player');
	var video = doc.querySelector('video.html5-main-video') || doc.querySelector('video');

	if (!ytPlayer || !video) {
		return;
	}

	pmmsDebug(media, 'access', 'OK : acces au lecteur YouTube');

	if (!video.paused) {
		pmmsDebug(media, 'classes', 'Classes du lecteur : ' + ytPlayer.className.replace(/\s+/g, ' ').substring(0, 300));
	}

	var adShowing = ytPlayer.classList.contains('ad-showing') || ytPlayer.classList.contains('ad-interrupting');

	if (adShowing) {
		if (!media.pmms) {
			media.pmms = {};
		}

		if (!media.pmms.inAd) {
			media.pmms.inAd = true;
			media.pmms.mutedBeforeAd = video.muted;
			pmmsDebug(null, null, 'Pub detectee : son coupe, pub sautee');
		}

		video.muted = true;

		try {
			video.playbackRate = 16;
		} catch (e) {}

		/*
		 * Saut direct a la fin UNIQUEMENT si la pub est une video separee et courte.
		 * Sur les longues videos, YouTube integre souvent la pub dans la video elle-meme :
		 * sauter a la fin couperait toute la musique. Dans ce cas on se contente
		 * d'accelerer (x16) la pub en sourdine jusqu'a ce qu'elle soit passee.
		 */
		var contentDuration = 0;

		try {
			contentDuration = media.youTubeApi.getDuration() || 0;
		} catch (e) {}

		var isSeparateShortAd = isFinite(video.duration) && video.duration > 0 && video.duration <= 180 &&
			contentDuration > 0 && Math.abs(contentDuration - video.duration) > 5;

		if (isSeparateShortAd && video.currentTime < video.duration - 0.1) {
			try {
				video.currentTime = video.duration;
			} catch (e) {}
		}

		var skip = doc.querySelector(PMMS_SKIP_SELECTORS);

		if (skip) {
			skip.click();
		}
	} else if (media.pmms && media.pmms.inAd) {
		/* Fin de la pub : on remet le son et la vitesse normale */
		media.pmms.inAd = false;
		video.muted = media.pmms.mutedBeforeAd || false;

		try {
			video.playbackRate = 1;
		} catch (e) {}
	}
}

function pmmsStartAdBlock(media, id) {
	if (!media) {
		return;
	}

	if (!media.pmms) {
		media.pmms = {};
	}

	if (media.pmms.adBlockTimer) {
		return;
	}

	pmmsDebug(media, 'loaded', 'Bloqueur charge (page ' + location.hostname + ')');

	/* verification rapide (100 ms) pour limiter le depassement apres une pub acceleree */
	media.pmms.adBlockTimer = setInterval(function() {
		/* Arret quand le lecteur a ete supprime de la page */
		if (id && !document.getElementById(id)) {
			clearInterval(media.pmms.adBlockTimer);
			return;
		}

		if (!media.youTubeApi) {
			return;
		}

		try {
			pmmsAdBlockTick(media);
		} catch (e) {
			/* ne jamais casser la lecture */
		}
	}, 100);
}
